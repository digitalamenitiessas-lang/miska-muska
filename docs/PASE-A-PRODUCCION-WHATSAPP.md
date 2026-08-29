# RUNBOOK — Pase a producción de WhatsApp Cloud API
**Miska Muska · 29/08/2026 · lector: el desarrollador**

> Versión para leer en pantalla, con el mismo contenido:
> https://claude.ai/code/artifact/8a93dd83-36b3-4f6d-a4a5-96b312526941
>
> Las afirmaciones sobre el comportamiento del sistema están verificadas contra el archivo y la línea
> que se citan, sobre el commit `d760ce4`. Las que dependen de Meta salen de su documentación y pueden
> haber cambiado; donde una fuente contradice a otra, está dicho en el texto en vez de resuelto de prepo.
>
> **Actualizado el 30/08/2026** con lo aprendido del runbook del **Bot de Turismo SMT** (equipo DIA,
> despliegue del 25/08/2026), que hizo este mismo trámite en Meta hace unos días. De ahí salen el paso
> 16B-bis y las dos fallas silenciosas de la tabla de problemas. Su infraestructura es otra —Nginx y PM2
> en el VPS compartido del municipio— así que la parte de despliegue no se toma de ahí. Y su documento no
> cubre el caso nuestro: migrar un número que hoy está en la app de WhatsApp Business.

### Verificado en vivo contra el servidor, el 29/08/2026

| Qué | Estado | Cómo se comprobó |
| --- | --- | --- |
| El webhook responde a través del subpath de Caddy | OK | `GET /miska-bot/webhooks/whatsapp` con un token falso devuelve **403**: la ruta existe y valida. `handle_path` le saca el prefijo antes de proxear |
| El canal WhatsApp | Sin credenciales | `/health` devuelve `configured:false`. Las cinco variables están declaradas y vacías en el `.env` del VPS |
| El panel | Cerrado | `GET /api/settings` sin token devuelve **401**. `ADMIN_TOKEN` está puesto |

URL exacta para el formulario de Meta:

```
https://vps.marcorossi.com.ar/miska-bot/webhooks/whatsapp
```

Este documento se abre en la reunión. Los pasos están numerados para seguirlos en vivo. Cada uno dice quién lo hace, qué se toca y cómo se verifica antes de pasar al siguiente.

**Dato duro de contexto, arriba de todo:** hoy el sistema **no muestra las fotos entrantes**. Un comprobante de transferencia llega al panel como el texto `[imagen]` y nada más — ni el bot lo lee, ni las chicas lo ven (`ingress.ts:56-70` guarda `{kind:'image', mediaId}` sin URL; `Inbox.tsx:486-492` solo renderiza si el payload trae `url`; `downloadMedia()` existe en `adapter.ts:350` y **no lo llama nadie**). Eso condiciona la decisión de la sección 8 y hay que decirlo antes de prometer nada.

---

## 1. Antes de la reunión

Nada de lo que tenga demora de Meta se hace el día de la reunión. La reunión no es para esperar aprobaciones.

### 1.1 Reunión cero — 10 a 14 días antes (DEV + una dueña, 30 minutos, puede ser por videollamada)

No se puede hacer sin ellas: el portfolio de Meta **tiene que crearlo la dueña**, no el dev. Si lo crea el dev, la WABA queda a su nombre y **no se transfiere nunca** (Meta lo documenta explícito; el único camino de salida es deregistrar el número, crear otra WABA y volver a empezar, perdiendo nombre aprobado, plantillas, quality rating y tier).

| # | Quién | Qué se hace | Dónde | Verificación |
|---|---|---|---|---|
| 0.1 | **CLIENTE** | Cuenta personal de Facebook de una dueña, con 2FA activada | facebook.com | Le llega el código al celular al entrar |
| 0.2 | **CLIENTE** | Crear el Meta Business Portfolio con nombre legal, domicilio y teléfono **tal cual figuran en la constancia de ARCA** | business.facebook.com | El portfolio aparece en el selector |
| 0.3 | **CLIENTE** | Agregar una segunda dueña como administradora | Configuración del negocio → Usuarios → Personas | Dos admins listados, ambas con 2FA |
| 0.4 | **CLIENTE** | Agregar al dev como Persona con rol admin (no como socio: eso pide portfolio verificado del dev) | Mismo lugar | Al dev le llega la invitación y entra |
| 0.5 | **CLIENTE** | Arrancar **verificación del negocio** con constancia de ARCA + factura de servicios o resumen bancario | Configuración del negocio → Centro de seguridad → Verificación del negocio | Estado "en revisión". **Tarda 1 a 5 días hábiles, puede irse a 14** |
| 0.6 | **DEV** | Crear la app en developers.facebook.com con caso de uso WhatsApp, **dentro del portfolio del cliente** | developers.facebook.com | En Settings → Basic, el campo de negocio muestra el portfolio del local, no el del dev |

Si la app queda en el portfolio del dev y la WABA en el del cliente, todas las llamadas de gestión devuelven `(#200) Permissions error` y hace falta App Review + ser Tech Provider. Con app y WABA en el mismo portfolio alcanza el Acceso Estándar, que ya viene aprobado.

### 1.2 Lo que el DEV deja probado con un chip nuevo (los días previos)

Comprar un chip prepago y hacer **todo el alta técnica** con ese número. Es la única forma de que el día de la reunión no haya sorpresas, y de paso es el número de pruebas para siempre.

1. Agregar el número de prueba a la WABA (WhatsApp Manager → agregar número → verificación por SMS o voz), definir el **PIN de 6 dígitos** y anotarlo en el gestor de contraseñas.
2. Crear el **System User** en Configuración del negocio → Usuarios → Usuarios del sistema, asignarle **la app y la WABA** (control total en las dos), y generar token con expiración **Nunca** y permisos `whatsapp_business_messaging` + `whatsapp_business_management`. Verificarlo en el Access Token Debugger: tiene que decir *Never* y listar los dos scopes.
3. Cargar las cinco variables en el `.env` del VPS, apuntar el webhook al bot, suscribirse a `messages` y correr **toda la sección 4 de este documento** con el chip. Si algo del código está mal, se descubre acá y no con el número del local muerto.
4. Revisar la versión de Graph. `WHATSAPP_GRAPH_VERSION=v21.0` es de octubre de 2024 y está al borde de la deprecación. Subila a la versión más nueva que ofrezca el selector de la app y repetí las pruebas. Es una variable y un restart, no toca código. **No pongas un número de versión de memoria: leelo del panel de Meta.**
5. Dejar la deuda técnica medida (ver sección 6) para poder responder cuánto tarda cada agujero si preguntan.

