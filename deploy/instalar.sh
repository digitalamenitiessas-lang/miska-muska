#!/usr/bin/env bash
# Despliegue del bot en un VPS que ya tiene otros servicios.
#
#   bash deploy/instalar.sh
#
# Es idempotente: se puede correr las veces que haga falta.
#
# Qué NO hace, a propósito:
#   · no instala Docker ni ningún paquete del sistema
#   · no edita la configuración de nginx, Caddy ni de ningún servicio existente
#   · no abre puertos en el firewall
#   · no toca otros contenedores
# Cuando algo de eso hace falta, imprime el comando exacto y se detiene.

set -uo pipefail
cd "$(dirname "$0")/.." || exit 1

ok()    { printf '  \033[32m✔\033[0m %s\n' "$1"; }
mal()   { printf '  \033[31m✗\033[0m %s\n' "$1"; }
info()  { printf '  \033[2m·\033[0m %s\n' "$1"; }
paso()  { printf '\n\033[1m%s\033[0m\n' "$1"; }
morir() { printf '\n\033[31mCortado:\033[0m %s\n' "$1"; [ $# -gt 1 ] && printf '\n%s\n' "$2"; exit 1; }

PUERTO_PREFERIDO=3011
COMPOSE="deploy/docker-compose.yml"

# --- 1. Requisitos ----------------------------------------------------------
paso "1. Requisitos"

command -v docker >/dev/null 2>&1 || morir "No encontré Docker." \
  "Instalalo con:  curl -fsSL https://get.docker.com | sh"
ok "$(docker --version)"

if docker compose version >/dev/null 2>&1; then
  DC="docker compose"
elif command -v docker-compose >/dev/null 2>&1; then
  DC="docker-compose"
else
  morir "No encontré Docker Compose." "Instalalo con:  sudo apt install docker-compose-plugin"
fi
ok "$($DC version | head -1)"

docker info >/dev/null 2>&1 || morir "No puedo hablar con el demonio de Docker." \
  "Probá con sudo, o agregá tu usuario al grupo:  sudo usermod -aG docker \$USER  (y volvé a entrar)"
ok "El demonio de Docker responde"

# --- 2. Variables -----------------------------------------------------------
paso "2. Variables de entorno"

[ -f .env ] || morir "Falta el archivo .env" "Copialo del ejemplo:  cp .env.example .env  &&  nano .env"

leer() { grep -E "^$1=" .env | head -1 | cut -d= -f2- | sed 's/[[:space:]]*$//'; }

FALTAN=()
for v in DATABASE_URL DATABASE_PASSWORD OPENROUTER_API_KEY TELEGRAM_BOT_TOKEN; do
  [ -n "$(leer "$v")" ] || FALTAN+=("$v")
done
[ ${#FALTAN[@]} -eq 0 ] || morir "Faltan variables en el .env: ${FALTAN[*]}"
ok "Las cuatro variables obligatorias están cargadas"

# Errores que cuestan una hora de depuración si no se avisan acá.
#
# Para detectar la contraseña embebida hay que mirar SOLO la parte entre '://' y
# '@'. Un `case` sobre la URL entera da falso positivo siempre: el ':' del
# esquema (postgresql:) y el del puerto alcanzan para hacerlo saltar.
URL_BD="$(leer DATABASE_URL)"
RESTO="${URL_BD#*://}"
case "$RESTO" in
  *@*) USERINFO="${RESTO%%@*}"
       case "$USERINFO" in
         *:*) mal "La contraseña está DENTRO de DATABASE_URL."
              morir "Sacala de ahí y dejala solo en DATABASE_PASSWORD." \
                    "Si tiene un '%', dentro de la URL se lee como un escape y el proceso ni arranca." ;;
       esac ;;
esac
ok "DATABASE_URL no lleva contraseña embebida"

case "$URL_BD" in
  *:6543/*) mal "Estás usando el pooler en modo transaction (6543)."
            morir "Cambiá al modo session (5432): un proceso largo necesita prepared statements." ;;
esac
ok "DATABASE_URL apunta al pooler en modo session"

for v in ADMIN_TOKEN PUBLIC_URL DASHBOARD_ORIGIN; do
  [ -n "$(leer "$v")" ] && ok "$v definida" || info "$v vacía — hace falta para producción"
done
[ "$(leer TELEGRAM_MODE)" = "webhook" ] && ok "Telegram en modo webhook" \
  || info "TELEGRAM_MODE no es 'webhook' — en un servidor conviene webhook"

PERMISOS=$(stat -c '%a' .env 2>/dev/null)
[ "$PERMISOS" = "600" ] && ok ".env con permisos 600" \
  || { chmod 600 .env 2>/dev/null && ok ".env ajustado a permisos 600 (estaba en $PERMISOS)"; }

# --- 3. Puerto libre --------------------------------------------------------
paso "3. Puerto"

ocupado() {
  if command -v ss >/dev/null 2>&1; then ss -tln 2>/dev/null | grep -q ":$1 "
  elif command -v netstat >/dev/null 2>&1; then netstat -tln 2>/dev/null | grep -q ":$1 "
  else return 1; fi
}

PUERTO=""
for p in $PUERTO_PREFERIDO 3012 3013 3014 3015; do
  if ocupado "$p"; then
    # Si lo ocupa nuestro propio contenedor, está bien: es un redespliegue.
    if docker ps --filter name=miska-bot --format '{{.Ports}}' 2>/dev/null | grep -q ":$p->"; then
      PUERTO=$p; ok "El puerto $p ya lo usa este mismo bot (redespliegue)"; break
    fi
    info "$p ocupado por otro servicio"
  else
    PUERTO=$p; ok "$p libre"; break
  fi
done
[ -n "$PUERTO" ] || morir "No encontré puerto libre entre $PUERTO_PREFERIDO y 3015."

if [ "$PUERTO" != "$PUERTO_PREFERIDO" ]; then
  info "Ajustando el compose al puerto $PUERTO"
  sed -i "s|127\.0\.0\.1:[0-9]*:3001|127.0.0.1:$PUERTO:3001|" "$COMPOSE"
fi

# --- 4. Salida a internet ---------------------------------------------------
paso "4. Conectividad"
for d in $(leer DATABASE_URL | sed -E 's|.*@([^:/]+).*|\1|') openrouter.ai api.telegram.org; do
  if timeout 6 bash -c "</dev/tcp/$d/443" 2>/dev/null; then ok "$d:443"
  else mal "$d:443 no responde — revisá el firewall de salida"; fi
done

# --- 5. Construir y levantar ------------------------------------------------
paso "5. Construyendo y levantando"
$DC -f "$COMPOSE" up -d --build 2>&1 | tail -12 || morir "Falló el build. Mirá el detalle arriba."

# --- 6. Verificar -----------------------------------------------------------
paso "6. Verificando"
info "Esperando a que el bot responda…"
LISTO=0
for i in $(seq 1 60); do
  if curl -fsS "http://127.0.0.1:$PUERTO/health" >/dev/null 2>&1; then LISTO=1; break; fi
  sleep 2
done

if [ "$LISTO" != "1" ]; then
  mal "El bot no respondió en 120 s. Últimas líneas del log:"
  $DC -f "$COMPOSE" logs --tail 30 bot
  morir "Revisá el log de arriba: casi siempre es DATABASE_URL o DATABASE_PASSWORD."
fi

ok "El bot responde en 127.0.0.1:$PUERTO"
curl -s "http://127.0.0.1:$PUERTO/health" | sed 's/^/     /'
echo

# --- 7. Qué falta -----------------------------------------------------------
paso "7. Falta publicarlo (esto lo hacés vos, no lo toco)"
cat <<FIN

  El bot escucha SOLO en localhost. Para que Telegram y el panel lleguen,
  agregá un vhost nuevo en tu proxy — ningún archivo existente se modifica:

  nginx:
    sudo sed 's|127.0.0.1:3011|127.0.0.1:$PUERTO|' deploy/nginx-miska.conf \\
      > /etc/nginx/sites-available/miska-bot
    sudo ln -sf /etc/nginx/sites-available/miska-bot /etc/nginx/sites-enabled/
    sudo nginx -t                 # si falla, NO recargues: no se rompió nada
    sudo systemctl reload nginx
    sudo certbot --nginx -d TU-DOMINIO

  Caddy:
    pegá deploy/Caddyfile.snippet al final de /etc/caddy/Caddyfile
    (cambiando 3011 por $PUERTO), y después:
    sudo caddy validate --config /etc/caddy/Caddyfile && sudo systemctl reload caddy

  Y para cerrar con Vercel:
    · en Vercel:  VITE_API_URL = https://TU-DOMINIO
    · en el .env: DASHBOARD_ORIGIN = https://tu-panel.vercel.app
    · después:    $DC -f $COMPOSE restart

  Operación:
    $DC -f $COMPOSE logs -f
    $DC -f $COMPOSE restart
    git pull && $DC -f $COMPOSE up -d --build

FIN
