# Desplegar el bot en un VPS que ya tiene otras cosas corriendo

El objetivo de estos archivos es que el bot conviva con lo que ya está en el
servidor sin tocarlo. Nada de lo que sigue modifica configuración existente:
todo se agrega como archivos nuevos.

Por qué esto es más fácil de lo que parece: **el bot no guarda nada en disco.**
La base está en Supabase, así que el contenedor es descartable — se puede borrar
y recrear sin perder un solo pedido.

---

## Paso 0 — Mirar antes de tocar

```bash
bash deploy/diagnostico.sh
```

Solo lee: no instala, no modifica, no reinicia nada. Informa qué contenedores
hay, qué puertos están ocupados, qué proxy inverso corre, qué certificados
existen y si el servidor llega a Supabase, OpenRouter y Telegram.

Con esa salida se elige puerto y proxy sin adivinar.

---

## Paso 1 — Traer el código

```bash
sudo mkdir -p /opt/miska-muska && sudo chown "$USER" /opt/miska-muska
git clone https://github.com/digitalamenitiessas-lang/miska-muska.git /opt/miska-muska
cd /opt/miska-muska
```

---

## Paso 2 — Las variables

```bash
cp .env.example .env
nano .env
```

Lo que no puede faltar:

| Variable | Valor |
| --- | --- |
| `DATABASE_URL` | la del pooler de Supabase en modo *Session*, **sin la contraseña** |
| `DATABASE_PASSWORD` | la contraseña, cruda, sin escapar nada |
| `OPENROUTER_API_KEY` | de openrouter.ai/keys |
| `TELEGRAM_BOT_TOKEN` | de @BotFather |
| `TELEGRAM_MODE` | `webhook` |
| `PUBLIC_URL` | `https://bot.tudominio.com` |
| `TELEGRAM_WEBHOOK_SECRET` | `openssl rand -hex 24` |
| `ADMIN_TOKEN` | `openssl rand -hex 24` — sin esto la API de gestión queda abierta |
| `DASHBOARD_ORIGIN` | el dominio que te dé Vercel |

Y sacá `SUPABASE_ACCESS_TOKEN` si quedó: solo servía para la configuración inicial.

```bash
chmod 600 .env      # que no lo lea cualquier usuario del servidor
```

---

## Paso 3 — Levantarlo

```bash
docker compose -f deploy/docker-compose.yml up -d --build
docker compose -f deploy/docker-compose.yml logs -f
```

Tendrías que ver las migraciones (ya aplicadas), el seed, y:

```
INFO Servidor escuchando en http://0.0.0.0:3001
INFO Canal telegram: ok — @tu_bot (webhook)
```

Comprobar sin salir del servidor:

```bash
curl -s http://127.0.0.1:3011/health
```

El contenedor escucha **solo en localhost**. Todavía no es alcanzable desde
internet: eso lo hace el proxy en el paso siguiente.

---

## Paso 4 — Publicarlo con el proxy que ya tenés

**nginx** — archivo nuevo, ningún vhost existente se toca:

```bash
sudo cp deploy/nginx-miska.conf /etc/nginx/sites-available/miska-bot
sudo ln -s /etc/nginx/sites-available/miska-bot /etc/nginx/sites-enabled/
sudo nginx -t                    # valida TODA la config: si falla, no recargues
sudo systemctl reload nginx
sudo certbot --nginx -d bot.tudominio.com
```

**Caddy** — pegar `deploy/Caddyfile.snippet` al final del `/etc/caddy/Caddyfile`:

```bash
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

> El detalle que se olvida siempre: el stream del panel necesita que el proxy
> **no acumule la respuesta**. Es `proxy_buffering off` en nginx y
> `flush_interval -1` en Caddy, y ya están en los dos archivos. Sin eso el panel
> carga pero la bandeja no se mueve.

---

## Paso 5 — Cerrar el círculo con Vercel

En Vercel: `VITE_API_URL = https://bot.tudominio.com`
En el VPS: `DASHBOARD_ORIGIN = https://tu-panel.vercel.app`

Si no se apuntan mutuamente, el panel carga pero el navegador bloquea las
llamadas por CORS. Es el error más común de todo el despliegue.

Después de cambiar `DASHBOARD_ORIGIN`:

```bash
docker compose -f deploy/docker-compose.yml restart
```

---

## Operación

```bash
# ver logs
docker compose -f deploy/docker-compose.yml logs -f --tail 100

# actualizar a la última versión
git pull && docker compose -f deploy/docker-compose.yml up -d --build

# reiniciar
docker compose -f deploy/docker-compose.yml restart

# apagar el bot sin tocar nada más del servidor
docker compose -f deploy/docker-compose.yml down
```

`down` borra el contenedor y no pasa nada: no hay volúmenes, los datos están en
Supabase.

---

## Si algo no anda

| Síntoma | Causa |
| --- | --- |
| `bind: address already in use` | El 3011 estaba ocupado. Cambiá el lado izquierdo del mapeo en `docker-compose.yml` y el `proxy_pass` del vhost |
| El contenedor reinicia en bucle | `docker compose logs bot` — casi siempre es `DATABASE_URL` o `DATABASE_PASSWORD` |
| `URIError: URI malformed` | La contraseña quedó dentro de `DATABASE_URL`. Va en `DATABASE_PASSWORD` |
| El panel carga pero la bandeja no se mueve | Falta `proxy_buffering off` / `flush_interval -1` |
| El panel no carga nada, error de CORS | `DASHBOARD_ORIGIN` y `VITE_API_URL` no coinciden |
| Telegram no manda nada | `PUBLIC_URL` mal, o el certificado no es válido. Probá `curl https://bot.tudominio.com/health` desde afuera |
| `nginx -t` falla | No recargues. El error dice archivo y línea; si es de este vhost, nada se rompió |

---

## Lo que hay que respetar

**Una sola instancia.** No escales esto ni pongas dos réplicas. El debounce que
junta los mensajes seguidos del cliente y el mutex por conversación viven en
memoria del proceso; con dos, el bot contestaría dos veces al mismo cliente.

**No expongas el 3011 a internet.** El proxy es quien debe atender: es el que
tiene el TLS, y Meta exige el 443.

**No loguees query strings** en el vhost, o poné el panel detrás de la
autenticación del proxy: el token del panel viaja ahí porque `EventSource` no
puede mandar encabezados.
