# Despliegue

Tres piezas, tres lugares:

```
Vercel (CDN)            Railway / Fly.io            Supabase (us-west-2)
   panel         ──►    bot: 1 contenedor    ──►      Postgres
  React estático       webhooks + API + SSE         + backups incluidos
```

**La única restricción de infraestructura: el bot corre en UNA instancia.** El
debounce que junta los mensajes seguidos del cliente y el mutex por conversación
viven en memoria; con dos réplicas el bot contestaría dos veces al mismo cliente.
Con la base en Supabase no necesita disco, así que sí puede correr en una
plataforma de contenedores administrada — pero sin autoescalado.

---

## 1. Supabase

**Lo que importa es que el bot y la base queden en la misma región** — cuál de
todas, mucho menos.

Es contraintuitivo, pero la distancia a Tucumán casi no cuenta: el mensaje del
cliente viaja por los servidores de Telegram o Meta igual, y de ahí al bot. Lo que
sí se siente es el ida y vuelta entre el bot y la base, que ocurre unas ocho veces
por turno de conversación.

En este proyecto la base quedó en **`us-west-2` (Oregon)**, así que el bot va en
Seattle (`sea` en Fly, US West en Railway). Con las dos piezas juntas, la base
suma milisegundos; separadas, casi un segundo por mensaje.

Copiá la cadena de conexión de *Project Settings → Database → Connection string*
y elegí bien la opción:

| Opción | Puerto | ¿Sirve? |
| --- | --- | --- |
| **Pooler, modo Session** | 5432 | ✅ **Esta.** Proceso largo, soporta prepared statements |
| Pooler, modo Transaction | 6543 | ❌ Es para serverless; sin prepared statements |
| Conexión directa (`db.*.supabase.co`) | 5432 | ❌ Solo IPv6 en proyectos nuevos, y los contenedores dan IPv4 |

**Poné la contraseña aparte, no dentro de la URL:**

```bash
DATABASE_URL=postgresql://postgres.TU-PROYECTO@aws-1-us-west-2.pooler.supabase.com:5432/postgres
DATABASE_PASSWORD=la-contraseña-tal-cual-sin-escapar-nada
```

No es una manía: las contraseñas que genera Supabase traen `%` seguido de
hexadecimal muy seguido, y dentro de una URL eso se interpreta como un escape.

| Contraseña contiene | Qué pasa si va dentro de la URL |
| --- | --- |
| `%CF` | `URIError: URI malformed` — el proceso **no arranca**, y el error no menciona contraseñas |
| `%41` | se decodifica en silencio a `A` y falla la autenticación |
| `@` `#` `/` `?` | cortan la URL en el lugar equivocado |

Con `DATABASE_PASSWORD` definida, la cadena se descompone en campos sueltos y la
contraseña viaja cruda. Se ignora la que traiga la URL, si es que trae alguna.

**El esquema se aplica solo.** El bot corre las migraciones al arrancar, con un
advisory lock para que un deploy solapado no las aplique dos veces. Si preferís
provisionar la base antes del primer deploy, `supabase/schema.sql` tiene el SQL
completo para pegar en el editor de Supabase (se regenera con `npm run db:sql`).

**Aplicar una migración a mano, con la base ya en uso.** Es el caso de todos los
deploys después del primero: `supabase/migraciones/` tiene un archivo por
migración, con su registro al final.

```
supabase/migraciones/001-esquema-inicial.sql
supabase/migraciones/002-consulta-de-modificacion-y-quien-recibe.sql
supabase/migraciones/003-deduplicacion-por-conversacion.sql
```

Para saber qué falta, en el editor SQL de Supabase:

```sql
SELECT id, name, applied_at FROM _migrations ORDER BY id;
```

Y pegar los archivos que no aparezcan, en orden, **incluido el `INSERT` del
final**: es lo que le dice al servidor que ya está aplicada. Si te lo salteás no
se rompe nada —de la 2 en adelante el SQL está escrito con `IF NOT EXISTS`
justamente porque se corre a mano— pero el servidor la va a volver a intentar en
cada arranque.

