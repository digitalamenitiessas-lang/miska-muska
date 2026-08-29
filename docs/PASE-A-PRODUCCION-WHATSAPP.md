# Pase a WhatsApp — guía del día

**Miska Muska · 30/08/2026 · para seguir en vivo, de arriba hacia abajo**

Se crea **todo en la reunión**, desde cero, en la computadora y la cuenta de la dueña. Va el número que ella ya usa en WhatsApp Business.

`DUEÑA` = lo hace ella, es su cuenta y su contraseña · `DEV` = lo puede hacer él desde el teclado · **⬛ GUARDAR** = valor que se copia en el momento, no después.

Versión en pantalla: https://claude.ai/code/artifact/8a93dd83-36b3-4f6d-a4a5-96b312526941

> **La pregunta que va a hacer apenas se siente: sí, hoy el bot puede quedar contestando.** Nada de lo necesario exige la verificación del negocio. Lo que no se termina hoy: esa verificación (hasta 14 días hábiles) y el salto de 250 a 2.000 mensajes iniciados por el local. Ninguna de las dos frena a un bot que *responde*.
>
> **Bloquear 4 horas.** El trabajo real son 2 h 30 a 3 h.

---

## Antes de sentarse

- [ ] La **constancia de inscripción de ARCA** (nombre legal, CUIT, domicilio fiscal), en PDF
- [ ] Un **mail del negocio** al que pueda entrar durante la reunión
- [ ] **El celular con el chip del número**, cargado y a mano — le van a llegar varios códigos
- [ ] Que entre a Facebook con **su perfil de siempre**, no uno nuevo
- [ ] El sitio web del local, **si abre bien y es HTTPS**. Si está roto, mejor no cargarlo
- [ ] Del lado del dev: el verify token ya generado en el servidor (el comando está en **Los comandos**)

> ⚠ **No abrir una cuenta de Facebook nueva "para el negocio".** Los portafolios creados desde perfiles recién nacidos aparecen restringidos seguido. Es folklore de agencias, no doc de Meta, pero el costo de equivocarse son días.
>
> ⚠ **Meta deja crear hasta dos portafolios por persona.** Si ella creó uno hace años y se olvidó, queda uno de margen. Mirar el selector de arriba a la izquierda en `business.facebook.com` antes de crear nada.

---

## Parte 1 · Crear todo en Meta

### 1. Portafolio comercial — `DUEÑA` · 10 min

1. `business.facebook.com` → menú desplegable arriba a la izquierda → **"Crear portfolio comercial"**
2. Nombre del portfolio: **`Miska Muska`** — sin caracteres especiales
3. Nombre, apellido y **mail del negocio**
4. **"Crear"** → abrir el mail y **confirmar la dirección**

> En la consola dice **"portfolio"**, con f. Buscando "portafolio" no aparece.
> Si no ves el desplegable, Meta rota esa pantalla: buscá cualquier botón que diga "Crear cuenta" o "Crear portfolio".

**⬛ GUARDAR** — el ID del portafolio (Configuración del negocio → Información del portfolio comercial)

### 2. Datos del negocio — `DUEÑA` · 10 min · **NO SALTEAR**

Configuración del negocio → **"Información del negocio"** → **"Editar"**

5. **Nombre legal** → el de la constancia de ARCA. **No es "Miska Muska"**: si es monotributo, es el nombre y apellido de ella
6. **Dirección** → el domicilio fiscal, letra por letra
7. **Teléfono** → uno donde reciba SMS
8. **Identificación fiscal** → el **CUIT** (el campo puede figurar como "Tax ID" o "EIN")
9. Sitio web solo si abre bien y es HTTPS
10. **"Guardar"**

> ⚠ **Este bloque se hace ANTES de que exista la cuenta de WhatsApp.** Meta avisa: *"es posible que no puedas hacer clic en Editar si el portfolio comercial se usa para una cuenta de WhatsApp Business"*. Cargado después, el botón puede estar muerto y la verificación queda trabada semanas.
>
> ⚠ Si el nombre legal dice "Miska Muska", **la verificación se rechaza seguro**: ningún documento lo va a decir. El nombre de fantasía va en el portfolio y en el nombre visible de WhatsApp, no acá.

