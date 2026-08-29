# Pase a producción de WhatsApp — Miska Muska

**Versión del 30/08/2026 · un solo camino, con las decisiones ya tomadas · lector: el desarrollador**

> Versión para leer en pantalla: https://claude.ai/code/artifact/8a93dd83-36b3-4f6d-a4a5-96b312526941
>
> Lo que se afirma del sistema está verificado contra el archivo y la línea que se citan. Lo que depende
> de Meta sale de su documentación y del runbook del **Bot de Turismo SMT** (equipo DIA, 25/08/2026), que
> hizo este mismo trámite hace unos días. Donde una fuente contradice a otra, está dicho.

---

## Las decisiones, para no volver sobre ellas

| # | Decisión | Consecuencia operativa |
| --- | --- | --- |
| 1 | **Todo se hace desde el portafolio de ellas.** El dev no se agrega como administrador | Cada paso del lado de Meta se hace en una sesión con una dueña presente, en su cuenta. No hay nada que el dev pueda hacer solo en Meta, ni mañana ni después |
| 2 | **Va el número que ya usan** en WhatsApp Business | Hay que borrar esa cuenta del celular. Hay un punto de no retorno y un hueco de minutos sin WhatsApp |

**Lo que la decisión 1 implica y conviene tener claro desde hoy** — no para discutirla, para no llevarse la sorpresa:

- Del lado de Meta, el dev no puede hacer **nada** solo: ni regenerar el token si se invalida, ni corregir una plantilla que rechacen, ni mirar por qué cayó el *quality rating*. Todo eso pide una nueva sesión con ellas.
- Igual el dev **termina con credenciales en la mano**: el token permanente, el app secret, el phone number ID y el WABA ID van al `.env` del servidor, porque sin eso el bot no habla con Meta. O sea que la decisión no evita que el dev tenga acceso técnico; evita que tenga acceso a la *consola*. Pasarlas por un canal privado y borrarlas de ahí después.
- Las plantillas tardan hasta 24 h en aprobarse y la verificación del negocio de 1 a 5 días hábiles. Si eso no arrancó, no arranca solo: hay que sentarse con ellas **antes** del día del pase.

---

## 1. Antes del día del pase

### 1.1 En el portafolio de ellas — con una dueña presente

Todo esto es en su cuenta, en una sesión compartida. Si ya existe el portafolio comercial, se salta al punto 2.

| # | Qué | Dónde | Cuánto tarda |
| --- | --- | --- | --- |
| 1 | Portafolio comercial a nombre del local, con nombre legal y domicilio **como figuran en la constancia de ARCA** | business.facebook.com | 15 min |
| 2 | **Verificación del negocio** con constancia de ARCA + factura de servicios o resumen bancario | Centro de seguridad → Verificación del negocio | **1 a 5 días hábiles, puede irse a 14** |
| 3 | App de desarrollador, caso de uso WhatsApp, **dentro de ese portafolio** | developers.facebook.com | 10 min |
| 4 | **Usuario del sistema** con rol administrador, y token con expiración **Nunca** y permisos `whatsapp_business_messaging` + `whatsapp_business_management` | Configuración del negocio → Usuarios del sistema | 10 min |

> **Trampa que costó una hora en el bot de Turismo:** al usuario del sistema hay que asignarle **dos activos**, no uno: la **app** Y la **cuenta de WhatsApp** ("Cuentas de WhatsApp", con control total). Con solo la app, el token manda mensajes y todo se ve en verde, pero **los webhooks nunca llegan y no hay ningún error que lo diga**.

Al final de esta sesión el dev se lleva cuatro valores: **token**, **app secret**, **app ID** y —cuando exista el número— **phone number ID** y **WABA ID**.

### 1.2 Las plantillas — crearlas ya, aprobación de hasta 24 h

Mismo lugar, misma sesión. WhatsApp Manager → Plantillas. Idioma `es_AR`, categoría UTILITY salvo la última. Formato que evita el rechazo: variables secuenciales sin saltos, ninguna al principio ni al final del cuerpo, nunca dos pegadas.

