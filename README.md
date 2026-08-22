# Bot de Miska Muska

Bot conversacional para la pastelería **Miska Muska** (Tucumán) con panel de
monitoreo. Arranca en **Telegram** y migra a **WhatsApp Cloud API** sin reescribir
nada: el canal es un adaptador enchufable.

**Stack:** Postgres en Supabase · panel estático en Vercel · bot en un contenedor
(Fly.io, Railway o un VPS) · modelos vía **OpenRouter**.

---

## Arrancar

```bash
npm install
cp .env.example .env
```

Para desarrollo necesitás un Postgres. El más rápido:

```bash
docker run -d --name miska-pg -e POSTGRES_PASSWORD=miska -e POSTGRES_USER=miska \
  -e POSTGRES_DB=miska -p 15432:5432 postgres:16-alpine
```

y en el `.env`:

```bash
DATABASE_URL=postgres://miska:miska@localhost:15432/miska
DATABASE_SSL=0
```

Después:

```bash
npm run demo      # esquema + catálogo + 5 conversaciones de ejemplo
npm run dev       # servidor y panel
```

Panel en <http://localhost:5173> · API en <http://localhost:3001>

Podés mirar el panel funcionando antes de conectar nada. Y para probar el
pipeline sin gastar créditos, poné `DRY_RUN=1`: el bot contesta un texto fijo en
vez de llamar al modelo.

### Las dos claves que hacen falta