### 1.3 Plantillas — crearlas ahora, aprobación de hasta 24 h

**DEV**, en WhatsApp Manager → Plantillas de mensajes. Idioma `es_AR`, categoría UTILITY salvo la última. Reglas de formato que evitan el `INVALID_FORMAT`: variables secuenciales sin saltos, ninguna al principio ni al final del cuerpo, nunca dos pegadas, y texto real alrededor de cada una.

| Nombre | Categoría | Cuerpo |
|---|---|---|
| `pedido_confirmado` | UTILITY | ¡Gracias {{nombre}}! Recibimos tu comprobante y tu pedido {{numero_pedido}} quedó confirmado. Lo vas a poder retirar el {{fecha}} a partir de las {{hora}}. Si necesitás cambiar algo, escribinos por acá. |
| `pedido_listo_retiro` | UTILITY | Hola {{nombre}}, tu pedido {{numero_pedido}} ya está listo para retirar en {{direccion}}. Te esperamos hoy hasta las {{hora_cierre}}. Si no llegás a pasar, avisanos por acá y lo guardamos. |
| `pedido_en_camino` | UTILITY | Hola {{nombre}}, el cadete ya salió con tu pedido {{numero_pedido}} y va para {{direccion}}. Calculamos que llega en unos {{minutos}} minutos. Si podés, tené el timbre a mano. |
| `inscripcion_curso_confirmada` | UTILITY | ¡Bienvenida {{nombre}}! Tu inscripción al curso de {{curso}} quedó confirmada. Nos vemos el {{fecha}} a las {{hora}} en {{direccion}}. Llevá delantal y algo para tomar nota. |
| `retomar_consulta` | UTILITY | Hola {{nombre}}, quedamos con tu consulta sobre {{tema}} sin responder a tiempo y no queremos dejarte colgada. Seguimos por acá: respondé este mensaje y lo retomamos ahora mismo. |
| `campana_fecha_especial` | MARKETING | Hola {{nombre}}, ya abrimos los encargues por {{ocasion}} en Miska Muska. Podés reservar tortas y mesas dulces hasta el {{fecha_limite}}, y este año sumamos opciones nuevas. Contestá este mensaje y armamos el tuyo. |

Ninguna utility puede llevar "oferta", "descuento", "aprovechá", "mirá también", ni botón "Ver catálogo": eso la recategoriza a MARKETING, que en toda tarifa vigente sale **varias veces más caro** que utility. Desde abril de 2025 Meta **no rechaza** por eso, te la aprueba como marketing y avisa por el webhook `template_category_update` — o sea, te enterás por la factura.

**Aclaración incómoda que hay que tener presente:** el sistema hoy **no puede mandar plantillas**. El adaptador las serializa (`adapter.ts:308-324`) pero nada en el pipeline genera un contenido `template`, y el endpoint de respuesta manual del panel solo acepta texto (`routes.ts:157-167`). Se crean igual, porque la aprobación tarda y porque son el requisito para todo lo que venga después. No confirmé si desde WhatsApp Manager se puede disparar una plantilla suelta a un cliente sin pasar por la API: **no lo prometas en la reunión hasta probarlo**.

### 1.4 Nombre para mostrar

**"Miska Muska"** o **"Miska Muska Pastelería"**. Tiene que coincidir con lo que figura en Instagram y en la web. Se rechaza todo en mayúsculas, agregarle "Cuenta Oficial", emojis, URLs o el nombre de una persona. Si el monotributo está a nombre de una persona y la marca no coincide, la fórmula que Meta acepta es `Marca by Nombre Legal`. Aprobación típica de 5 minutos a 3 horas. Límite de 10 cambios cada 30 días, y si agotás las apelaciones te bloquean el cambio de nombre entre 7 y 60 días.

### 1.5 Lo que el DEV verifica en el VPS antes (10 minutos)

```bash
ssh root@2.25.185.242
grep -c handle_path /etc/caddy/Caddyfile          # el bloque de /miska-bot tiene que existir
grep PUBLIC_URL /opt/miska-muska/.env             # https://vps.marcorossi.com.ar/miska-bot
grep ADMIN_TOKEN /opt/miska-muska/.env            # no puede estar vacío
systemctl status miska-bot --no-pager
curl -s localhost:3011/health | jq .
cp /opt/miska-muska/.env /opt/miska-muska/.env.bak.$(date +%Y%m%d%H%M%S)
```

El bloque de Caddy tiene que ser `handle_path /miska-bot/*` (saca el prefijo) y estar **dentro** del site block, **antes** del `handle` genérico. Con `handle` a secas, Fastify tira 404 y Meta muestra "The callback URL couldn't be validated" sin explicar por qué. El snippet correcto es `deploy/Caddyfile.subpath.snippet`; `deploy/Caddyfile.snippet` es la variante de subdominio y no aplica.

Sin `PUBLIC_URL` bien puesta, las fotos del catálogo salen con URL relativa y Meta no las puede descargar. El propio endpoint avisa: *"Falta PUBLIC_URL: la dirección es relativa y WhatsApp no va a poder descargarla"* (`routes.ts:281`).

Generar el verify token y guardarlo:

```bash
openssl rand -hex 32
```

### 1.6 Lo que hay que pedirle al cliente que traiga o prepare

Mandar esto por escrito una semana antes:

- **El celular del local, cargado, con el chip adentro y con señal.** Alguien tiene que poder leer el SMS en el momento.
- **Quién recibe el SMS:** nombre y que esté presente. Si el número es un fijo, se verifica por llamada de voz y hay que poder atenderla.
- **Saber si la app tiene verificación en dos pasos activa y quién sabe el PIN.** Es lo que más frena la migración. Si está activa y nadie lo recuerda, hay que cambiarlo o desactivarlo en la app **antes** de tocar nada.
- **Versión de WhatsApp Business actualizada** (2.24.17 o superior).
- **Constancia de inscripción de ARCA** y factura de servicios (para 0.5, si no se hizo antes).
- **Una hora y media sin atender pedidos**, y que el día elegido sea **lunes o martes a la mañana** — nunca viernes, nunca la semana previa a una fecha fuerte.
- **Saber cuántos grupos y listas de difusión están en uso hoy**, y si el catálogo de la app tiene productos cargados.

---

## 2. La conversación con las dueñas

Esto va antes de tocar el celular, y va hablado, no leído. La idea es que digan que sí entendiendo, no que digan que sí para avanzar.

> Lo que vamos a hacer hoy es sacar el WhatsApp del teléfono y meterlo adentro del sistema. Suena raro dicho así, y por eso quiero que quede claro qué cambia, porque hay cosas que no tienen vuelta.
>
> **Lo primero: la app de WhatsApp Business del celular deja de existir para este número.** No es que queda de respaldo, ni que la pueden abrir para mirar. Se borra, y ese número deja de funcionar en el teléfono. A partir de ese momento todo lo que entra y sale pasa por el panel en la computadora. Si están en el mostrador y quieren ver qué escribió una clienta, es en la compu, no en el celu.
>
> **Se pierde el historial de chats.** Todo lo que está en el teléfono hoy: las conversaciones viejas, las fotos que mandaron los clientes, los audios. Vamos a sacar una copia antes, pero esa copia sirve para leerla, no para tenerla adentro del sistema. En el panel arrancan de cero: van a ver las conversaciones nuevas, desde hoy en adelante.
>
> **El número sale de todos los grupos** y las listas de difusión se pierden. Si tienen un grupo con las chicas del local o con proveedores, ese número se cae del grupo. Conviene que antes hagan que otra persona quede de administradora, o armar el grupo desde otro número.
>
> **El catálogo de la app también se va.** El bot igual muestra los productos, porque los tiene cargados adentro, así que para el cliente no cambia mucho. Pero el catálogo que ustedes arman desde el teléfono ya no está.
>
> **Y hay una cosa que quiero que entiendan bien, porque es la que más las va a incomodar los primeros días.** WhatsApp tiene una regla: ustedes le pueden escribir libremente a alguien solo durante las 24 horas siguientes a que esa persona les escribió. Pasadas las 24 horas, hay que usar un mensaje aprobado de antemano por WhatsApp, y eso el sistema todavía no lo sabe hacer. En criollo: si una clienta escribe el lunes a la tarde y nadie contesta hasta el miércoles, **no le pueden escribir**. Ni el bot ni ustedes. Hoy, con la app, le escriben cuando quieren. Eso se pierde. Estamos trabajando en resolverlo, pero hoy no está.
>
> **Otra que es importante para ustedes:** cuando una clienta manda la foto del comprobante de la transferencia, hoy en el panel **no se ve la foto**. Aparece que mandó una imagen, pero no la imagen. Ni el bot la lee ni ustedes la pueden mirar. Es lo primero que voy a arreglar, pero si migramos hoy, mañana ustedes no ven comprobantes.
>
> **¿Qué ganan?** El bot atiende solo las consultas de siempre — horarios, precios, qué hay, tomar el pedido, anotar en cursos — a cualquier hora, sin que nadie esté con el teléfono en la mano. Ustedes ven todo en el panel y entran a mano cuando hace falta, sin que el cliente note el cambio. Los pedidos quedan cargados solos, con el teléfono del cliente, y no hay que pasarlos a la planilla.
>
> **El punto de no retorno es cuando apretamos "Eliminar mi cuenta" en el teléfono.** Antes de eso puedo deshacer todo. Después de eso el historial no vuelve, y volver atrás significa reinstalar la app, verificar el número de nuevo y empezar sin nada. Toma menos de una hora, pero el historial no vuelve nunca.
>
> Por eso, antes de apretar ese botón, les voy a hacer una pregunta y quiero un sí en voz alta de las dos.

Si en cualquier momento aparece duda, hay una salida sin costo: **arrancar con un número nuevo y dejarles la app funcionando**. Está desarrollada en la sección 8, y es lo que recomiendo.

---

## 3. El día de la reunión, paso a paso

Duración total estimada: **2 h 30** si van por el número real, **1 h 15** si van por el chip nuevo.

### Pasos comunes

**1. (DEV, 10 min) Mostrar el bot funcionando.** Abrí el panel en `https://miska-muska.vercel.app`, escribile al chip de prueba desde tu celular y que ellas vean la conversación aparecer en la bandeja en vivo, contestar sola, y después contestá vos a mano desde el panel. Sin esto la conversación siguiente es abstracta.
*Verificación:* el mensaje aparece en el Inbox en menos de 3 segundos.

**2. (DEV, 25 min) La conversación de la sección 2.** Terminá con las tres preguntas: ¿aceptan perder la app en el celular? ¿aceptan perder el historial y los grupos? ¿aceptan que hasta que estén las plantillas no puedan escribirle a nadie pasadas las 24 h?
*Verificación:* respuesta explícita de las dos, y anotada. Si alguna duda, pasás al carril A.

**3. (DEV + CLIENTE, 10 min) La decisión de la sección 8.** Carril A (chip nuevo, recomendado) o carril B (migrar el número del local).

**4. (DEV, 20 min) Capacitación del panel**, con las chicas que atienden presentes. Bandeja, cómo se toma una conversación a mano, mensajes rápidos, Pedidos, Comanda, y dónde está el switch de Ajustes → Canales.
*Verificación:* que una de ellas responda una conversación de prueba sola, sin que le digas dónde hacer clic.

---

### CARRIL A — arrancar con número nuevo (recomendado)

**5A. (DEV, 5 min)** Confirmar que el chip de prueba pasa a ser el número de producción del bot. Prender el switch en **Ajustes → Canales → WhatsApp**.
*Verificación:* `/health` con `configured:true, ok:true` y el switch en verde.