| Nombre | Categoría | Cuerpo |
| --- | --- | --- |
| `pedido_confirmado` | UTILITY | ¡Gracias {{nombre}}! Recibimos tu comprobante y tu pedido {{numero}} quedó confirmado. Lo vas a poder retirar el {{fecha}} a partir de las {{hora}}. Si necesitás cambiar algo, escribinos por acá. |
| `pedido_listo_retiro` | UTILITY | Hola {{nombre}}, tu pedido {{numero}} ya está listo para retirar en {{direccion}}. Te esperamos hoy hasta las {{hora_cierre}}. Si no llegás a pasar, avisanos por acá y lo guardamos. |
| `pedido_en_camino` | UTILITY | Hola {{nombre}}, el cadete ya salió con tu pedido {{numero}} y va para {{direccion}}. Calculamos que llega en unos {{minutos}} minutos. Si podés, tené el timbre a mano. |
| `inscripcion_curso` | UTILITY | ¡Bienvenida {{nombre}}! Tu inscripción al curso de {{curso}} quedó confirmada. Nos vemos el {{fecha}} a las {{hora}} en {{direccion}}. Llevá delantal y algo para tomar nota. |
| `retomar_consulta` | UTILITY | Hola {{nombre}}, quedamos con tu consulta sobre {{tema}} sin responder a tiempo y no queremos dejarte colgada. Seguimos por acá: respondé este mensaje y lo retomamos ahora mismo. |
| `campana_fecha_especial` | MARKETING | Hola {{nombre}}, ya abrimos los encargues por {{ocasion}} en Miska Muska. Podés reservar hasta el {{fecha_limite}}, y este año sumamos opciones nuevas. Contestá este mensaje y armamos el tuyo. |

Ninguna plantilla de utilidad puede llevar "oferta", "descuento", "aprovechá" ni un botón "Ver catálogo": eso la recategoriza a marketing, que sale varias veces más caro. Desde 2025 Meta ya no la rechaza por eso — te la aprueba como marketing y te enterás por la factura.

**El sistema todavía no puede mandarlas.** El adaptador las serializa (`adapter.ts:308`) pero nada en el pipeline genera una. Se crean igual porque la aprobación tarda y son el requisito de todo lo que venga después.

### 1.3 Nombre para mostrar

**Miska Muska** o **Miska Muska Pastelería**, y tiene que coincidir con Instagram y la web. Se rechaza todo en mayúsculas, "Cuenta Oficial", emojis, URLs y el nombre de una persona. Aprueba entre 5 minutos y 3 horas.

### 1.4 En el celular, días antes — que lo revise la dueña

1. **Configuración → Cuenta → Verificación en dos pasos.** Si está activada y nadie sabe el PIN, **esto frena todo**: al registrar el número por API hay que mandar *ese mismo* PIN, y cambiarlo pide confirmación por mail. Si la usan, que anoten el PIN.
2. **Versión de WhatsApp Business** al día.
3. Qué **grupos** usan con ese número y quién más puede quedar de administrador.

### 1.5 En el servidor — el dev, solo

Ya está verificado y andando (30/08/2026):

| Qué | Estado |
| --- | --- |
| El webhook responde por el subpath de Caddy | OK — con token falso devuelve **403**: la ruta existe y valida |
| El canal WhatsApp | `configured:false`, las cinco variables declaradas y vacías |
| El panel | Cerrado con `ADMIN_TOKEN` (sin token devuelve **401**) |

URL exacta para Meta:

```
https://vps.marcorossi.com.ar/miska-bot/webhooks/whatsapp
```

Falta una sola cosa, y la corre el dev antes del día del pase:

```bash
ssh root@2.25.185.242 'cd /opt/miska-muska && cp .env .env.bak && TOKEN=$(openssl rand -hex 32) && sed -i "s|^WHATSAPP_VERIFY_TOKEN=.*|WHATSAPP_VERIFY_TOKEN=$TOKEN|" .env && chmod 600 .env && systemctl restart miska-bot && echo "VERIFY_TOKEN=$TOKEN"'
```

Guardar lo que imprime: es lo que va en el formulario de Meta o en el `verify_token` del curl.

---

## 2. Lo que hay que decirles antes de tocar el celular

Va hablado, no leído. La idea es que digan que sí entendiendo.