| Qué | Dónde se saca |
| --- | --- |
| `OPENROUTER_API_KEY` | [openrouter.ai/keys](https://openrouter.ai/keys) |
| `TELEGRAM_BOT_TOKEN` | [@BotFather](https://t.me/BotFather) → `/newbot` |

En desarrollo Telegram queda en modo *polling*: no hace falta URL pública ni túnel.

---

## Cómo está armado

```
apps/
  server/src/
    core/                 ← dominio puro. No conoce canales, ni HTTP, ni el framework web
      types/message.ts       modelo canónico de mensaje (entrada y salida)
      types/channel.ts       el puerto ChannelAdapter + degradado por capacidades
      pipeline/ingress.ts    ENTRADA:        normaliza, deduplica, persiste
      pipeline/router.ts     PROCESAMIENTO:  decide bot / mensaje rápido / persona
      pipeline/egress.ts     SALIDA:         degrada, humaniza, envía, registra
      agent/                 personalidad, herramientas y cliente de OpenRouter
      policies/rules.ts      reglas del negocio, como prosa y como guardas ejecutables
      store/                 Postgres: migraciones y repositorios
    channels/
      telegram/adapter.ts    etapa 1
      whatsapp/adapter.ts    etapa 2 — ya escrito, esperando credenciales
    api/                   webhooks + SSE + API de gestión del panel
  dashboard/               panel en React con la estética de la marca
supabase/schema.sql        el esquema, para pegarlo en el editor de Supabase
```

### El aislamiento no es una promesa del README

`npm run check:boundaries` recorre los imports y **falla el build** si:

- `core/` importa algo de `channels/`, de `api/` o de `fastify`
- `channels/` importa de `api/`
- un canal importa de otro canal

```
✓ Fronteras OK: core/ no conoce canales ni HTTP, y los canales no se conocen entre sí.
```

`npm run check` corre eso más el chequeo de tipos de las dos apps.

### El recorrido de un mensaje

```
Telegram / WhatsApp
   │  webhook o polling
   ▼
adapter.parseWebhook()  →  InboundMessage   ← formato canónico, sin rastro del canal
   ▼
ingress   deduplica el reintento del webhook, resuelve contacto y conversación, persiste
   ▼
router    ¿bot apagado? ¿la tomó una persona? ¿matchea un mensaje rápido corto?
   ▼
agent     OpenRouter con 8 herramientas (catálogo, pedidos, consultas, escalar…)
   ▼
egress    degrada al canal, parte los textos largos, simula tipeo, envía, registra
   ▼
adapter.send()  ←  OutboundMessage
```

Cada paso publica eventos en un bus interno. La capa HTTP los reenvía al panel por
SSE, así que la bandeja se mueve sola: el mensaje entra, aparece "escribiendo…", y
sale la respuesta.

---

## Lo que sabe hacer el bot

Está construido sobre los dos documentos de la marca (*Objetivos y Personalidad* y
*Guía de funcionamiento*), no sobre un prompt genérico.

**Personalidad.** El objetivo escrito en el prompt no es responder rápido: es que
la persona sienta que sigue hablando con alguien de Miska Muska. Detecta el motivo
del regalo antes de tirar precios, y responde distinto a un cumpleaños que a un
"mi papá está internado". Tiene la lista de frases prohibidas ("Estimado cliente",
"Su consulta ha sido recibida") y las que sí usa la marca ("Dale, te ayudo",
"Obvio", "Ya te cuento").

**Reglas que no se negocian.** Están en el prompt *y* como validaciones en código,
porque un prompt puede fallar y una guarda no:

| Regla | Dónde se aplica |
| --- | --- |
| Las tortas no se envían a domicilio | `validateOrder()` rechaza el pedido |
| Los desayunos y boxes van siempre con nuestro cadete | `validateOrder()` rechaza `uber-cliente` |
| Ninguna modificación de producto la decide el bot | `consultar_modificacion` + guarda en `crear_pedido` |
| Con una consulta abierta no se cierra el pedido ni se pide el pago | `conversations.pending_review` |
| Un pedido por charla, y solo puede crecer | `crear_pedido` fusiona o deriva, nunca inserta dos |
| Solo se venden las tortas del catálogo | el bot solo ve lo que está disponible |
| No se reserva sin transferencia | el pedido nace en estado `borrador` |
| No se ofrece nada agotado | `validateOrder()` + contexto del día |
| No se compromete más stock del producido | restricción `CHECK` en la base |
| No hay cafetería para enviar | prompt + mensaje rápido |
| Cumpleaños: solo mañana, máximo 5 | prompt |
| Sin signos de apertura, y "copa" no se usa | `policies/writing.ts`, sobre cada burbuja |

Las guardas aplican a lo que hace **el bot**. `POST /api/orders` no pasa por
`validateOrder()` a propósito: ahí hay una persona decidiendo, y el panel tiene que
poder cargar la excepción que el bot no puede.

**Herramientas.** `buscar_catalogo`, `disponibilidad_hoy`, `mensaje_rapido`,
`crear_pedido`, `consultar_modificacion`, `consultar_pedido`,
`registrar_nota_cliente`, `escalar_a_humano`. Nunca dice un precio de memoria: lo
consulta.

**Mensajes rápidos.** Los textos que el equipo ya tenía pulidos en WhatsApp están
cargados tal cual, con variables (`{{alias}}`, `{{cookiesHoy}}`, `{{direccion}}`).
El bot los trae y los usa como base en vez de redactar de cero, así los datos duros
nunca se inventan. Se editan desde el panel.

**Se hace pasar por humano donde importa.** Junta los mensajes que llegan seguidos
antes de contestar (una persona no responde tres veces a "hola" / "queria consultar"
/ "por una torta"), muestra "escribiendo…" y espera un rato proporcional al largo
del texto, y puede partir la respuesta en varias burbujas.

---

## El modelo: OpenRouter

Un solo proveedor, 367 modelos. El bot habla el dialecto de OpenAI
(`/chat/completions`) que OpenRouter expone para todos, así que **cambiar de
modelo es cambiar un string en el panel** — no hay SDK ni código que tocar.

Por defecto usa `anthropic/claude-sonnet-5` (1M de contexto, herramientas y
razonamiento, $2/$10 por millón de tokens). En **Ajustes** se puede elegir otro de
la lista o escribir cualquier slug de [openrouter.ai/models](https://openrouter.ai/models)
que soporte herramientas.

Dos cosas que hacen que valga la pena comparar:

- **Se guarda el costo real de cada turno.** OpenRouter devuelve cuánto salió cada
  llamada y queda en la base. En Métricas se ve el gasto del período y el costo por
  conversación: se elige modelo con datos, no con intuición.
- **Respaldos automáticos.** Con `OPENROUTER_FALLBACK_MODELS`, si el principal
  falla o está saturado OpenRouter prueba los otros dentro de la misma llamada.

Para los modelos de Anthropic el prompt estable (~4.900 tokens de personalidad,
forma de escribir y reglas) va marcado con `cache_control`, así que se lee de caché
en cada turno.

---

## El panel

| Vista | Para qué |
| --- | --- |
| **Bandeja** | Conversaciones en vivo. Tomar el chat (el bot calla), responder a mano, ver por cada mensaje qué herramienta usó, cuánto tardó, qué modelo respondió y cuánto costó. |
| **Pedidos** | Los que tomó el bot y los cargados a mano. Un botón marca "llegó el comprobante" y confirma. |
| **Catálogo** | Lo más usado del día: marcar qué salió del horno. Lo que se apaga acá deja de existir para el bot. |
| **Campañas** | El control de stock que el local hacía en planilla para el Día de la Madre: producidas / comprometidas / disponibles. |
| **Rápidos** | Editar los mensajes tipo y decidir cuáles se auto-responden sin pasar por el modelo. |
| **Métricas** | Conversaciones, cuántas resolvió el bot sin ayuda, demora, gasto en dólares, y qué le preguntan. |
| **Ajustes** | Encender/apagar el bot, elegir canal, modelo y esfuerzo, y cambiar los datos que el bot cita (alias, dirección, links) sin tocar código. |

La estética sale del sitio real: menta `#a8d5d3`, rosa `#e6a4ad`, Oswald para
títulos y Dancing Script para el logo. Los gráficos usan pasos más profundos de
esas mismas familias, porque los pasteles de marca no pasan las validaciones de
contraste ni de daltonismo como marcas de datos — el detalle está comentado en
`views/Metricas.tsx`.

---

## Desplegar

Resumen: **Supabase** (base) + **Vercel** (panel) + **un contenedor** (bot).

La única restricción de infraestructura es que el bot corre en **una sola
instancia**: el debounce y el mutex por conversación viven en memoria.

Paso a paso, con las trampas de cada plataforma:
[`docs/DESPLIEGUE.md`](docs/DESPLIEGUE.md).

## Migrar a WhatsApp

El adaptador ya está escrito. Migrar es configuración:

1. Completá en `.env`: `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`,
   `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_APP_SECRET`.
2. En Meta, apuntá el webhook a `https://TU-DOMINIO/webhooks/whatsapp` y suscribí
   el campo `messages`.
3. En **Ajustes**, activá WhatsApp. (Se puede tener conectado y todavía apagado.)

Lo que el adaptador absorbe por vos: la ventana de 24 h (fuera de ella solo van
plantillas aprobadas — el error 131047 se traduce en una alerta del panel), el
límite de 3 botones de 20 caracteres y 10 filas de lista, y la firma HMAC del
webhook sobre el cuerpo crudo.

Detalle completo en [`docs/MIGRACION-WHATSAPP.md`](docs/MIGRACION-WHATSAPP.md) y
las decisiones de diseño en [`docs/ARQUITECTURA.md`](docs/ARQUITECTURA.md).

---

## Comandos

```bash
npm run dev                # servidor + panel
npm run demo               # esquema + catálogo + conversaciones de ejemplo
npm run seed               # solo catálogo y mensajes rápidos (no pisa el stock del día)
npm run db:migrate         # aplica migraciones pendientes
npm run db:sql             # regenera supabase/schema.sql
npm run check              # fronteras de arquitectura + tipos
npm run build              # build de producción
npm start                  # correr lo construido
```

## Requisitos

- **Node ≥ 22**
- Un Postgres (Supabase en producción, Docker en desarrollo)
- Una API key de OpenRouter
- Un bot de Telegram (etapa 1) o una app de WhatsApp Business (etapa 2)