### 3. Registro de desarrollador — `DUEÑA` · 10 min

11. `developers.facebook.com` → **"Continuar con Facebook"** → **"Siguiente"** para aceptar las condiciones
12. Meta manda **un código al teléfono y otro al mail** → cargar los dos
13. Elegir cualquier ocupación

### 4. Crear la app — `DUEÑA` · 15 min

14. `developers.facebook.com/apps` → **"Crear app"**
15. Nombre: `Miska Muska Bot` · mail de contacto → **"Siguiente"**
16. Caso de uso: **"Conectarse con los clientes a través de WhatsApp"** → **"Siguiente"**
17. **"Selecciona un portfolio comercial"** → elegir **Miska Muska**
18. Requisitos de publicación (va a estar casi vacío) → **"Siguiente"** → **"Crear app"** → pide la contraseña de Facebook

**⬛ GUARDAR** — el **identificador de la app** (arriba en el panel)

### 5. La cuenta de WhatsApp — `DEV` · 10 min

19. **"Comenzar a usar la API"** → lleva a **"Configuración de la API"**
20. En el desplegable de cuenta de WhatsApp va a haber una **de prueba, creada sola**. Clic en **"Crear una cuenta de WhatsApp Business"** para crear **la que va a tener el número del local**

> ⚠ **Crearla acá, no después.** Si más adelante agregás el número real desde esta misma pantalla, Meta **genera otra WABA** y terminás con varias cuentas y ningún ID que sirva. La de prueba se ignora: queda ahí y no molesta.

**⬛ GUARDAR** — `WABA_ID` (el de la cuenta nueva, **no** el de la de prueba)

### 6. Usuario del sistema y token — `DUEÑA` · 20 min

21. `business.facebook.com/settings` → **"Usuarios"** → **"Usuarios del sistema"** → botón azul
22. Nombre: `Bot Miska Muska`, rol **administrador**
23. Clic sobre el nombre → **"Asignar activos"**
24. Columna izquierda **"Apps"** → tildar la app → **"Control total"** → activar **"Administrar la app"**
25. Columna izquierda **"Cuentas de WhatsApp"** → tildar **la cuenta del paso 20** → **"Control total"** → activar **"Administrar cuentas de WhatsApp Business"** → **"Asignar activos"**
26. **"Generar nuevo token"** → elegir la app → permisos **`whatsapp_business_messaging`** y **`whatsapp_business_management`** → expiración **"Nunca"**

> ⚠ **Los DOS activos, no uno.** Con solo la app, el token manda mensajes, todo se ve verde, **y los webhooks nunca llegan**. No da ningún error. Le costó una hora al bot de Turismo.
>
> ⚠ **Copiar el token antes de cerrar la ventana.** No se puede volver a ver: si se cierra, hay que generar otro.
>
> Este token **no hay que regenerarlo cuando entre el número.** Se emite contra la app y la cuenta de WhatsApp, y el número es hijo de esa cuenta: agregarlo después no lo invalida. Lo único que cambia más adelante es el `PHONE_NUMBER_ID` del `.env`.

**⬛ GUARDAR** — el **token**

27. `DEV` — App secret: la app → **"Configuración de la app" → "Básica"** → **"Clave secreta de la app"** → **"Mostrar"**

**⬛ GUARDAR** — el **app secret**

### 7. Comprobar el token antes de seguir — `DEV` · 5 min

28. `developers.facebook.com/tools/debug/accesstoken/` → pegar el token → **"Depurar"**

Tiene que decir **Caduca: Nunca** y listar los dos permisos. Si dice una fecha, se generó mal.

---

## Parte 2 · Dejar todo conectado, todavía sin número