Correrlas a mano es opcional: si arrancás el servicio con la migración pendiente,
la aplica él. Lo que **no** conviene es lo inverso — desplegar código viejo contra
una base ya migrada está bien, pero código nuevo contra una base sin migrar falla
en la primera consulta que use la columna nueva.

Después del primer arranque, cargá el catálogo y los mensajes rápidos:

```bash
DATABASE_URL="..." npm run seed        # catálogo + mensajes rápidos + campaña
DATABASE_URL="..." npm run demo        # además, conversaciones de ejemplo
```

Dos cosas del plan gratuito que conviene saber: **pausa el proyecto tras ~1 semana
sin actividad** (un bot con tráfico real nunca lo toca; un staging sí), y los
backups automáticos están incluidos, así que ya no hace falta el `VACUUM INTO` por
cron que necesitaba SQLite.

---

## 2. El bot

### Fly.io

`fly.toml` ya está en el repo, con Seattle (junto a tu base) y una sola máquina.

```bash
fly launch --no-deploy          # respeta el fly.toml existente
fly secrets set \
  DATABASE_URL="postgresql://..." \
  OPENROUTER_API_KEY="sk-or-..." \
  TELEGRAM_BOT_TOKEN="..." \
  TELEGRAM_WEBHOOK_SECRET="$(openssl rand -hex 24)" \
  ADMIN_TOKEN="$(openssl rand -hex 24)" \
  PUBLIC_URL="https://miska-muska-bot.fly.dev" \
  DASHBOARD_ORIGIN="https://panel-miska.vercel.app"
fly deploy
```

No toques `min_machines_running`, `auto_stop_machines` ni `count`: son lo que
garantiza una única instancia siempre despierta.

### Railway

Detecta el `Dockerfile` solo. Después:

1. Variables → las mismas de arriba.
2. Settings → **Replicas = 1**. Sin excepción.
3. Settings → Networking → generá el dominio, y usalo como `PUBLIC_URL`.
4. Elegí la región más cercana a la de Supabase.

### Un VPS con Docker

```bash
docker build -t miska-bot .
docker run -d --name miska-bot --restart=always \
  --env-file .env -p 3001:3001 --stop-timeout 15 miska-bot
```

Necesitás un reverse proxy con TLS delante (los webhooks exigen HTTPS, y Meta
exige el puerto 443). Con Caddy:

```
bot.miskamuska.com.ar {
    handle /api/stream* {
        reverse_proxy localhost:3001 {
            flush_interval -1        # sin esto el SSE se bufferea y el panel queda mudo
        }
    }
    reverse_proxy localhost:3001
}
```

En nginx el equivalente es `proxy_buffering off` más un `proxy_read_timeout`
mayor a 30 s, porque el servidor manda un ping cada 25 s para mantener el stream.

---

## 3. El panel en Vercel

`vercel.json` ya define el build del workspace correcto. Importá el repo y agregá
**una** variable de entorno:

```
VITE_API_URL = https://miska-muska-bot.fly.dev
```

Es una variable de build de Vite: **después de cambiarla hay que volver a
deployar**, no alcanza con reiniciar.

Y en el bot, `DASHBOARD_ORIGIN` tiene que ser el dominio de Vercel. Si no
coinciden, el navegador bloquea todas las llamadas con un error de CORS.

> **¿Por qué no usar rewrites de Vercel para evitar el CORS?** Porque el SSE
> atravesando el edge de Vercel se bufferea y corta, y el panel dejaría de verse
> en vivo — que es la mitad del valor. Mejor CORS bien configurado y el stream
> directo al bot.

### La reescritura del `vercel.json`

```json
"rewrites": [{ "source": "/((?!assets/|api/).*)", "destination": "/index.html" }]
```

El panel no tiene rutas, pero la reescritura evita un 404 si alguien entra a una
URL profunda o recarga. Lo que importa es **la exclusión de `/api`**: ahí no vive
nada, esa ruta la atiende el bot en otro dominio. Sin excluirla, una llamada mal
configurada recibía el `index.html` y el panel fallaba con `Unexpected token '<'`,
un error que no dice nada sobre la causa real.

