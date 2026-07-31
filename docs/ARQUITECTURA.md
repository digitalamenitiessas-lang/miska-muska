# Arquitectura

Documento de decisiones: qué se eligió, y por qué, para que el próximo que toque
esto no tenga que adivinar.

---

## 1. El problema que ordena todo el diseño

El pedido era: arrancar en Telegram, migrar a WhatsApp oficial, y **aislar bien la
entrada, el procesamiento y la salida del mensaje**.

Telegram y WhatsApp Cloud API no son intercambiables:

| | Telegram | WhatsApp Cloud API |
| --- | --- | --- |
| Transporte | polling o webhook | solo webhook, con firma HMAC |
| Identidad | `chat_id` numérico | `wa_id`, que *es* el teléfono en E.164 |
| Botones | teclado inline, muchos, 64 caracteres | 3 botones de 20 caracteres |
| Listas | no existen | mensaje de lista, 10 filas |
| Escribir primero | siempre se puede | solo dentro de 24 h del último mensaje del cliente; fuera de eso, plantillas aprobadas |
| "Escribiendo…" | `sendChatAction` | va pegado al acuse de lectura |

Si el pipeline conoce esas diferencias, migrar es reescribirlo. Así que no las conoce.

---

## 2. Puertos y adaptadores, con una frontera verificada

`core/` es el dominio. `channels/` es transporte. `api/` es HTTP. Las dependencias
apuntan hacia adentro y nunca al revés:

```
api/  ─────────┐
               ▼
channels/ ──► core/   (core no importa a nadie hacia afuera)
```

`core/pipeline` no recibe un `TelegramAdapter`: recibe un `AdapterResolver`, una
función `(canal) => ChannelAdapter | undefined` que le inyecta `main.ts`. El
registro de canales es el único archivo que conoce las clases concretas.

**Esto está verificado, no prometido.** `apps/server/scripts/check-boundaries.mjs`
parsea los imports y rompe el build si alguien cruza la línea. Una convención que
nadie chequea se erosiona en tres sprints; un script no.

---

## 3. El formato canónico es la unión, no la intersección

La tentación es definir el mensaje de salida con el mínimo común denominador (texto
plano) para que funcione en todos lados. El costo es perder los botones de WhatsApp
justo cuando sirven.

Acá `OutboundContent` es la **unión** de lo que saben hacer los canales — texto,
imagen, documento, botones, lista, plantilla, indicador de tipeo — y cada adaptador
declara sus `ChannelCapabilities`. Una función genérica, `degradeForChannel()`,
baja lo que no entra:

- una lista de 10 filas → teclado inline en Telegram si son pocas, texto numerado si son muchas
- 5 botones en WhatsApp → los 3 primeros como botones, los otros 2 listados en el texto (no se pierden opciones)
- un texto de 6000 caracteres → se parte por párrafo, después por oración, nunca a mitad de palabra
- una plantilla en un canal sin ventana de servicio → texto plano

El pipeline expresa la intención rica una sola vez. El degradado se escribió y se
prueba una sola vez, no por canal.

---

## 4. La ventana de 24 h no se adivina, se detecta

Se podría calcular en el dominio: "¿pasaron más de 24 h desde `lastInboundAt`?".
Pero el reloj que importa es el de Meta, no el nuestro, y no coinciden (mensajes
reenviados, husos, reintentos).

Entonces se intenta el envío y se traduce el error: los códigos 131047 / 131026 se
convierten en `SendResult.outsideServiceWindow`, y el egress lo transforma en una
alerta del panel con el texto de qué hacer. El dominio se enteró del problema sin
tener que modelar la regla de un proveedor.

---

## 5. Las reglas del negocio viven dos veces, a propósito

`core/policies/rules.ts` tiene las mismas reglas como **prosa** (va al system
prompt) y como **guardas ejecutables** (`validateOrder()`).

Es duplicación deliberada. Un prompt es una instrucción muy buena y no una
garantía: alcanza con un cliente insistente para que "no enviamos tortas" se
negocie. Las cosas que cuestan plata o credibilidad se validan en código:

```
crear_pedido({ items: [torta chocoreo], modalidad: 'cadete-miska' })
  → { ok: false, error: "No enviamos Torta chocoreo a domicilio. Hay que explicarle
      al cliente que es para que llegue en buenas condiciones, y ofrecerle retirar
      en el local o mandar un Uber…" }
```

Fijate que el error está escrito **para que lo lea el modelo**, no para un log. El
modelo recibe el rechazo y el motivo, y lo reformula con la voz de la marca. La
guarda no rompe la conversación: la corrige.

La capa más dura de todas está en la base: `campaign_skus` tiene un `CHECK` que
impide comprometer más stock del producido. Ni el bot ni el panel ni una consulta
suelta pueden vender la caja 151 de 150.

---

## 6. Un proveedor, muchos modelos

El bot habla con **OpenRouter**, que expone el dialecto de OpenAI
(`/chat/completions`) para los 367 modelos que rutea. No hay SDK: son ~180 líneas
de `fetch` en `core/agent/brain.ts`.

Eso compra tres cosas concretas:

- **Cambiar de modelo es cambiar un string** en el panel. Claude, GPT, Gemini,
  DeepSeek, Llama — mismo código, mismas herramientas.
- **El costo real de cada turno** viene en la respuesta (`usage.cost`) y se guarda
  en `messages.cost_usd`. El panel muestra gasto en dólares y costo por
  conversación, así que la elección de modelo se hace con datos.
- **Respaldos dentro de la misma llamada**: si el principal falla o está saturado,
  OpenRouter prueba los de `OPENROUTER_FALLBACK_MODELS` sin que el cliente espere
  un reintento nuestro.

El precio de esa portabilidad es no poder usar los parámetros exclusivos de un
proveedor. Se nota en dos lugares, y los dos están resueltos:

**Razonamiento.** En vez del parámetro nativo de cada familia se usa
`reasoning: { effort }`, que OpenRouter normaliza. Si un modelo no lo soporta, lo
descarta; y si además lo rechaza con un 400, el cliente lo desactiva solo y
reintenta una vez. Configurable desde el panel, de `none` a `max`.

**Caché de prompt.** Ver la sección siguiente.

---

## 7. Qué es estable y qué no, para que la caché sirva

El prefijo de la request se cachea por coincidencia exacta: cualquier byte que
cambie invalida todo lo que sigue. Así que el prompt está partido en dos mensajes
de sistema, en este orden:

| Posición | Qué | Por qué |
| --- | --- | --- |
| `messages[0]` | personalidad, reglas, datos del local (~2.300 tokens) | cambia casi nunca → lleva `cache_control` y se lee de caché |
| `messages[1]` | fecha, disponibilidad de hoy, campaña activa, notas del cliente | cambia todo el tiempo → va después, así no invalida lo de arriba |

Se podría ganar algo más poniendo el bloque volátil al final de la conversación,
para que también se cachee el historial. No se hace: eso depende de cómo cada
proveedor traduzca un `system` a mitad del array, y acá se rutean cientos de
modelos distintos. El historial de un chat de pastelería son unos cientos de
tokens; la corrección en todos los modelos vale más que ese ahorro.

`cache_control` solo se manda a los modelos `anthropic/*`, que son los que lo
interpretan. Los demás cachean solos o no cachean.

---

## 8. Por qué el bucle de herramientas es manual

Son unas 60 líneas y hace dos cosas que un helper genérico no haría:

1. **Acumula métricas del turno completo.** Tokens de entrada, de salida, de
   lectura de caché y costo, sumados a lo largo de todas las rondas de
   herramientas, y guardados en el primer mensaje saliente. El panel los muestra
   por burbuja.
2. **Recolecta efectos.** Las herramientas no solo devuelven datos:
   `escalar_a_humano` cambia el modo de la conversación, `crear_pedido` emite un
   evento al panel. Se juntan en `ToolContext.effects` y el pipeline los aplica
   *después* del turno, cuando ya sabe si la respuesta salió bien.

Maneja explícitamente lo que los modelos hacen mal: llamadas paralelas (todas se
ejecutan y cada resultado vuelve con su `tool_call_id`), argumentos con JSON
inválido (se le pide que reintente en vez de romper el turno), `finish_reason` de
`content_filter` y de `length`.

---

## 9. Lo que hace que no se sienta un bot