- **La app de WhatsApp Business de ese número deja de existir.** No queda de respaldo. De ahí en adelante todo pasa por el panel en la computadora.
- **Se pierde el historial de chats**, y la copia de seguridad de Google Drive **se borra junto con la cuenta**. Lo único que sobrevive es lo que se exporten por mail antes.
- **El número sale de todos los grupos** y las listas de difusión se pierden.
- **El catálogo de la app se va.** El bot muestra los productos igual, porque los tiene cargados adentro.
- **Pasadas 24 h del último mensaje del cliente no se le puede escribir**, ni el bot ni ellas, hasta que estén las plantillas andando. Hoy, con la app, le escriben cuando quieren. **Es el peor retroceso funcional del pase y sigue en pie.**
- **Los comprobantes sí se ven** en el panel: eso se resolvió el 29/08 y anda igual en Telegram y en WhatsApp.

Terminar con un sí en voz alta de las dos antes del paso 5.

---

## 3. El día del pase, paso a paso

Duración estimada: **2 horas**. Los pasos de Meta son en la sesión compartida con ellas; los del servidor los hace el dev.

**1. (dueña, 20-40 min) Exportar los chats que importen.** En cada conversación: menú → Más → Exportar chat → Incluir archivos → mandar por mail.
*Verificación: el mail llegó y se abre. **Sin ese mail no se sigue.***

**2. (dueña, 10 min) Rescatar lo que se pierde.** Capturas del catálogo, y dejar otro administrador en los grupos que importen.

**3. (dev, 5 min) Último chequeo del servidor.**
```bash
systemctl status miska-bot --no-pager
curl -s https://vps.marcorossi.com.ar/miska-bot/health | jq .
```
*Si el bot está caído, **no se borra nada**.*

**4. (juntos, 5 min) Confirmar el PIN de dos pasos.** El del punto 1.4. Si nadie lo sabe, se frena acá.

---

> ### ⛔ 5 — PUNTO DE NO RETORNO
>
> **La dueña, en el celular:** WhatsApp Business → **Configuración → Cuenta → Eliminar mi cuenta**, confirmando el número con código de país. Meta tarda **hasta 3 minutos** en liberarlo.
>
> Que no desinstale la app en vez de esto: desinstalar no borra la cuenta y el número sigue ocupado.
>
> **El riesgo de este momento no es el borrado, es el registro.** Meta permite **10 intentos cada 72 horas**; pasado eso el número queda bloqueado tres días, con la cuenta ya borrada. Si el SMS no llega en dos minutos, pedir verificación **por voz** — no reintentar el SMS en bucle.

---

**6. (juntos, 5 min) Agregar el número.** WhatsApp Manager → Números de teléfono → Agregar número. Nombre para mostrar, categoría del negocio y el número.

**7. (juntos, 5 min) Verificar por SMS.** El código le llega a ella al celular; la SIM sigue funcionando.
*Verificación: el número pasa a verificado.*

**8. (dev, 3 min) Registrar el número con PIN.**
```bash
export TOKEN=EAAG...          # token del usuario del sistema
export PHONE_ID=...           # el Phone number ID, no el número

curl -s -X POST "https://graph.facebook.com/v21.0/$PHONE_ID/register" \
  -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"messaging_product":"whatsapp","pin":"123456"}'
# esperado: {"success":true}
```
PIN nuevo de 6 dígitos, anotado en dos lugares: el gestor del dev y uno de la dueña.
*Verificación: `{"success":true}` y el número en estado **Connected**.*

> **Trampa del bot de Turismo:** si al buscar el número en WhatsApp aparece **"Invitar"**, es que quedó en `PENDING` — verificar por SMS no alcanza, falta exactamente este `/register`.

**9. (dev, 5 min) Cargar las credenciales en el servidor.**
```bash
ssh root@2.25.185.242
cp /opt/miska-muska/.env /opt/miska-muska/.env.bak.$(date +%Y%m%d%H%M%S)
nano /opt/miska-muska/.env
```
```
WHATSAPP_ACCESS_TOKEN=EAAG...     # usuario del sistema, expiración Nunca
WHATSAPP_PHONE_NUMBER_ID=...      # el ID, no el número
WHATSAPP_VERIFY_TOKEN=...         # el generado en 1.5
WHATSAPP_APP_SECRET=...           # app → Configuración → Básica
WHATSAPP_GRAPH_VERSION=v21.0
```
```bash
systemctl restart miska-bot && journalctl -u miska-bot -n 30 --no-pager
```