Va directo el número real, sin pasar por el de prueba. Pero **todo lo que no depende del número se deja probado antes de tocar el celular**: el webhook, las credenciales y la suscripción no necesitan que exista ningún número, y son la mayor parte de lo que puede salir mal por configuración.

29. `DEV` — Cargar en `/opt/miska-muska/.env` el **token**, el **app secret** y el **verify token**. El `PHONE_NUMBER_ID` se deja vacío por ahora. Reiniciar.
30. `DEV` — Probar el handshake (comandos abajo): tiene que imprimir `hola`
31. `DEV` — Webhook: menú **"Configuración"** → sección Webhooks → **"Editar"** → pegar la URL y el verify token → **"Verificar y guardar"** → **"Campos de webhooks" → "Administrar"** → tildar **`messages`**
32. `DEV` — **Suscribir la app a la cuenta de WhatsApp** (comando abajo) y confirmarlo con el GET
33. `DEV` — En el panel de apps, botón **"Modo"**: que esté en **Activo**, no en Desarrollo

> ⚠ **El paso 32 no lo pide la consola y no da error.** Sin él, el webhook figura verificado, el token manda mensajes, y no llega un solo mensaje entrante. Es el que más se olvida.
>
> Con el `PHONE_NUMBER_ID` vacío, `/health` va a decir `configured:false` y el switch del panel va a estar deshabilitado. **Es lo esperado y no impide nada de esta parte**: el handshake solo mira el verify token, y el adaptador existe aunque el canal no esté completo.

**Salió bien si:** el handshake devuelve `hola`, Meta aceptó la URL, y el GET de `subscribed_apps` lista la app.

> **Lo que queda sin probar hasta después del punto de no retorno** es que entre un mensaje de verdad. Es el precio de ir directo al número real: si algo falla, se falla con el WhatsApp del local ya borrado. Por eso los pasos 29 a 33 se hacen **antes**, y por eso el paso 42 se corre una sola vez y bien.

---

## Antes de borrar la cuenta del celular, decírselo

- La app de WhatsApp Business **de ese número deja de existir**. Todo pasa al panel.
- **Se pierde el historial**, y la copia en Google Drive se borra con la cuenta. Solo sobrevive lo exportado por mail.
- **El número sale de todos los grupos.** Las listas de difusión se pierden.
- **El catálogo, el mensaje de ausencia y las respuestas rápidas de la app se van.** Eso ahora lo hace el bot.
- **Pasadas 24 h del último mensaje del cliente, no se le puede escribir** — ni el bot ni ellas. Se arregla con plantillas, que **no** entran en este pase.
- **Los comprobantes sí se ven** en el panel. Eso quedó resuelto.

**Terminar con un sí en voz alta.**

---

## Parte 3 · El número real

35. `DUEÑA` — **Exportar por mail** los chats que importen (menú → Más → Exportar chat → Incluir archivos). **Sin ese mail no se sigue.**
36. `DUEÑA` — Capturas del catálogo; dejar otro admin en los grupos
37. `DUEÑA` — **¿Verificación en dos pasos activada?** Si sí, **anotar el PIN ahora**. Si nadie lo sabe, desactivarla desde la app **antes** de borrar

**⬛ GUARDAR** — el **PIN de 6 dígitos**

### ⛔ 38 · PUNTO DE NO RETORNO — `DUEÑA`

WhatsApp Business → **Configuración → Cuenta → "Eliminar mi cuenta"**, con código de país.

- Meta tarda **hasta 3 minutos** en liberar el número.
- **Que no desinstale la app**: eso no borra la cuenta y el número sigue ocupado.
- **10 intentos de registro cada 72 h.** Pasado eso el número queda bloqueado **3 días**, con la cuenta ya borrada. Si el SMS no llega en 2 minutos: **verificación por voz**, no reintentar SMS.