**6A. (CLIENTE, 10 min)** Definir dónde se publica el número nuevo: bio de Instagram, cartel en el local, Google Maps. Y qué se hace con el número viejo: sigue en la app, atendido a mano, sin bot.

**7A. (DEV, 5 min)** Fijar la fecha de revisión: dos a cuatro semanas. En esa fecha se decide si se migra el número real, con los tres agujeros de la sección 6 ya tapados.

**No hay punto de no retorno en este carril.** Todo es reversible.

---

### CARRIL B — migrar el número que ya usan

**5B. (CLIENTE, con el DEV mirando, 5 min) Revisar el celular.**
Configuración → Cuenta → **Verificación en dos pasos**. Si está activada y nadie sabe el PIN: **frená acá**. Cambiarlo o desactivarlo requiere confirmación por mail y puede tardar. Sin el PIN no se puede registrar el número después de borrarlo.
*Verificación:* o está desactivada, o el PIN está anotado y probado.

**6B. (CLIENTE, 20-40 min) Backup y exportación de chats.**
Configuración → Chats → Copia de seguridad → hacer una ahora. **Y además**, en las conversaciones que importen: tocar el chat → menú → Más → Exportar chat → Incluir archivos → enviar por mail.
Aclaración importante: **el backup en Google Drive se borra junto con la cuenta**. Lo único que sobrevive de verdad es la exportación por mail y, si el celular es Android, una copia local del archivo `.crypt` copiado a la computadora.
*Verificación:* el mail con los `.txt` exportados llegó y se abre. Sin ese mail no se sigue.

**7B. (CLIENTE, 10 min) Rescatar lo que se pierde.**
Screenshots del catálogo, lista de los grupos donde está el número (y poner a otra persona como administradora en cada uno), y captura de las listas de difusión con sus contactos.
*Verificación:* los grupos importantes tienen otro admin.

**8B. (CLIENTE, opcional, 5 min) Último aviso.** Publicar un estado avisando que van a estar unos minutos sin responder.

**9B. (DEV, 5 min) Último chequeo del servidor.**
```bash
systemctl status miska-bot --no-pager
curl -s https://vps.marcorossi.com.ar/miska-bot/health | jq .
```
*Verificación:* el servicio activo y `/health` respondiendo. Si el bot está caído, **no se borra nada**.

---

> ## ⛔ 10B — PUNTO DE NO RETORNO
>
> **CLIENTE**, en el celular: WhatsApp Business → **Configuración → Cuenta → Eliminar mi cuenta**. Pide confirmar el número de teléfono.
>
> **A partir de acá:** el historial no vuelve, los grupos no vuelven, el catálogo no vuelve, y el número queda sin servicio hasta que termine el paso 13B. Meta dice que tarda **hasta 3 minutos** en liberarlo.
>
> **El riesgo real de este momento no es el borrado, es el registro:** si el alta falla, hay un tope de **10 intentos por número cada 72 horas**; pasado eso, error **133016** y el número queda bloqueado **tres días**. Con la cuenta ya borrada, eso significa el local **tres días sin WhatsApp**. Por eso el alta técnica se ensaya antes con el chip (paso 1.2): el día de la reunión el flujo tiene que estar caminado, no descubierto.
>
> Antes de tocar: el sí en voz alta de las dos dueñas.

---

**11B. (DEV, 5 min) Agregar el número a la WABA.**
WhatsApp Manager → la WABA del local → **Números de teléfono → Agregar número**. Cargar el nombre para mostrar (sección 1.4), la categoría del negocio y el número.
*Verificación:* el número aparece en la lista, en estado pendiente de verificación.

**12B. (CLIENTE + DEV, 5 min) Verificar el número.**
Elegir SMS. **CLIENTE** lee el código en el celular, **DEV** lo carga.
*Verificación:* el estado del número pasa a verificado. Si el SMS no llega en 2 minutos, pedir verificación por voz — no reintentar el SMS en loop, cada intento cuenta contra el tope de 10.

**13B. (DEV, 3 min) Registrar el número con PIN.**
```bash
export TOKEN=EAAG...            # el System User token
export PHONE_ID=...             # el Phone number ID del número real, no el número
curl -s -X POST "https://graph.facebook.com/v21.0/$PHONE_ID/register" \
  -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"messaging_product":"whatsapp","pin":"123456"}'
# esperado: {"success":true}
```
Elegí un PIN nuevo de 6 dígitos y anotalo en dos lugares: el gestor de contraseñas del dev y uno de la dueña. Se pide para cambiarlo y para dar de baja el número.
*Verificación:* `{"success":true}` y el número en estado **Connected** en WhatsApp Manager.

**14B. (DEV, 5 min) Cargar las credenciales en el VPS.**
```bash
ssh root@2.25.185.242
cp /opt/miska-muska/.env /opt/miska-muska/.env.bak.$(date +%Y%m%d%H%M%S)
nano /opt/miska-muska/.env
```
Las cinco variables:
```
WHATSAPP_ACCESS_TOKEN=EAAG...          # System User, expiración Nunca
WHATSAPP_PHONE_NUMBER_ID=...           # el Phone number ID del número real
WHATSAPP_VERIFY_TOKEN=...              # el openssl rand -hex 32 del paso 1.5
WHATSAPP_APP_SECRET=...                # Meta → app → Settings → Basic → App Secret
WHATSAPP_GRAPH_VERSION=v21.0           # o la que hayas validado en 1.2
```
```bash
systemctl restart miska-bot
journalctl -u miska-bot -n 30 --no-pager
```
**`WHATSAPP_APP_SECRET` no es opcional.** Si queda vacío, `verifySignature()` hace `return true` (`adapter.ts:126`) y **el bot acepta webhooks sin validar la firma**, sin avisar nada: `channelConfigured()` no lo mira (`config.ts:94`), el panel muestra todo en verde y el switch se deja prender igual. La URL del webhook es pública: cualquiera que la conozca puede inventar mensajes entrantes y quemar tokens de OpenRouter.
*Verificación:* el servicio arranca y el log no tiene errores.

