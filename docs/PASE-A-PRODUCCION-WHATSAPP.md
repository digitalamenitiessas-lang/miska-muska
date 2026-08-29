# Pase a WhatsApp — guía del día

**Miska Muska · 30/08/2026 · para seguir en vivo, de arriba hacia abajo**

Decidido: **va el número que ya usan** · **todo se hace desde el portafolio de ellas**, sin agregar al dev como admin.

Versión en pantalla: https://claude.ai/code/artifact/8a93dd83-36b3-4f6d-a4a5-96b312526941

---

## Antes del día

**En la cuenta de ellas** (sesión compartida, una dueña presente)

- [ ] Portafolio comercial a nombre del local — `business.facebook.com`
- [ ] Verificación del negocio, con constancia de ARCA — **tarda 1 a 5 días hábiles**
- [ ] App de desarrollador con caso de uso WhatsApp, **dentro de ese portafolio**
- [ ] Usuario del sistema con token de expiración **Nunca** y permisos `whatsapp_business_messaging` + `whatsapp_business_management`
- [ ] **Asignarle DOS activos: la app Y la cuenta de WhatsApp**, con control total
- [ ] Nombre para mostrar: `Miska Muska` (sin mayúsculas sostenidas, sin emojis, sin URLs)

> ⚠ Con un solo activo el token manda mensajes, todo se ve verde, **y los webhooks nunca llegan**. No da ningún error. Le costó una hora al bot de Turismo.

**Anotar de esa sesión:** token · app secret · app ID · WABA ID

**En el celular** (la dueña)

- [ ] Configuración → Cuenta → **Verificación en dos pasos**: ¿está activada? ¿alguien sabe el PIN?
- [ ] WhatsApp Business actualizado
- [ ] Lista de grupos donde está el número

> ⚠ Si la verificación en dos pasos está activada y nadie sabe el PIN, **el pase no se puede hacer**. Cambiarlo pide confirmación por mail.

**En el servidor** (el dev, solo)

- [ ] Generar el verify token:

```bash
ssh root@2.25.185.242 'cd /opt/miska-muska && cp .env .env.bak && TOKEN=$(openssl rand -hex 32) && sed -i "s|^WHATSAPP_VERIFY_TOKEN=.*|WHATSAPP_VERIFY_TOKEN=$TOKEN|" .env && chmod 600 .env && systemctl restart miska-bot && echo "VERIFY_TOKEN=$TOKEN"'
```

Guardar lo que imprime. El resto ya está verificado: el webhook responde, el canal espera credenciales, el panel está cerrado con token.

---

## Antes de tocar el celular, decírselo

- La app de WhatsApp Business **de ese número deja de existir**. Todo pasa al panel.
- **Se pierde el historial**, y la copia en Google Drive se borra con la cuenta. Solo sobrevive lo exportado por mail.
- **El número sale de todos los grupos.** Las listas de difusión se pierden.
- **El catálogo de la app se va.** El bot muestra los productos igual.
- **Pasadas 24 h del último mensaje del cliente, no se le puede escribir** — ni el bot ni ellas. Hoy con la app le escriben cuando quieren. Se arregla con plantillas, que **no** entran en este pase.
- **Los comprobantes sí se ven** en el panel. Eso quedó resuelto.

**Terminar con un sí en voz alta de las dos.**

---

## El día — 13 pasos

| | Quién | Paso | Verificación |
| --- | --- | --- | --- |
| **1** | dueña | Exportar por mail los chats que importen (menú → Más → Exportar chat → Incluir archivos) | **El mail llegó y se abre. Sin eso no se sigue** |
| **2** | dueña | Capturas del catálogo; dejar otro admin en los grupos | — |
| **3** | dev | `systemctl status miska-bot` + `/health` | Activo. **Si está caído, no se borra nada** |
| **4** | juntos | Confirmar el PIN de dos pasos | Está, o se frena acá |

### ⛔ 5 — PUNTO DE NO RETORNO

**La dueña, en el celular:** WhatsApp Business → **Configuración → Cuenta → Eliminar mi cuenta**, con código de país.

- Meta tarda **hasta 3 minutos** en liberar el número.
- **Que no desinstale la app**: eso no borra la cuenta y el número sigue ocupado.
- **10 intentos de registro cada 72 h.** Pasado eso, el número queda bloqueado **3 días** con la cuenta ya borrada. Si el SMS no llega en 2 minutos: **verificación por voz**, no reintentar SMS.

| | Quién | Paso | Verificación |
| --- | --- | --- | --- |
| **6** | juntos | WhatsApp Manager → Números → **Agregar número** | Aparece pendiente de verificación |
| **7** | juntos | **Verificar por SMS** (el código le llega a ella) | Pasa a verificado |
| **8** | dev | **Registrar con PIN** (abajo) | `{"success":true}` y estado *Connected* |
| **9** | dev | Cargar las 5 variables en el `.env` y reiniciar | El log arranca sin errores |
| **10** | dev | **Probar el handshake** (abajo) | Imprime exactamente `hola` |
| **11** | juntos | Configurar el webhook, campo `messages` y solo ese | Meta acepta la URL |
| **12** | dev | **Suscribir la app a la WABA** (abajo) | `{"success":true}` |
| **13** | dev | `/health` con el switch **apagado**, probar entrante, y recién ahí prender el bot | Contesta «¿a qué hora abren?» |

> ⚠ **Paso 8, si al buscar el número en WhatsApp aparece «Invitar»**: quedó en `PENDING`. Verificar por SMS no alcanza, falta este `/register`.
>
> ⚠ **El paso 12 no lo pide la consola y no da error.** Sin él, el webhook figura verificado, el token manda mensajes, y no llega un solo mensaje entrante.