39. `DUEÑA` — `business.facebook.com` → **"Todas las herramientas" → "Administrador de WhatsApp"** → elegir **la cuenta del paso 20**, no la de prueba → **"Números de teléfono" → "Agregar número de teléfono"**
40. `DUEÑA` — **Nombre visible** (`Miska Muska`) y **categoría** del negocio → **"Siguiente"**
41. `DUEÑA` — El número y la forma de verificación (SMS o llamada) → cargar los 6 dígitos que llegan

**⬛ GUARDAR** — `PHONE_NUMBER_ID`

42. `DEV` — **Registrar el número con el PIN** (comando abajo). Meta: *"solo puedes registrar un número a través de la API"*. **Una sola vez y bien**: son 10 intentos cada 72 h
43. `DEV` — Completar `WHATSAPP_PHONE_NUMBER_ID` en el `.env` — es el **único** valor que faltaba. Reiniciar
44. `DEV` — `/health` tiene que devolver `configured:true, ok:true` con el nombre del local en el detalle
45. `DEV` — Desde un celular ajeno, escribirle al número del local

---

## Los comandos

```bash
export BASE=https://vps.marcorossi.com.ar/miska-bot
export TOKEN=EAAG...      # token del usuario del sistema
export PHONE_ID=...       # recién existe después del paso 41
export WABA_ID=...        # el del paso 20
export VERIFY=...         # el generado en el servidor
```

**Handshake** — antes de tocar el formulario de Meta:

```bash
curl -s "$BASE/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=$VERIFY&hub.challenge=hola"
```

**Suscribir la app a la cuenta de WhatsApp** — paso 32:

```bash
curl -X POST "https://graph.facebook.com/v21.0/$WABA_ID/subscribed_apps" \
  -H "Authorization: Bearer $TOKEN"
```

**Registrar el número** — paso 42:

```bash
curl -s -X POST "https://graph.facebook.com/v21.0/$PHONE_ID/register" \
  -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"messaging_product":"whatsapp","pin":"123456"}'
```

**Las cinco variables**, en `/opt/miska-muska/.env` (backup antes, `chmod 600` después):

```
WHATSAPP_ACCESS_TOKEN=EAAG...
WHATSAPP_PHONE_NUMBER_ID=...
WHATSAPP_VERIFY_TOKEN=...
WHATSAPP_APP_SECRET=...
WHATSAPP_GRAPH_VERSION=v21.0
```

`WHATSAPP_APP_SECRET` **no es opcional**: vacío, el bot acepta webhooks sin validar la firma y nada lo avisa.

**Generar el verify token** — el dev, antes de la reunión:

```bash
ssh root@2.25.185.242 'cd /opt/miska-muska && cp .env .env.bak && TOKEN=$(openssl rand -hex 32) && sed -i "s|^WHATSAPP_VERIFY_TOKEN=.*|WHATSAPP_VERIFY_TOKEN=$TOKEN|" .env && chmod 600 .env && systemctl restart miska-bot && echo "VERIFY_TOKEN=$TOKEN"'
```

---

## Verificación final

```bash
curl -s "$BASE/health" | jq '.channels'      # configured:true, ok:true
curl -s "https://graph.facebook.com/v21.0/$WABA_ID/subscribed_apps" -H "Authorization: Bearer $TOKEN"
```