Tres detalles del `egress` y del `pipeline`, que son la mitad del pedido original:

**Debounce de 1,5 s.** La gente escribe "hola" / "queria consultar" / "por una
torta" en tres mensajes. Contestar cada uno es la firma de un bot. Si llega otro
mensaje, el reloj se reinicia y se contesta a todo junto.

**Mutex por conversación.** Sin él, dos mensajes casi simultáneos disparan dos
turnos de modelo en paralelo que se pisan y duplican respuestas.

**Tipeo proporcional.** El indicador "escribiendo…" y una espera de ~22 ms por
carácter, con piso y techo. Configurable, y en 0 se nota que es un bot.

Los dos primeros viven en memoria, y **por eso el bot corre en una sola
instancia**. Si alguna vez hay que escalar: el mutex pasa a `pg_advisory_lock` (ya
hay Postgres) y el debounce a una tabla con `run_after`.

---

## 10. Elecciones de infraestructura

**Postgres en Supabase.** El esquema usa `timestamptz`, `boolean`, `jsonb` y una
`SEQUENCE` para el número de pedido — nada exótico, todo portable a cualquier
Postgres. Todo el SQL está en `store/`, en dos archivos.

Tres decisiones del esquema que resuelven problemas concretos:

- **`timestamptz` + agrupaciones en el huso de Tucumán.** Con fechas en UTC, a las
  21:00 de Argentina el servidor ya cree que es mañana: un pedido para esta noche
  se rechazaba como "fecha pasada", y las métricas diarias cortaban a las 21 en vez
  de a medianoche.
- **`SEQUENCE` para el número de pedido**, en vez de `MAX(number) + 1`. Con dos
  pedidos simultáneos, el segundo repetía el número.
- **Migraciones con advisory lock.** Si un deploy solapado arranca dos procesos, uno
  espera y después ve que ya no hay nada que aplicar.

**Sin librería de Telegram ni de WhatsApp.** `fetch` nativo contra las dos APIs.
Los adaptadores son ~350 líneas cada uno y no heredan el modelo mental de una
librería que después hay que traducir al canónico.

**SSE en vez de WebSocket** para el panel: el flujo es de una sola dirección
(servidor → panel), `EventSource` reconecta solo, y atraviesa proxies sin
configuración. Las acciones del panel van por REST normal.

**Fastify** con un `addContentTypeParser` que guarda el cuerpo crudo, porque la
firma HMAC de WhatsApp se calcula sobre los bytes exactos: si se parsea y se
re-serializa el JSON, la firma no coincide nunca.

---

## 11. Lo que quedó afuera

Dicho explícitamente para que nadie lo descubra en producción:

- **No hay transcripción de audio.** Los mensajes de voz llegan como
  `[mensaje de voz]` y el modelo no los oye. Hoy pasan al agente, que naturalmente
  pide que lo escriban. Lo correcto sería escalar a una persona o transcribir.
- **No se leen las imágenes.** Un comprobante de transferencia llega como
  `[imagen]`. El adaptador ya sabe descargar el archivo (`downloadMedia`), pero
  nadie lo pasa al modelo todavía. Es el próximo paso obvio y el de más impacto:
  validar comprobantes automáticamente y pasar el pedido de `borrador` a
  `confirmado`. Muchos modelos de OpenRouter aceptan imágenes en el mismo formato
  de mensajes que ya se usa.
- **El stock de campañas no se descuenta solo.** La base ya lo impide vender de
  más y `reserveStock()` es atómico, pero `crear_pedido` todavía no lo llama: el
  bot no vincula un pedido a un SKU de campaña. La columna `campaign_sku_id` está
  puesta esperando eso. Hoy el stock se ajusta desde el panel.
- **No hay autenticación real en el panel.** Un `ADMIN_TOKEN` compartido, que
  además viaja en el query string del SSE porque `EventSource` no manda
  encabezados. Antes de exponerlo a internet: usuarios de verdad, o el panel
  detrás de la autenticación del reverse proxy.
- **No hay límite de tasa.** Nadie impide que una persona mande 200 mensajes y
  queme créditos. El apagado está en el panel y el gasto real se ve en Métricas,
  pero la protección automática no existe.
- **Un solo proceso.** Ver la sección 9.
