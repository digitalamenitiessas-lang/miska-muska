# Desplegar el bot en un VPS que ya tiene otras cosas corriendo

El objetivo de estos archivos es que el bot conviva con lo que ya está en el
servidor sin tocarlo. Nada de lo que sigue modifica configuración existente:
todo se agrega como archivos nuevos.

Por qué esto es más fácil de lo que parece: **el bot no guarda nada en disco.**
La base está en Supabase, así que el proceso es descartable — se puede borrar y
recrear sin perder un solo pedido.

Hay dos caminos. Elegí uno según con qué convive el bot:

| | **Ruta A — systemd** | **Ruta B — Docker** |
| --- | --- | --- |
| Cuándo | El VPS ya corre servicios con systemd, o tiene poca RAM / un núcleo | El VPS ya usa Docker, o querés el proceso aislado |
| Cuesta | Node 22 en `/opt/node22` (~50 MB) | El demonio de Docker (~150 MB RAM, ~500 MB disco, cadenas de iptables) |
| Script | `deploy/instalar-systemd.sh` | `deploy/instalar.sh` |

---

## Cómo está desplegado hoy

En el VPS compartido `2.25.185.242`, por la **ruta A**:

| | |
| --- | --- |
| Código | `/opt/miska-muska`, del usuario `miskabot` |
| Runtime | Node 22 en `/opt/node22` — el `/usr/bin/node` del sistema (v20) quedó intacto |
| Servicio | `miska-bot.service`, habilitado al arranque, ~25 MB de RSS |
| Escucha | `127.0.0.1:3011` — nada expuesto a internet |
| URL pública | `https://vps.marcorossi.com.ar/miska-bot`, por subpath en el Caddy que ya estaba |
| Panel | `https://miska-muska.vercel.app` |

Convive con otros nueve servicios (Caddy, el compresor de audio, el worker de
WhatsApp de MALALA y seis bots de Telegram) sin tocar ninguno.

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

# Ruta A — systemd

Un solo script hace todo. Es idempotente: corrélo las veces que haga falta.

```bash
sudo mkdir -p /opt/miska-muska
# desde tu máquina, si el repo no está publicado todavía:
#   tar -czf - --exclude=node_modules --exclude=.git --exclude=dist --exclude='.env*' . \
#     | ssh root@TU-IP 'tar -xzf - -C /opt/miska-muska'

bash deploy/preparar-env.sh vps.tudominio.com/miska-bot   # en TU máquina
scp .env.produccion root@TU-IP:/opt/miska-muska/.env

ssh root@TU-IP 'cd /opt/miska-muska && sudo bash deploy/instalar-systemd.sh'
```

El script instala Node 22 en `/opt/node22` (sin tocar el node del sistema, que
comparten los demás servicios), crea el usuario `miskabot`, compila solo el
workspace del servidor, instala la unit y espera a que `/health` responda.

Lo que **no** hace, a propósito: no edita el proxy, no abre puertos, no toca
ningún otro servicio. Cuando algo de eso hace falta, imprime el bloque exacto y
se detiene.

> El chequeo que evita el peor error: sin Docker no hay mapeo de puertos que
> contenga al proceso. Si el `.env` trae `HOST=0.0.0.0` y el firewall está
> inactivo, la API de gestión queda colgada de internet sin TLS. El script se
> planta ahí y no arranca.

Después, publicarlo con el proxy: si es un subdominio propio va
`deploy/Caddyfile.snippet`; si va colgado de un dominio que Caddy ya sirve,
`deploy/Caddyfile.subpath.snippet`. Y cerrar con Vercel, igual que en el paso 5.

**Operación:**

```bash
journalctl -u miska-bot -f            # logs en vivo
systemctl restart miska-bot           # reiniciar
systemctl status miska-bot            # estado, memoria, PID

# actualizar: traer el código nuevo y volver a correr el instalador
cd /opt/miska-muska && sudo bash deploy/instalar-systemd.sh
```

---

# Ruta B — Docker

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

# Si algo no anda

Vale para las dos rutas.

| Síntoma | Causa |
| --- | --- |
| `bind: address already in use` | El 3011 estaba ocupado. En Docker cambiá el lado izquierdo del mapeo; en systemd, `PORT` en el `.env`. En los dos casos, también el proxy |
| El proceso reinicia en bucle | `journalctl -u miska-bot -n 50` o `docker compose logs bot` — casi siempre es `DATABASE_URL` o `DATABASE_PASSWORD` |
| `URIError: URI malformed` | La contraseña quedó dentro de `DATABASE_URL`. Va en `DATABASE_PASSWORD` |
| El panel carga pero la bandeja no se mueve | Falta `proxy_buffering off` / `flush_interval -1` |
| El panel no carga nada, error de CORS | `DASHBOARD_ORIGIN` y `VITE_API_URL` no coinciden |
| Telegram no manda nada | `PUBLIC_URL` mal, o el certificado no es válido. Probá `curl https://TU-URL/health` desde afuera, y mirá `getWebhookInfo` |
| Telegram deja de responder de golpe | Alguien corrió `npm run dev` con el token de producción: el modo polling llama a `deleteWebhook`. Reiniciá el servicio para volver a registrarlo |
| `nginx -t` / `caddy validate` falla | No recargues. El error dice archivo y línea; si es de este bloque, nada se rompió |
| El servicio arranca y muere sin log | Falta el `.env` en `/opt/miska-muska`, o no lo puede leer `miskabot` |

---

# Lo que hay que respetar

**Una sola instancia.** No escales esto ni pongas dos réplicas. El debounce que
junta los mensajes seguidos del cliente y el mutex por conversación viven en
memoria del proceso; con dos, el bot contestaría dos veces al mismo cliente.

**No expongas el 3011 a internet.** El proxy es quien debe atender: es el que
tiene el TLS, y Meta exige el 443.

**No loguees query strings** en el vhost, o poné el panel detrás de la
autenticación del proxy: el token del panel viaja ahí porque `EventSource` no
puede mandar encabezados.