**15B. (DEV, 2 min) Probar el handshake antes de tocar el formulario de Meta.**
```bash
export BASE=https://vps.marcorossi.com.ar/miska-bot
export VERIFY=...
curl -s "$BASE/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=$VERIFY&hub.challenge=hola"
# tiene que imprimir exactamente: hola
```
Si no devuelve `hola`, el formulario de Meta va a fallar sí o sí. No sigas.

**16B. (DEV, 3 min) Configurar el webhook en Meta.**
developers.facebook.com → la app → **WhatsApp → Configuration → Webhook → Edit**:
- Callback URL: `https://vps.marcorossi.com.ar/miska-bot/webhooks/whatsapp`
- Verify token: el mismo valor de `WHATSAPP_VERIFY_TOKEN`, carácter por carácter.

Después, en **Webhook fields**, suscribirse a **`messages`** y solo a ese. Los demás campos no rompen nada pero tampoco sirven: `parseWebhook()` itera los `changes` sin mirar `change.field` (`adapter.ts:139-141`), así que un payload de otro campo se descarta después de calcular el HMAC al pedo.

Se puede hacer lo mismo por API y saltearse el formulario, que es donde se cuela el error de tipeo del verify token:

```bash
export APP_ID=...
export APP_SECRET=...
curl -X POST "https://graph.facebook.com/v21.0/$APP_ID/subscriptions" \
  -d "object=whatsapp_business_account" \
  -d "callback_url=$BASE/webhooks/whatsapp" \
  -d "verify_token=$VERIFY" \
  -d "fields=messages" \
  -d "access_token=$APP_ID|$APP_SECRET"
```

**16B-bis. (DEV, 1 min) Suscribir la app a la cuenta de WhatsApp. SIN ESTO NO LLEGA NINGÚN MENSAJE.**

Es un paso aparte del webhook y es el que más se olvida, porque la consola no lo pide y no da ningún error: el webhook queda verificado, el token manda mensajes, y los entrantes simplemente nunca aparecen.

```bash
curl -X POST "https://graph.facebook.com/v21.0/$WABA_ID/subscribed_apps" \
  -H "Authorization: Bearer $TOKEN"
# esperado: {"success":true}
```

*Verificación:*
```bash
curl -s "https://graph.facebook.com/v21.0/$WABA_ID/subscribed_apps" -H "Authorization: Bearer $TOKEN"
# tiene que listar la app
```

**17B. (DEV, 2 min) Confirmar el canal, con el switch todavía APAGADO.**
```bash
curl -s "$BASE/health" | jq '.channels'
# whatsapp: configured:true, ok:true, detail con el nombre y el número
```
Con el switch apagado el bot **no contesta**, pero los mensajes entrantes **igual se guardan** y aparecen en la bandeja (`ingress.ts` corre antes del gate de `router.ts:81-83`), y las chicas **sí pueden contestar a mano** — `sendAsOperator()` no consulta `activeChannels` (`index.ts:491-495`). Es el modo "conectado pero apagado", ideal para los primeros minutos.

**18B. (DEV, 5 min) Prueba entrante real.** Escribile al número del local desde tu celular.
*Verificación:* la conversación aparece en el panel. Contestá a mano desde el panel y que llegue a tu celular.

**19B. (DEV, 2 min) Prender el bot.** Panel → **Ajustes → Canales → WhatsApp** → switch "el bot atiende acá" → **Guardar**.
*Verificación:* mandá "hola, ¿a qué hora abren?" desde tu celular y que conteste el bot.

**20B. (DEV, 5 min) Cerrar.** Correr entera la sección 4 delante de ellas.

---

## 4. Verificación de punta a punta

Preparar el entorno:
```bash
export BASE=https://vps.marcorossi.com.ar/miska-bot
export TOKEN=EAAG...
export PHONE_ID=...
export WABA_ID=...
export VERIFY=...
export MI_CEL=549381XXXXXXX      # sin el +
```

| # | Qué se prueba | Comando / acción | Resultado esperado |
|---|---|---|---|
| 1 | El proceso vive | `systemctl status miska-bot --no-pager` | `active (running)` |
| 2 | El canal está configurado | `curl -s "$BASE/health" \| jq '.channels'` | `whatsapp` con `configured:true, ok:true` y el `detail` con el nombre aprobado |
| 3 | El token sirve y es el número correcto | `curl -s "https://graph.facebook.com/v21.0/$PHONE_ID?fields=display_phone_number,verified_name,quality_rating" -H "Authorization: Bearer $TOKEN"` | El número del local, el nombre aprobado, calidad `GREEN` o sin dato |
| 4 | El token no vence | Access Token Debugger de Meta | Expires: **Never**, scopes `whatsapp_business_messaging` y `whatsapp_business_management` |
| 5 | La app está suscripta | `curl -s "https://graph.facebook.com/v21.0/$WABA_ID/subscribed_apps" -H "Authorization: Bearer $TOKEN"` | La app listada |
| 6 | El handshake responde | `curl -s "$BASE/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=$VERIFY&hub.challenge=hola"` | `hola`, exacto |
| 7 | El handshake rechaza un token malo | mismo comando con `hub.verify_token=cualquiera` | `403` |
| 8 | **La firma se valida de verdad** | ver abajo | `401` |
| 9 | Sale un mensaje por la API | ver abajo | `messages[0].id` con un `wamid.` |
| 10 | Entra un mensaje real | Escribir al número desde otro celular | Aparece en el Inbox en menos de 3 s |
| 11 | El bot responde | "¿a qué hora abren?" | Contesta con el horario del local |
| 12 | Responde una persona | Contestar desde el panel | Llega al celular con el sello 👤 local |
| 13 | Las fotos salientes se descargan | `curl -sI "$BASE/media/<id-de-una-foto-del-catalogo>" \| head -3` | `200` y `content-type: image/...` |
| 14 | El bot manda una foto | Pedirle una foto de un producto por chat | La imagen llega al celular, no un link roto |
| 15 | El teléfono queda cargado | Panel → la conversación → panel derecho | El teléfono en E.164 con `+` |
| 16 | Se toma un pedido completo | Conversación de punta a punta | Aparece en Pedidos y en Comanda |
| 17 | No hay errores | `journalctl -u miska-bot -n 100 --no-pager \| grep -i -E 'error\|warn'` | Nada de WhatsApp |