**`WHATSAPP_APP_SECRET` no es opcional.** Si queda vacío, `verifySignature()` devuelve `true` (`adapter.ts:126`) y el bot acepta webhooks sin validar la firma, sin avisar nada: el chequeo de credenciales no lo mira (`config.ts:94`) y el panel muestra el canal en verde igual. La URL del webhook es pública.

**10. (dev, 2 min) Probar el handshake antes de tocar Meta.**
```bash
export BASE=https://vps.marcorossi.com.ar/miska-bot
export VERIFY=...
curl -s "$BASE/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=$VERIFY&hub.challenge=hola"
# tiene que imprimir exactamente: hola
```
Si no devuelve `hola`, el formulario de Meta va a fallar sí o sí. No sigas.

**11. (juntos, 3 min) Configurar el webhook.** La app → WhatsApp → Configuration → Webhook → Edit, con la callback URL y el verify token; después suscribirse al campo `messages` y solo a ese. O por API, que evita el error de tipeo:
```bash
curl -X POST "https://graph.facebook.com/v21.0/$APP_ID/subscriptions" \
  -d "object=whatsapp_business_account" \
  -d "callback_url=$BASE/webhooks/whatsapp" \
  -d "verify_token=$VERIFY" \
  -d "fields=messages" \
  -d "access_token=$APP_ID|$APP_SECRET"
```

**12. (dev, 1 min) Suscribir la app a la cuenta de WhatsApp. SIN ESTO NO LLEGA NINGÚN MENSAJE.**
```bash
curl -X POST "https://graph.facebook.com/v21.0/$WABA_ID/subscribed_apps" \
  -H "Authorization: Bearer $TOKEN"
# esperado: {"success":true}
```
Es un paso aparte del webhook, la consola no lo pide y no da ningún error: el webhook queda verificado, el token manda mensajes, y los entrantes nunca aparecen. Es el que más se olvida.

**13. (dev, 2 min) Confirmar el canal, con el switch todavía APAGADO.**
```bash
curl -s "$BASE/health" | jq '.channels'
# whatsapp: configured:true, ok:true, con el nombre del local en el detalle
```
Con el switch apagado el bot **no contesta**, pero los mensajes entrantes **igual se guardan** y aparecen en la bandeja, y las chicas **sí pueden contestar a mano**.

**14. (dev, 7 min) Prueba entrante real y prender el bot.** Escribirle al número desde otro celular, contestar a mano desde el panel, y recién ahí prender el switch en **Ajustes → Canales**.
*Verificación: mandar "hola, ¿a qué hora abren?" y que conteste el bot.*

**15. (juntos, 20 min) Capacitación del panel**, con las chicas que atienden. Bandeja, cómo se toma una conversación a mano, mensajes rápidos, Pedidos, la Comanda, y dónde está el switch de Canales.
*Verificación: que una de ellas conteste una conversación de prueba sola, sin que le digan dónde hacer clic.*

---

## 4. Verificación de punta a punta

```bash
export BASE=https://vps.marcorossi.com.ar/miska-bot
export TOKEN=EAAG... PHONE_ID=... WABA_ID=... VERIFY=...
```

| # | Qué se prueba | Resultado esperado |
| --- | --- | --- |
| 1 | `systemctl status miska-bot --no-pager` | `active (running)` |
| 2 | `curl -s "$BASE/health" \| jq '.channels'` | whatsapp `configured:true, ok:true` con el nombre aprobado |
| 3 | `GET /v21.0/$PHONE_ID?fields=display_phone_number,verified_name,quality_rating` | El número del local, el nombre, calidad `GREEN` |
| 4 | Access Token Debugger de Meta | Expires **Never**, con los dos permisos |
| 5 | `GET /v21.0/$WABA_ID/subscribed_apps` | La app listada |
| 6 | Handshake con el verify token correcto | `hola`, exacto |
| 7 | Handshake con un token cualquiera | `403` |
| 8 | **La firma se valida** (ver abajo) | `401` |
| 9 | Entra un mensaje real desde otro celular | Aparece en la bandeja en menos de 3 s |
| 10 | "¿a qué hora abren?" | Contesta con el horario del local |
| 11 | Contestar desde el panel | Llega al celular, sellado como 👤 local |
| 12 | **Mandar una foto al número** | Se ve la imagen en la burbuja, no "[imagen]" |
| 13 | Pedirle la foto de un producto | Llega la imagen, no un link roto |
| 14 | Tomar un pedido completo | Aparece en Pedidos y en la Comanda, con el teléfono cargado |
| 15 | `journalctl -u miska-bot -n 100 \| grep -iE 'error\|warn'` | Nada de WhatsApp |