> Esta explicación vive acá y no en el archivo porque `vercel.json` **no admite
> claves propias**: JSON no tiene comentarios, y el esquema de Vercel rechaza
> cualquier propiedad que no conozca con
> `should NOT have additional property`. Un `"_comment": "…"` rompe el deploy.

---

## 4. Telegram y WhatsApp en producción

```bash
TELEGRAM_MODE=webhook
PUBLIC_URL=https://tu-dominio
TELEGRAM_WEBHOOK_SECRET=<random>
```

El bot registra el webhook solo al arrancar.

> ⚠️ **Usá un bot distinto para desarrollo.** En modo polling el adaptador llama a
> `deleteWebhook`; si corrés `npm run dev` con el token de producción, le borrás
> el webhook al bot en vivo y deja de responder sin ningún error visible.

Para WhatsApp, ver [MIGRACION-WHATSAPP.md](MIGRACION-WHATSAPP.md). Lo que tiene
plazo largo y conviene arrancar ya: la verificación de negocio de Meta y la
aprobación de plantillas tardan días o semanas.

---

## 5. Checklist antes de abrir la puerta

- [ ] `DATABASE_URL` con el pooler en modo Session
- [ ] Bot y Supabase en la misma región
- [ ] **1 réplica**, sin autoescalado, sin dormir la máquina
- [ ] `ADMIN_TOKEN` puesto (sin él la API de gestión está abierta)
- [ ] `DASHBOARD_ORIGIN` = dominio de Vercel, y `VITE_API_URL` = dominio del bot
- [ ] `TELEGRAM_WEBHOOK_SECRET` y `WHATSAPP_APP_SECRET` configurados
- [ ] Un bot de Telegram separado para desarrollo
- [ ] El proxy no loguea query strings (el token del panel viaja ahí, ver abajo)
- [ ] `npm run seed` corrido contra la base de producción
- [ ] Una conversación de prueba completa: entra, contesta, toma un pedido

---

## 6. Si la base no conecta

| Error | Causa |
| --- | --- |
| `URIError: URI malformed` | La contraseña está dentro de `DATABASE_URL` y tiene `%` + hexadecimal. Movela a `DATABASE_PASSWORD` |
| `password authentication failed` | Quedó el `[YOUR-PASSWORD]` literal, o la contraseña está en la URL y se decodificó mal |
| `ENOTFOUND` / `EHOSTUNREACH` | Agarraste la conexión directa (`db.*.supabase.co`) en vez del pooler: es solo IPv6 |
| `prepared statement ... already exists` | Estás en el pooler de *transaction* (6543). Cambiá a *session* (5432) |
| `self signed certificate` | Te quedó `DATABASE_SSL=0` del entorno local. Quitalo para Supabase |
| `too many clients` | Bajá `DATABASE_POOL_MAX`, o quedó otra instancia corriendo |

Para probar la conexión sin levantar todo el bot:

```bash
npm run db:migrate      # aplica migraciones e informa cuáles corrió
```

---

## 7. Lo que hay que saber y no es obvio

**El token del panel viaja en el query string del SSE.** `EventSource` no puede
mandar encabezados. Eso termina en los logs de acceso del proxy: no loguees query
strings, o poné el panel detrás de la autenticación del proxy y dejá `ADMIN_TOKEN`
como segunda capa.

**`/health` devuelve 200 aunque un canal esté caído.** Es a propósito: un token
vencido de Telegram no debería reiniciar el proceso en bucle. Para saber si un
canal está mal, mirá el campo `channels` de la respuesta o el semáforo del panel.

**No hay límite de tasa.** Nadie impide que una persona mande 200 mensajes y
queme tokens. El interruptor de apagado está en el panel y las métricas muestran
el gasto real en dólares por día, pero la protección automática no existe.

**El costo se registra por turno.** OpenRouter devuelve el costo de cada llamada
y se guarda en `messages.cost_usd`. En Métricas se ve el gasto del período y el
costo por conversación: sirve para comparar modelos con datos y no con intuición.

**Los secretos no van en un `.env` en producción.** Usá los secretos de la
plataforma. El `.env` es para tu máquina.