**Prueba 8 — la firma:**
```bash
curl -s -o /dev/null -w '%{http_code}\n' -X POST "$BASE/webhooks/whatsapp" \
  -H 'content-type: application/json' \
  -H "x-hub-signature-256: sha256=$(printf '%064d' 0)" \
  -d '{"object":"whatsapp_business_account","entry":[]}'
# esperado: 401
```
Si devuelve **200**, `WHATSAPP_APP_SECRET` está vacío y el webhook está abierto. Es la única prueba de esta lista que, si falla, obliga a apagar y arreglar en el momento.
*Bug conocido:* si en vez de 64 ceros mandás 64 caracteres no-hex, el bot responde **500** en lugar de 401 — `Buffer.from(x,'hex')` corta en el primer carácter inválido y `timingSafeEqual` tira `RangeError` sin capturar (`adapter.ts:130-131`). No es un agujero, es ruido en el log ante cualquier escaneo.

**Prueba 9 — envío por API:**
```bash
curl -s -X POST "https://graph.facebook.com/v21.0/$PHONE_ID/messages" \
  -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d "{\"messaging_product\":\"whatsapp\",\"to\":\"$MI_CEL\",\"type\":\"text\",\"text\":{\"body\":\"prueba\"}}"
```
Requiere que tu número te haya escrito antes (ventana abierta). Si devuelve **131047** o **131026**, la ventana está cerrada: es el comportamiento correcto, no un error de configuración.

**Lo que NO vas a poder verificar, y conviene decirlo:**
- Que se vea un comprobante entrante. No se ve. Es esperado (sección 6).
- Que se mande una plantilla desde el sistema. No se puede.
- Los tildes de entregado y leído en el panel. Los `statuses` llegan pero no se persisten; solo se loguean los que traen error (`adapter.ts:144-148`).
- El "escribiendo…". `setTyping()` en WhatsApp es un no-op (`adapter.ts:346-348`).

---

## 5. Si algo sale mal

### Antes del paso 10B
No hay nada que deshacer. Se cierra la reunión, se pasa al carril A, y no se perdió nada.

### Después del paso 10B

| Problema | Qué se hace | Cuánto tarda | Qué NO vuelve |
|---|---|---|---|
| El SMS no llega | Pedir verificación por voz desde el mismo formulario. **No reintentar SMS**: cada intento cuenta contra el tope de 10 en 72 h | 5-10 min | — |
| Error **133016** (agotó los 10 intentos) | No hay atajo. **El número queda bloqueado 72 horas** y el local se queda sin WhatsApp esos 3 días. Plan de contingencia: publicar en Instagram un número alternativo (el chip de prueba) y avisar en el local | 3 días | — |
| El PIN no anda | Si el número tenía 2FA en la app, hay que mandar **ese** PIN. Si nadie lo sabe, se resetea desde WhatsApp Manager → Settings del número → Two-step verification → Change PIN. **No hay endpoint para apagar la 2FA.** Hay una inconsistencia entre páginas de Meta sobre si se puede desactivar: asumí que solo se puede *cambiar* | 10 min a horas | — |
| Meta no valida la callback URL | Es siempre una de tres: el verify token no coincide carácter por carácter, el bloque de Caddy quedó con `handle` en vez de `handle_path`, o el bot está caído. Correr la prueba 6 | 5 min | — |
| **El webhook quedó verificado y los mensajes entrantes nunca llegan, sin ningún error** | Las dos causas conocidas, las dos silenciosas: (a) falta el `POST /$WABA_ID/subscribed_apps` del paso 16B-bis; (b) al usuario del sistema se le asignó **la app pero no la cuenta de WhatsApp**. Tienen que ser los **dos activos**, con control total. Con solo la app, el token manda mensajes igual y todo se ve verde | 15 min | — |
| **Al buscar el número en WhatsApp aparece "Invitar"** | El número quedó `PENDING`: verificarlo por SMS no alcanza, falta el `/register` con el PIN. La consola no lo dice | 3 min | — |
| Entra `(#200) Permissions error` | La WABA no está asignada al System User, o falta un permiso, o la app está en otro portfolio que la WABA | 10 min | — |
| Entra `190 access token expired` | Quedó puesto el token temporal de 24 h del panel. Regenerar el de System User con expiración Nunca | 10 min | — |
| El bot contesta mal o de más | Apagar el switch en Ajustes → Canales. **Ojo: apagar el switch NO apaga el webhook.** Meta sigue mandando y el servidor sigue guardando; solo deja de responder el bot. Para cortar de verdad hay que quitar la suscripción a `messages` en Meta | 30 s | — |
| Se decide volver a la app del celular | `curl -X POST "https://graph.facebook.com/v21.0/$PHONE_ID/deregister" -H "Authorization: Bearer $TOKEN"` → instalar WhatsApp Business → verificar por SMS | 30-60 min | **El historial. Los grupos. El catálogo. Todo lo que entró por Cloud API.** Nada de eso vuelve, nunca |

**Sobre volver a la app:** Meta documenta que el deregister "makes it available for re-registration" y que los cambios son inmediatos. Un proveedor (interakt) afirma lo contrario — que un número borrado no puede volver a usarse nunca con ningún BSP. Le creo a Meta, pero la contradicción existe y conviene no jurar en la reunión que la vuelta atrás es 100% segura. Dos frenos adicionales documentados: borrar el número desde WhatsApp Manager pide el PIN si está en estado Connected, y **no se puede borrar si mandó mensajes pagos en los últimos 30 días**.

**Regla de oro del día:** si a las dos horas de empezado el paso 10B el número no está recibiendo mensajes, **no sigas probando**. Cada intento fallido acerca el 133016. Parar, diagnosticar con calma, y retomar al día siguiente con el contador reseteado.

---

## 6. Después: lo que queda pendiente

### Los tres agujeros de código, en orden de cuánto duelen