**Prueba 8 — la firma:**
```bash
curl -s -o /dev/null -w '%{http_code}\n' -X POST "$BASE/webhooks/whatsapp" \
  -H 'content-type: application/json' \
  -H "x-hub-signature-256: sha256=$(printf '%064d' 0)" \
  -d '{"object":"whatsapp_business_account","entry":[]}'
# esperado: 401
```
Si devuelve **200**, el app secret quedó vacío y el webhook está abierto. Es la única prueba que, si falla, obliga a apagar y arreglar en el momento.

**Lo que no se va a poder verificar, y conviene decirlo:** mandar una plantilla desde el sistema (no se puede todavía), los tildes de entregado y leído (los estados llegan pero no se guardan), y el "escribiendo…" (en WhatsApp viaja pegado al acuse de lectura).

---

## 5. Si algo sale mal

| Problema | Qué se hace | Cuánto tarda |
| --- | --- | --- |
| El SMS no llega | Verificación **por voz**. No reintentar SMS: cada intento cuenta contra el tope de 10 en 72 h | 5-10 min |
| Se agotaron los 10 intentos (**133016**) | No hay atajo: el número queda bloqueado **72 horas**. Contingencia: publicar otro número en Instagram y avisar en el local | 3 días |
| El PIN no anda | Si el número tenía 2FA, hay que mandar *ese* PIN. Si nadie lo sabe, se resetea desde WhatsApp Manager → Two-step verification → Change PIN | 10 min a horas |
| **El webhook figura verificado y no llega ningún mensaje** | Las dos causas, las dos silenciosas: falta el `POST /subscribed_apps` del paso 12, o al usuario del sistema le falta el activo "Cuentas de WhatsApp" | 15 min |
| **Al buscar el número aparece "Invitar"** | Quedó `PENDING`: falta el `/register` del paso 8 | 3 min |
| Meta no valida la callback URL | El verify token no coincide carácter por carácter, o el bot está caído. Correr la prueba 6 | 5 min |
| `(#200) Permissions error` | La cuenta de WhatsApp no está asignada al usuario del sistema, o la app está en otro portafolio | 10 min |
| `190 access token expired` | Quedó el token temporal de 24 h. Regenerar el del usuario del sistema con expiración Nunca — **y esto necesita a una dueña** | 10 min + coordinar |
| El bot contesta mal o de más | Apagar el switch en Ajustes → Canales. **Apagar el switch no apaga el webhook**: Meta sigue mandando y el servidor sigue guardando, solo deja de responder el bot | 30 s |
| Volver a la app del celular | `POST /$PHONE_ID/deregister` → instalar WhatsApp Business → verificar por SMS. **No vuelven el historial, los grupos ni el catálogo** | 30-60 min |

**Regla de oro del día:** si a las dos horas del paso 5 el número no recibe mensajes, **parar**. Cada intento fallido acerca el bloqueo de 72 horas. Retomar al día siguiente con el contador en cero.

Sobre volver atrás: Meta documenta que el deregister deja el número disponible para volver a registrarlo y que el cambio es inmediato. Al menos un proveedor afirma lo contrario. Le creo a Meta, pero **no jures que la vuelta atrás es cien por ciento segura**.

---

## 6. Después

### Los dos agujeros de código que quedan

| Qué falta | Impacto | Estimación |
| --- | --- | --- |
| **Mandar plantillas.** El adaptador ya las serializa; falta que algo genere el contenido, que el endpoint del panel lo acepte, y una pantalla para elegir plantilla y completar variables. Además solo arma el cuerpo con parámetros posicionales: no soporta encabezado ni botones | Sin esto no se puede escribir fuera de las 24 h, ni hacer campañas | 2-3 días |
| **Reintentos de envío.** El envío hace un `fetch` y listo: ni espera ni reintento ante 429 o 5xx, y WhatsApp tira 429 más fácil que Telegram con un número nuevo | Mensajes que no salen y el cliente no se entera | medio día |