- [ ] Entra un mensaje real desde otro celular → aparece en la bandeja en menos de 3 s
- [ ] El bot contesta «¿a qué hora abren?»
- [ ] Contestar desde el panel → llega al celular
- [ ] **Mandar una foto** → se ve la imagen, no `[imagen]`
- [ ] Pedirle la foto de un producto → llega la imagen
- [ ] Tomar un pedido completo → aparece en Pedidos y en la Comanda
- [ ] La firma del webhook rechaza → **401**

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
| `131037` al mandar | El nombre visible todavía no está aprobado | **No hay nada roto y nada que tocar.** Todo queda hecho y el bot arranca solo cuando Meta lo aprueba. Meta no publica plazo: entre 24 h y varios días. **No le prometas una fecha a la dueña** |
| El SMS no llega | — | Verificación **por voz**. No reintentar SMS |
| `133016` | Se agotaron los 10 intentos de registro | **72 h bloqueado.** Publicar otro número en Instagram y avisar en el local |
| `133006` al mandar | El número no está registrado | El `/register` del paso 42 |
| Aparece «Invitar» al buscar el número | Quedó `PENDING`, mismo caso | Ídem |
| Webhook verificado y no llega nada | Falta el `subscribed_apps`, o falta el activo «Cuentas de WhatsApp» | Los dos son silenciosos: revisar ambos |
| Meta no valida la callback URL | Verify token distinto, o el bot caído | Correr el handshake |
| `(#200) Permissions error` | La WABA no está asignada al usuario del sistema | Asignar el activo |
| `190 access token expired` | Quedó un token temporal | Regenerar el permanente — **necesita a la dueña** |
| «No cumple los requisitos para la verificación» | Portafolio recién creado | **No pasa nada.** El bot funciona igual; se reintenta más adelante |
| El bot contesta mal | — | Apagar el switch en Ajustes → Canales. **No apaga el webhook**: los mensajes se siguen guardando |
| Volver atrás | — | `POST /$PHONE_ID/deregister` → reinstalar la app → verificar por SMS. **No vuelven historial, grupos ni catálogo** |

**Regla de oro:** si a las dos horas del paso 38 el número no recibe mensajes, **parar**. Cada intento fallido acerca el bloqueo de 72 h. Retomar al día siguiente.

---

## Antes de irse

- [ ] **Método de pago** cargado — Configuración del negocio → **"Pagos"**. Responder dentro de las 24 h hoy no cuesta, pero varios proveedores reportan que sin medio de pago los números se desactivan. Son 10 minutos y saca la duda
- [ ] **Verificación del negocio** iniciada — Configuración → **"Centro de seguridad"** → **"Iniciar verificación"**, con la constancia de ARCA. **Decile "hasta 14 días hábiles"**, que es lo que Meta se compromete a sostener. Y aclarale que **no es el tilde azul**, que es otra cosa
- [ ] Las credenciales pasadas por un canal privado y **borradas de ahí**
- [ ] El **PIN** anotado en dos lugares: el gestor del dev y uno de ella
- [ ] Capacitación del panel con las chicas que atienden — que una conteste una conversación sola

> La constancia de ARCA sirve para la verificación porque **la emite el fisco, no el negocio**: Meta rechaza los documentos fiscales emitidos por uno mismo. Una factura de Miska Muska no sirve.
>
> ⚠ Si después editan los datos del negocio, **hay que rehacer la verificación**. Cargarlos bien la primera vez.

---

## Después

- **Sin plantillas no se puede escribir fuera de las 24 h.** Es la limitación abierta; implementarlo son 2-3 días de trabajo cuando lo decidan.
- **1 de octubre:** Meta pasa a cobrar por mensaje, también dentro de las 24 h. Si el bot parte una respuesta en tres globitos, cuesta el triple: hay que consolidar respuestas antes de esa fecha.
- **Envíos masivos:** son lo único que puede hacer que Meta baje el número. Dejar acordado que pasan antes por el dev.
- Primera semana: `journalctl -u miska-bot --since today | grep -iE 'whatsapp|429'` y el *quality rating* en el Administrador de WhatsApp.

<details>
<summary>Lo que se descartó, por si hay que volver</summary>

- **Número nuevo primero**, migrando el de siempre a las 2-4 semanas. Era la recomendación original: los comprobantes no se veían *(resuelto)*, no hay plantillas *(sigue)*, y el punto de no retorno tiene un modo de falla de 3 días *(sigue, y por eso todo lo demás se prueba antes)*.
- **Coexistence** (el mismo número en la app y en la API): exige socio de Meta o un intermediario con su facturación, y deja sin catálogo, listas de difusión, respuestas rápidas ni etiquetas.
- **El dev como admin del portafolio.** La contra: nada del lado de Meta se resuelve sin coordinar una sesión con ella.

</details>