| # | Qué falta | Impacto | Estimación |
|---|---|---|---|
| 1 | **Ver la foto entrante.** `downloadMedia()` existe y funciona (`adapter.ts:350-357`) pero no lo llama nadie. Hay que engancharlo en `ingress.ts`, guardar el binario con el repo de media que ya existe, y poner la `url` en el payload — el `/media/:id` y el render del Inbox ya están hechos | Sin esto, los comprobantes son invisibles para todos | **~1 día.** Es lo primero |
| 2 | **Mandar plantillas.** El adaptador ya las serializa; falta que el pipeline genere contenido `template`, que el endpoint del panel lo acepte (`routes.ts:157-167` solo toma texto) y una pantalla para elegir plantilla y completar variables. Además la serialización actual solo arma el componente `body` con parámetros posicionales: **no soporta header ni botones**, así que una plantilla con botón de URL va a fallar con 132000/132012 | Sin esto no se puede escribir fuera de las 24 h, ni hacer campañas | **2-3 días** |
| 3 | **Reintentos.** `#post()` hace un fetch y listo (`adapter.ts:379-405`): ni backoff ni reintento ante 429 o 5xx. WhatsApp tira 429 con bastante más facilidad que Telegram, sobre todo con un número nuevo | Mensajes que no salen y el cliente no se entera | **medio día** |

Menores, pero anotadas: `/health` pega a Graph en **cada** llamada y no tiene auth (`server.ts:109-113`) — un monitor cada 30 s son 2.880 llamadas diarias contra la cuota; conviene cachear 60 s. `markRead()` manda el acuse de lectura y el indicador de tipeo en el **mismo** request (`adapter.ts:337-344`): si Graph rechaza el campo nuevo se caen los dos, y como el resultado se descarta con `.catch(() => undefined)`, **no queda ni una línea en el log**. Y el bug del 500 con firma no-hex.

### Fecha con vencimiento: 1 de octubre de 2026 — quedan 33 días

A partir de ese día Meta cobra **por mensaje** las respuestas dentro de la ventana de 24 h, no solo las plantillas. Consecuencia directa sobre el código: **si el bot parte una respuesta en tres globitos para que se lea más natural, eso pasa a costar el triple.** Revisar el envío y consolidar respuestas en un solo mensaje donde se pueda es la optimización con mejor retorno del proyecto, y hay que hacerla **antes** de esa fecha. Meta se comprometió a publicar las tarifas exactas antes del 1 de septiembre: **revisá la página de pricing el 1/9** antes de cerrar números.

### Trámites que siguen corriendo

- **Verificación del negocio:** si no salió, seguirla. Sin ella el tope es 250 destinatarios únicos cada 24 h para conversaciones **iniciadas por el local** (responder no cuenta y es ilimitado). Hay que tenerla lista **antes de la primera campaña de Día de la Madre o Navidad**.
- **Plantillas:** confirmar que las seis quedaron aprobadas y en qué categoría. Si alguna utility salió como MARKETING, reescribirla y volver a mandarla.
- **Límites:** suben solos. La escalera es 250 → 2.000 → 10.000 → 100.000 → ilimitado. De 2.000 para arriba escala automático si la calidad se mantiene alta y usaste al menos la mitad del límite en los últimos 7 días; el aumento se aplica en unas 6 horas. Desde octubre de 2025 el límite es **por portfolio**, compartido entre todos los números.
- **Suscribirse al webhook `template_category_update`** cuando se implemente el punto 2, para enterarse de una recategorización sin esperar la factura.

### La primera semana — qué mirar cada día

```bash
journalctl -u miska-bot --since today | grep -i -E 'whatsapp|131047|131026|firma|429'
curl -s "$BASE/health" | jq '.channels'
```
Y en Meta: **WhatsApp Manager → Overview**, el quality rating del número. Estados: *Connected* (normal), *Flagged* (la calidad cayó — hay 7 días para recuperarla, y si no, el límite baja un escalón), *Restricted* (llegaste al tope del tier; seguís pudiendo responder).

El riesgo de quality rating es prácticamente nulo mientras el bot solo **responda** a quien escribió primero. Aparece el día que a alguien se le ocurra mandar promo a toda la agenda. **Dejar acordado por escrito con las dueñas que cualquier envío masivo pasa antes por el dev** — es la única acción del lado de ellas que puede voltear el número.

---

## 7. Lo que va a costar

**Supuestos explicitados:** 300 conversaciones por mes iniciadas por el cliente, 6 mensajes salientes promedio
por conversación, 100 avisos de "pedido listo" al mes.

> **Los números de esta sección son estimativos y vencen el 1 de septiembre de 2026.** Meta cambia el
> esquema el **1 de octubre de 2026** y se comprometió a publicar las tarifas exactas **antes del 1 de
> septiembre**. Antes de mostrarle un número a nadie, bajá el rate card oficial — y bajá el de **ARS**,
> porque el peso es moneda de facturación y lo que cobra Meta puede no ser dólares por tipo de cambio.
> Los republicadores de terceros no coinciden entre sí: circulan a la vez cifras de 0,0101 y de 0,0260 USD
> por mensaje de utilidad. No uses ninguna de las dos hasta ver la oficial.

| Concepto | Hoy (hasta 30/09/2026) | Desde 01/10/2026 |
|---|---|---|
| Mensajes entrantes del cliente | USD 0 | USD 0 |
| Respuestas del bot y del local dentro de las 24 h (~1.800 msj) | **USD 0**, gratis y sin tope | Se cobran por mensaje |
| 100 avisos "pedido listo" (utility, dentro de la ventana) | **USD 0** | Se cobran por mensaje |
| **Total mensual estimado** | **prácticamente cero** | **USD 20 a 90**, según la tarifa que publiquen |

Rango realista a presupuestar desde octubre: **USD 45 a 90 por mes** ($67.500 a $135.000). Con un bot más charlatán (10 mensajes por conversación) trepa a ~USD 81.

**Extras:**
- Una campaña de marketing a 500 clientes cuesta, con cualquiera de las tarifas que circulan, **más que todo el resto del mes junto**. Segmentar en vez de disparar a toda la base.
- El costo del modelo (OpenRouter) va aparte y ya lo pagan: se ve en el panel, en **Métricas**, con el gasto en dólares por día y por conversación.
- VPS y Vercel: sin cambio.