*(El de los comprobantes entrantes se cerró el 29/08.)*

### 1 de octubre de 2026 — quedan 32 días

Meta pasa a cobrar **por mensaje**, también dentro de la ventana de 24 h. Consecuencia directa sobre el código: **si el bot parte una respuesta en tres globitos, eso pasa a costar el triple.** Consolidar respuestas donde se pueda es la optimización con mejor retorno, y hay que hacerla antes de esa fecha. Las tarifas exactas se publican **antes del 1 de septiembre**: hay que mirarlas y rehacer la cuenta.

### Trámites que siguen corriendo

- **Verificación del negocio**, si no salió. Sin ella el tope es 250 destinatarios únicos cada 24 h para conversaciones **iniciadas por el local**; responder no cuenta y es ilimitado. Tiene que estar antes de la primera campaña de fecha especial.
- **Plantillas**: confirmar que quedaron aprobadas y en qué categoría.
- **Límites**: suben solos, 250 → 2.000 → 10.000 → 100.000, si la calidad se mantiene.

### La primera semana

```bash
journalctl -u miska-bot --since today | grep -iE 'whatsapp|131047|131026|firma|429'
curl -s "$BASE/health" | jq '.channels'
```
Y en Meta, el *quality rating*: *Connected* es normal, *Flagged* es que la calidad cayó y hay 7 días para recuperarla, *Restricted* es que se llegó al tope del escalón.

Mientras el bot solo **responda** a quien escribió primero, el riesgo de que Meta baje el número es casi nulo. Aparece el día que alguien mande promoción a toda la agenda: **dejar acordado por escrito que cualquier envío masivo pasa antes por el dev.**

---

## 7. Lo que va a costar

Supuestos: 300 conversaciones por mes iniciadas por el cliente, 6 mensajes salientes promedio, 100 avisos de "pedido listo".

| Concepto | Hasta el 30/09 | Desde el 01/10 |
| --- | --- | --- |
| Mensajes entrantes | Gratis | Gratis |
| Respuestas dentro de las 24 h (~1.800) | **Gratis, sin tope** | Se cobran por mensaje |
| 100 avisos de "pedido listo" | Gratis si caen en la ventana | Se cobran por mensaje |
| **Total mensual estimado** | **Prácticamente cero** | **USD 20 a 90**, según la tarifa que publiquen |

Los números de octubre son estimativos y vencen el 1 de septiembre: bajar el rate card oficial, y el de **ARS**, porque el peso es moneda de facturación y puede no ser dólares por tipo de cambio.

**La única palanca real para bajar la factura:** las conversaciones que entran por un anuncio con botón a WhatsApp abren una ventana gratuita de 72 horas, y **eso sigue gratis después de octubre**. Si ya hacen publicidad en Instagram, vale la pena decírselo.

Una campaña de marketing a 500 clientes cuesta más que todo el resto del mes junto: segmentar, no disparar a toda la base.

---

## Apéndice — lo que se descartó, por si hay que volver

- **Arrancar con un número nuevo** y dejarles la app funcionando, migrando el de siempre a las dos o cuatro semanas. Era la recomendación original, por tres razones: los comprobantes no se veían *(resuelto)*, no se pueden mandar plantillas *(sigue en pie)*, y el punto de no retorno tiene un modo de falla de tres días *(sigue en pie, y por eso el paso 5 se hace con todo lo demás listo)*.
- **Coexistence**, el mismo número en la app y en la API a la vez. Exige entrar como socio de Meta o meter un intermediario con su facturación; además no funcionan catálogo, listas de difusión, respuestas rápidas ni etiquetas, y hay que abrir la app cada dos semanas o el vínculo se corta. Sería el camino si algún día perder la app resulta inaceptable.
- **Que el dev quede como administrador del portafolio.** Descartado por decisión del 30/08. La contra está arriba: nada del lado de Meta se puede resolver sin coordinar una sesión con ellas.
