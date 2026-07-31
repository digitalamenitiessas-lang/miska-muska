# Migrar de Telegram a WhatsApp

El adaptador de WhatsApp ya está escrito (`apps/server/src/channels/whatsapp/adapter.ts`).
Migrar es configuración: no hay que escribir código.

Los dos canales pueden convivir. Se puede tener WhatsApp conectado y todavía
apagado, probarlo con un número de prueba, y recién después mover el tráfico.

---

## 1. Del lado de Meta

En [developers.facebook.com](https://developers.facebook.com) → tu app → **WhatsApp**:

| Qué necesitás | Dónde está | Variable |
| --- | --- | --- |
| Token de acceso permanente | *API Setup* → System User token | `WHATSAPP_ACCESS_TOKEN` |
| ID del número de teléfono | *API Setup* → Phone number ID | `WHATSAPP_PHONE_NUMBER_ID` |
| App secret | *Settings* → *Basic* | `WHATSAPP_APP_SECRET` |
| Verify token | lo elegís vos (cadena random) | `WHATSAPP_VERIFY_TOKEN` |

> El token temporal de 24 h del panel sirve para la primera prueba, pero se vence.
> Para producción hace falta el de System User.

---

## 2. En el `.env`

```bash
WHATSAPP_ACCESS_TOKEN=EAAG...
WHATSAPP_PHONE_NUMBER_ID=123456789012345
WHATSAPP_VERIFY_TOKEN=una-cadena-larga-que-elegis-vos
WHATSAPP_APP_SECRET=abc123...
WHATSAPP_GRAPH_VERSION=v21.0

PUBLIC_URL=https://bot.miskamuska.com.ar
```

`PUBLIC_URL` tiene que ser HTTPS y accesible desde internet: Meta no acepta HTTP ni
localhost. Para probar desde tu máquina, un túnel (`ngrok http 3001`) alcanza.

---

## 3. Configurar el webhook

En **WhatsApp → Configuration → Webhook**:

- **Callback URL**: `https://TU-DOMINIO/webhooks/whatsapp`
- **Verify token**: el mismo de `WHATSAPP_VERIFY_TOKEN`
- Suscribite al campo **`messages`**

Al guardar, Meta hace un `GET` con `hub.challenge`. El servidor lo responde solo
(`verifyWebhook()`); si el token no coincide devuelve 403 y Meta muestra el error.

Para chequear que el servidor está listo antes de configurarlo:

```bash
curl "https://TU-DOMINIO/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=TU-TOKEN&hub.challenge=hola"
# tiene que responder exactamente: hola
```

---

## 4. Activar el canal

`GET /health` te dice si las credenciales sirven:

```json
{ "channels": [{ "channel": "whatsapp", "configured": true, "ok": true,
                 "detail": "Miska Muska +54 381 ..." }] }
```

Después, en el panel → **Ajustes → Canales**, prendé el switch de WhatsApp. Recién
ahí el bot empieza a responder por ese canal.

Se puede tener los dos prendidos: cada conversación es independiente y el pipeline
resuelve el adaptador por canal.

---

## 5. Lo que cambia de verdad

### La ventana de 24 h

WhatsApp solo permite escribir libremente dentro de las 24 h desde el último
mensaje del cliente. Fuera de eso, únicamente **plantillas aprobadas**.

No lo calculamos nosotros: se intenta el envío y si Meta responde 131047 / 131026,
el adaptador lo marca como `outsideServiceWindow`. El egress convierte eso en una
alerta en la conversación:

> ⚠ Pasaron más de 24 h desde el último mensaje del cliente: solo se puede escribir
> con una plantilla aprobada.

**Qué hay que hacer antes de necesitarlo:** crear y hacer aprobar las plantillas en
Meta. Las que este negocio va a querir:

| Plantilla | Cuándo | Variables |
| --- | --- | --- |
| `pedido_confirmado` | llegó el comprobante | nombre, número de pedido, fecha y hora de retiro |
| `pedido_listo` | está para retirar | nombre, número |
| `recordatorio_retiro` | el día anterior | nombre, fecha, hora |
| `campania_lanzamiento` | arranca Día de la Madre, Navidad… | nombre, link |

Una vez aprobadas se envían con el contenido canónico `template`:

```ts
{ kind: 'template', name: 'pedido_listo', language: 'es_AR',
  variables: ['Agustina', '3069'] }
```

En Telegram ese mismo contenido se degrada a texto plano, así que el código del
pipeline no ramifica por canal.

### Botones y listas se recortan

WhatsApp permite 3 botones de 20 caracteres y listas de 10 filas. `degradeForChannel()`
lo maneja: los botones que no entran se listan como texto para no perder opciones, y
las secciones de lista se recortan sin romper el orden. No hay nada que ajustar, pero
conviene saber por qué en WhatsApp se ven menos botones que en Telegram.

### El teléfono llega gratis

En WhatsApp el `wa_id` **es** el teléfono en E.164. El adaptador lo guarda como
`contact.phone` con el `+` adelante. En Telegram el teléfono casi nunca está
disponible, y hay que pedirlo. Un detalle chico que hace los pedidos más rápidos.

### La firma del webhook

Cada `POST` viene con `X-Hub-Signature-256`, un HMAC-SHA256 del **cuerpo crudo** con
el app secret. Se valida con `timingSafeEqual`; si no coincide, 401 y el mensaje se
descarta.

Si `WHATSAPP_APP_SECRET` está vacío la validación se saltea — sirve para desarrollo,
pero en producción configuralo: sin eso cualquiera puede inventar mensajes.

---

## 6. Checklist antes de mover el tráfico real

- [ ] Token de System User (no el temporal de 24 h)
- [ ] `WHATSAPP_APP_SECRET` configurado y la firma validando
- [ ] `PUBLIC_URL` en HTTPS, con certificado válido
- [ ] Handshake del webhook OK y suscripción a `messages`
- [ ] `/health` devuelve `ok: true` para whatsapp
- [ ] Plantillas creadas y **aprobadas** por Meta
- [ ] Una conversación de prueba de punta a punta: entra, contesta, toma un pedido
- [ ] `ADMIN_TOKEN` puesto (el panel deja de estar abierto)
- [ ] Telegram apagado desde Ajustes, o dejado como canal secundario

---

## 7. Si algo no anda

| Síntoma | Causa habitual |
| --- | --- |
| Meta rechaza el webhook al guardar | `WHATSAPP_VERIFY_TOKEN` distinto entre el `.env` y el formulario, o el servidor no está levantado |
| Llegan los webhooks pero se descartan | firma inválida: revisá el app secret, o que algún proxy no esté reescribiendo el cuerpo |
| `/health` dice `ok: false` | token vencido, o `WHATSAPP_PHONE_NUMBER_ID` equivocado (es el ID, no el número) |
| El bot no contesta y no hay error | el canal está conectado pero apagado en **Ajustes → Canales** |
| Fallan todos los envíos con 131047 | el cliente no escribió en 24 h: necesitás plantilla |
| Los botones se ven como texto numerado | son más de 3, o títulos de más de 20 caracteres: es el degradado haciendo su trabajo |