**Dos cosas para chequear antes de dar el número por bueno:**
1. Meta publica los rate cards como CSV y PDF en su página de pricing. **Bajá el de ARS** — desde el 1 de abril de 2026 el peso argentino es moneda de facturación, así que lo que factura Meta puede no ser exactamente USD × tipo de cambio. Los republicadores de terceros no coinciden entre sí; hay páginas que todavía muestran USD 0,0120 para utility, que es un valor viejo.
2. Las tarifas del 1/10 se publican **antes del 1/9**. Revisalas esta semana.

**La única palanca real para bajar la factura:** las conversaciones que entran por un anuncio Click-to-WhatsApp o por el botón de la página de Facebook/Instagram abren una ventana de **72 horas gratis**, y eso **sigue gratis después de octubre**. Si Miska Muska hace publicidad en Instagram con botón a WhatsApp, esas conversaciones no se cobran. Vale la pena decírselo.

---

## 8. Decisiones que hay que tomar antes

### Decisión 1 — ¿el número que ya usan, o uno nuevo?

**Recomiendo: arrancar con un número nuevo y dejarles la app funcionando. Migrar el número real en dos a cuatro semanas, no hoy.**

No es prudencia genérica, son tres cosas concretas:

1. **Hoy no se ven los comprobantes.** El flujo central de este negocio es "la clienta manda la foto de la transferencia". Con la app, las chicas la ven. Migrado, no la ve nadie: ni el bot ni el operador. Es un día de trabajo arreglarlo, y no está arreglado.
2. **Hoy no se pueden mandar plantillas.** Pasadas las 24 h no hay forma de escribirle a un cliente desde el sistema. Con la app, hoy le escriben a quien quieran cuando quieran. Ese es el peor retroceso funcional de la migración, y también tiene arreglo, y también no está hecho.
3. **El punto de no retorno tiene un modo de falla de tres días.** El 133016 deja el número muerto 72 horas. La probabilidad es baja si el alta se ensayó antes, pero el costo es el local sin WhatsApp tres días.

El número nuevo cuesta un chip y no cierra ninguna puerta. Se publica en Instagram y en el local como "pedidos por acá", el bot atiende, y el número de siempre sigue vivo en la app para lo que hoy funciona. Cuando estén tapados los puntos 1 y 2 de la sección 6, se migra el número real con el flujo ya rodado y con la confianza de las dueñas ganada, no prestada.

**Cuándo cambia la recomendación:** si el volumen es tan alto que atender dos números es inviable, o si las dueñas dicen explícitamente que quieren el número de siempre y aceptan por escrito el punto 2 (no poder escribir fuera de las 24 h) — ahí el carril B es defendible, ese día, con el runbook en la mano.

**Camino C, para completar el menú:** desde mayo de 2025 existe **Coexistence**, que permite el mismo número en la app y en la Cloud API a la vez, con historial sincronizado. Suena perfecto y tiene tres problemas: Meta exige ser **Solution Partner o Tech Provider** y hacer el alta por Embedded Signup, o sea que hay que meter un BSP en el medio (360dialog, respond.io) con su facturación y su infraestructura; en coexistencia **no funcionan catálogo, listas de difusión, respuestas rápidas ni etiquetas**, y los grupos no se sincronizan; y hay que abrir la app cada 13-14 días o el vínculo se corta — o sea, **el celular del local pasa a ser una dependencia del bot**. Es la respuesta correcta solo si el local decide que perder la app es inaceptable y está dispuesto a pagar un intermediario. Lo dejaría como plan si el carril A resulta incómodo, no como opción de esta reunión.

### Decisión 2 — ¿de quién es la cuenta?

**Recomiendo: portfolio, WABA y número a nombre del local, con dos dueñas como administradoras, y el dev agregado como Persona con rol admin.**

No es una formalidad. **La WABA no se transfiere entre negocios: Meta lo dice explícito y no hay botón.** Si queda a nombre del dev y algún día se van cada uno por su lado, o le hackean el Facebook personal, o Meta le suspende la cuenta por algo ajeno, el local pierde su número de contacto y no tiene forma de reclamarlo. La salida es deregistrar, crear otra WABA y volver a registrar el número: se pierde la aprobación del nombre, hay que recrear y reaprobar todas las plantillas, y el quality rating y el tier arrancan de cero, con el número sin servicio en el medio.

Meta empujó en esta dirección: el modelo OBO, donde el proveedor era dueño "en nombre" del cliente, quedó deprecado y desde el 30 de septiembre de 2025 no se onboardean WABAs nuevas así.

Dos administradoras, no una. Si la única admin pierde el acceso a su Facebook, el local se queda afuera de su propia cuenta.

### Decisión 3 — ¿quién atiende el panel, y en qué horario?

Hay que decidirlo hoy, porque la ventana de 24 h lo vuelve operativo y no organizativo: **una consulta que queda sin responder 24 horas ya no se puede responder**, ni siquiera a mano. Mientras no estén las plantillas, la respuesta es que alguien mire la bandeja al menos dos veces por día, incluido el domingo si el local recibe pedidos el domingo.

**Recomiendo** dejarlo por escrito con nombre y horario, y que la persona tenga el panel abierto en una pestaña fija de la computadora del mostrador.

### Decisión 4 — ¿qué se hace con los comprobantes mientras tanto?

Con el número nuevo (carril A) no hay problema: los comprobantes siguen llegando a la app del número de siempre.

Si igual eligen el carril B, hay que decidir hoy una de dos: **(a)** el local pide que el comprobante se mande al número personal de una de las chicas hasta que esté el arreglo, o **(b)** se posterga la migración hasta tener el punto 1 de la sección 6 resuelto. **Recomiendo (b)**, que es exactamente el carril A dicho de otra manera.

### Decisión 5 — ¿quién puede mandar campañas?

**Recomiendo: nadie sin pasar por el dev.** El opt-in explícito lo exige la política de Meta, y la escalera de enforcement va de advertencia a restricción a baneo permanente. El error que convierte un problema chico en terminal es registrar otro número para seguir haciendo lo mismo mientras el primero está restringido: Meta lo lee como evasión y **suspende el portfolio entero**. Y hay un solo ticket de revisión por restricción, así que la apelación tiene que salir completa la primera vez.