### Los comandos

```bash
export BASE=https://vps.marcorossi.com.ar/miska-bot
export TOKEN=EAAG...      # token del usuario del sistema
export PHONE_ID=...       # el ID, no el número
export WABA_ID=...
export VERIFY=...         # el generado antes
```

**8 — registrar el número.** PIN nuevo de 6 dígitos, anotado en dos lugares.

```bash
curl -s -X POST "https://graph.facebook.com/v21.0/$PHONE_ID/register" \
  -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"messaging_product":"whatsapp","pin":"123456"}'
```

**9 — las cinco variables**, en `/opt/miska-muska/.env` (backup antes, `chmod 600` después):

```
WHATSAPP_ACCESS_TOKEN=EAAG...
WHATSAPP_PHONE_NUMBER_ID=...
WHATSAPP_VERIFY_TOKEN=...
WHATSAPP_APP_SECRET=...
WHATSAPP_GRAPH_VERSION=v21.0
```

`WHATSAPP_APP_SECRET` **no es opcional**: vacío, el bot acepta webhooks sin validar la firma y nada lo avisa.

**10 — handshake:**

```bash
curl -s "$BASE/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=$VERIFY&hub.challenge=hola"
```

**12 — suscribir la app a la WABA:**

```bash
curl -X POST "https://graph.facebook.com/v21.0/$WABA_ID/subscribed_apps" \
  -H "Authorization: Bearer $TOKEN"
```

---

## Verificación final

```bash
curl -s "$BASE/health" | jq '.channels'      # whatsapp: configured:true, ok:true
curl -s "https://graph.facebook.com/v21.0/$WABA_ID/subscribed_apps" -H "Authorization: Bearer $TOKEN"
```

- [ ] Entra un mensaje real desde otro celular → aparece en la bandeja en menos de 3 s
- [ ] El bot contesta «¿a qué hora abren?»
- [ ] Contestar desde el panel → llega al celular
- [ ] **Mandar una foto** → se ve la imagen, no `[imagen]`
- [ ] Pedirle la foto de un producto → llega la imagen
- [ ] Tomar un pedido completo → aparece en Pedidos y en la Comanda
- [ ] La firma del webhook rechaza (abajo) → **401**

```bash
curl -s -o /dev/null -w '%{http_code}\n' -X POST "$BASE/webhooks/whatsapp" \
  -H 'content-type: application/json' \
  -H "x-hub-signature-256: sha256=$(printf '%064d' 0)" \
  -d '{"object":"whatsapp_business_account","entry":[]}'
```

Si da **200**, el app secret quedó vacío: apagar y arreglar en el momento.

---

## Si algo sale mal

| Síntoma | Qué es | Qué se hace |
| --- | --- | --- |
| El SMS no llega | — | Verificación **por voz**. No reintentar SMS |
| `133016` | Se agotaron los 10 intentos | **72 h bloqueado.** Publicar otro número en Instagram y avisar en el local |
| Aparece «Invitar» al buscar el número | Quedó `PENDING` | El `/register` del paso 8 |
| Webhook verificado y no llega nada | Falta el paso 12, o falta el activo «Cuentas de WhatsApp» | Los dos son silenciosos: revisar ambos |
| Meta no valida la callback URL | Verify token distinto, o el bot caído | Correr el handshake del paso 10 |
| `(#200) Permissions error` | La WABA no está asignada al usuario del sistema | Asignar el activo |
| `190 access token expired` | Quedó el token temporal de 24 h | Regenerar el permanente — **necesita a una dueña** |
| El bot contesta mal | — | Apagar el switch en Ajustes → Canales. **No apaga el webhook**: los mensajes se siguen guardando |
| Volver atrás | — | `POST /$PHONE_ID/deregister` → reinstalar la app → verificar por SMS. **No vuelven historial, grupos ni catálogo** |

**Regla de oro:** si a las dos horas del paso 5 el número no recibe mensajes, **parar**. Cada intento fallido acerca el bloqueo de 72 h. Retomar al día siguiente.

---

## Después

- **Sin plantillas, no se puede escribir fuera de las 24 h.** Es la limitación que queda abierta; implementarlo son 2-3 días de trabajo cuando lo decidan.
- **1 de octubre:** Meta pasa a cobrar por mensaje, también dentro de las 24 h. Si el bot parte una respuesta en tres globitos, cuesta el triple: hay que consolidar respuestas antes de esa fecha.
- **Verificación del negocio**, si no salió: sin ella el tope es 250 destinatarios únicos cada 24 h para conversaciones que inicia el local. Responder no cuenta y es ilimitado.
- **Envíos masivos:** son lo único que puede hacer que Meta baje el número. Dejar acordado que pasan antes por el dev.
- Primera semana: `journalctl -u miska-bot --since today | grep -iE 'whatsapp|429'` y el *quality rating* en WhatsApp Manager.

<details>
<summary>Lo que se descartó, por si hay que volver</summary>

- **Número nuevo primero**, migrando el de siempre a las 2-4 semanas. Era la recomendación original: los comprobantes no se veían *(resuelto)*, no hay plantillas *(sigue)*, y el punto de no retorno tiene un modo de falla de 3 días *(sigue)*.
- **Coexistence** (el mismo número en la app y en la API): exige socio de Meta o un intermediario con su facturación, y deja sin catálogo, listas de difusión, respuestas rápidas ni etiquetas.
- **El dev como admin del portafolio.** La contra: nada del lado de Meta se resuelve sin coordinar una sesión con ellas — ni regenerar un token vencido, ni corregir una plantilla rechazada.

</details>
