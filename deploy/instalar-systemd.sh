#!/usr/bin/env bash
# Despliegue del bot de Miska Muska en un VPS, como servicio de systemd.
#
#   sudo bash deploy/instalar-systemd.sh
#
# Es idempotente: se puede correr las veces que haga falta.
#
# Por qué systemd y no Docker: el VPS ya sostiene nueve servicios con este mismo
# patrón (unit + node) y tiene un solo núcleo. Sumar el demonio de Docker era
# una pieza nueva —memoria, disco y cadenas de iptables— para un proceso que
# tiene dos dependencias (fastify y pg) y no guarda nada en disco.
#
# Qué NO hace, a propósito:
#   · no toca el node del sistema: instala Node 22 aparte, en /opt/node22
#   · no edita el Caddyfile ni ningún otro servicio existente
#   · no abre puertos ni toca el firewall
# Cuando algo de eso hace falta, imprime el bloque exacto y se detiene.

set -uo pipefail
cd "$(dirname "$0")/.." || exit 1
RAIZ="$(pwd)"

ok()    { printf '  \033[32m✔\033[0m %s\n' "$1"; }
mal()   { printf '  \033[31m✗\033[0m %s\n' "$1"; }
info()  { printf '  \033[2m·\033[0m %s\n' "$1"; }
paso()  { printf '\n\033[1m%s\033[0m\n' "$1"; }
morir() { printf '\n\033[31mCortado:\033[0m %s\n' "$1"; [ $# -gt 1 ] && printf '\n%s\n' "$2"; exit 1; }

USUARIO=miskabot
NODE_DIR=/opt/node22
UNIT=/etc/systemd/system/miska-bot.service
SERVICIO=miska-bot

# --- 1. Requisitos ----------------------------------------------------------
paso "1. Requisitos"

[ "$(id -u)" = "0" ] || morir "Hay que correrlo como root." "sudo bash deploy/instalar-systemd.sh"
ok "corriendo como root"

command -v systemctl >/dev/null 2>&1 || morir "No encontré systemd."
for c in curl tar; do
  command -v "$c" >/dev/null 2>&1 || morir "Falta '$c'." "sudo apt install -y $c"
done
ok "systemd, curl y tar disponibles"

[ "$RAIZ" = "/opt/miska-muska" ] || info "El repo está en $RAIZ (la unit apunta a /opt/miska-muska)"

# --- 2. Node 22 aislado -----------------------------------------------------
paso "2. Node 22 en $NODE_DIR"

necesita_node() {
  [ -x "$NODE_DIR/bin/node" ] || return 0
  case "$("$NODE_DIR/bin/node" --version 2>/dev/null)" in v22.*) return 1 ;; *) return 0 ;; esac
}

if necesita_node; then
  info "Resolviendo la última 22.x…"
  VER=$(curl -fsSL --max-time 30 https://nodejs.org/dist/index.json 2>/dev/null \
        | grep -oE '"version":"v22\.[0-9]+\.[0-9]+"' | head -1 | cut -d'"' -f4)
  [ -n "$VER" ] || morir "No pude resolver la versión de Node 22 desde nodejs.org." \
    "Revisá la salida a internet del servidor."
  TGZ="node-$VER-linux-x64.tar.xz"
  info "Bajando $VER…"
  TMP=$(mktemp -d)
  curl -fsSL --max-time 300 "https://nodejs.org/dist/$VER/$TGZ" -o "$TMP/$TGZ" \
    || { rm -rf "$TMP"; morir "Falló la descarga de Node $VER."; }
  # Se extrae a un directorio nuevo y recién después se reemplaza, para que un
  # corte a mitad de camino no deje un /opt/node22 roto.
  mkdir -p "$TMP/x" && tar -xJf "$TMP/$TGZ" -C "$TMP/x" --strip-components=1 \
    || { rm -rf "$TMP"; morir "Falló la extracción de Node $VER."; }
  rm -rf "$NODE_DIR" && mv "$TMP/x" "$NODE_DIR"
  rm -rf "$TMP"
  ok "Node $("$NODE_DIR/bin/node" --version) instalado en $NODE_DIR"
else
  ok "Node $("$NODE_DIR/bin/node" --version) ya estaba en $NODE_DIR"
fi

NODE="$NODE_DIR/bin/node"
NPM="$NODE_DIR/bin/npm"
info "El node del sistema ($(command -v node >/dev/null 2>&1 && node --version || echo 'ninguno')) queda intacto"

# --- 3. Variables de entorno ------------------------------------------------
paso "3. Variables de entorno"

[ -f .env ] || morir "Falta el archivo .env en $RAIZ" \
  "Generalo en TU máquina y copialo:
    bash deploy/preparar-env.sh vps.tudominio.com/miska-bot
    scp .env.produccion root@TU-IP:/opt/miska-muska/.env"

leer() { grep -E "^$1=" .env | head -1 | cut -d= -f2- | sed 's/[[:space:]]*$//'; }

FALTAN=()
for v in DATABASE_URL DATABASE_PASSWORD OPENROUTER_API_KEY TELEGRAM_BOT_TOKEN; do
  [ -n "$(leer "$v")" ] || FALTAN+=("$v")
done
[ ${#FALTAN[@]} -eq 0 ] || morir "Faltan variables en el .env: ${FALTAN[*]}"
ok "las cuatro variables obligatorias están cargadas"

# Errores que cuestan una hora de depuración si no se avisan acá. Para detectar
# la contraseña embebida hay que mirar SOLO la parte entre '://' y '@': un
# `case` sobre la URL entera salta siempre por el ':' del esquema y del puerto.
URL_BD="$(leer DATABASE_URL)"
RESTO="${URL_BD#*://}"
case "$RESTO" in
  *@*) case "${RESTO%%@*}" in
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

# --- 4. Puerto y binding ----------------------------------------------------
paso "4. Puerto y binding"

PUERTO="$(leer PORT)"; PUERTO="${PUERTO:-3011}"
BIND="$(leer HOST)";   BIND="${BIND:-127.0.0.1}"

# Con Docker el mapeo 127.0.0.1:3011 alcanzaba para no exponer nada. Nativo no
# hay mapeo: lo que diga HOST es lo que se abre de verdad. Y en este VPS ufw
# está inactivo, así que un 0.0.0.0 deja la API de gestión colgada de internet
# sin TLS.
case "$BIND" in
  127.0.0.1|localhost|::1) ok "HOST=$BIND — solo loopback, publica el proxy" ;;
  *) mal "HOST=$BIND expone el bot directo a internet."
     morir "Sin Docker no hay mapeo de puertos que lo contenga, y ufw está inactivo." \
           "Poné  HOST=127.0.0.1  en el .env y volvé a correr esto." ;;
esac

ocupado() {
  if command -v ss >/dev/null 2>&1; then ss -tln 2>/dev/null | grep -q ":$1 "
  elif command -v netstat >/dev/null 2>&1; then netstat -tln 2>/dev/null | grep -q ":$1 "
  else return 1; fi
}

if ocupado "$PUERTO"; then
  if systemctl is-active --quiet "$SERVICIO" 2>/dev/null; then
    ok "el puerto $PUERTO ya lo usa este mismo bot (redespliegue)"
  else
    mal "El puerto $PUERTO está ocupado por otro servicio."
    morir "Elegí otro en el .env (PORT=) y acordate de cambiarlo también en el Caddyfile."
  fi
else
  ok "puerto $PUERTO libre"
fi

# --- 5. Usuario del servicio ------------------------------------------------
paso "5. Usuario del servicio"

if id "$USUARIO" >/dev/null 2>&1; then
  ok "el usuario $USUARIO ya existe"
else
  useradd --system --home-dir "$RAIZ" --no-create-home --shell /usr/sbin/nologin "$USUARIO" \
    || morir "No pude crear el usuario $USUARIO."
  ok "usuario $USUARIO creado (sin shell, sin home propio)"
fi

# --- 6. Compilar ------------------------------------------------------------
paso "6. Instalando dependencias y compilando"

if [ -d .git ]; then
  info "repo git: $(git rev-parse --short HEAD 2>/dev/null || echo '?')"
else
  info "el directorio no es un clon de git (copia directa) — el update es volver a copiar"
fi

# Solo el workspace del servidor. El panel va a Vercel: instalar sus devDeps
# (vite, react) acá sería bajar cientos de megas para nada, y en un núcleo se
# nota.
info "npm ci (solo @miska/server)…"
"$NPM" ci --workspace @miska/server --include-workspace-root 2>&1 | tail -5 \
  || morir "Falló npm ci. Mirá el detalle arriba."
ok "dependencias instaladas"

info "compilando TypeScript…"
"$NPM" run build --workspace @miska/server 2>&1 | tail -15 \
  || morir "Falló la compilación. Mirá el detalle arriba."
[ -f apps/server/dist/main.js ] || morir "El build terminó pero no hay apps/server/dist/main.js."
ok "apps/server/dist/main.js listo"

# --- 7. Permisos ------------------------------------------------------------
paso "7. Permisos"

chown -R "$USUARIO:$USUARIO" "$RAIZ"
chmod 600 .env
chown "$USUARIO:$USUARIO" .env
ok "$RAIZ es de $USUARIO · .env en 600"

# --- 8. Servicio ------------------------------------------------------------
paso "8. Servicio de systemd"

install -m 644 deploy/miska-bot.service "$UNIT"
systemctl daemon-reload
systemctl enable "$SERVICIO" >/dev/null 2>&1
ok "$UNIT instalada y habilitada al arranque"

systemctl restart "$SERVICIO" || morir "systemctl restart falló." "journalctl -u $SERVICIO -n 40 --no-pager"
ok "servicio arrancado"

# --- 9. Verificar -----------------------------------------------------------
paso "9. Verificando"
info "esperando a que el bot responda…"
LISTO=0
for _ in $(seq 1 45); do
  curl -fsS "http://127.0.0.1:$PUERTO/health" >/dev/null 2>&1 && { LISTO=1; break; }
  systemctl is-active --quiet "$SERVICIO" || break
  sleep 2
done

if [ "$LISTO" != "1" ]; then
  mal "El bot no respondió en 90 s. Últimas líneas del log:"
  journalctl -u "$SERVICIO" -n 30 --no-pager | sed 's/^/     /'
  morir "Revisá el log de arriba: casi siempre es DATABASE_URL o DATABASE_PASSWORD."
fi

ok "el bot responde en 127.0.0.1:$PUERTO"
curl -s "http://127.0.0.1:$PUERTO/health" | sed 's/^/     /'
echo

# --- 10. Qué falta ----------------------------------------------------------
paso "10. Falta publicarlo (esto no lo toco)"
cat <<FIN

  El bot escucha SOLO en 127.0.0.1:$PUERTO. Para que Telegram y el panel
  lleguen, agregá el bloque de deploy/Caddyfile.subpath.snippet DENTRO del site
  block que ya existe, antes del \`handle\` genérico. Después:

    sudo cp /etc/caddy/Caddyfile /etc/caddy/Caddyfile.bak.\$(date +%Y%m%d%H%M%S)
    sudo caddy validate --config /etc/caddy/Caddyfile   # si falla, NO recargues
    sudo systemctl reload caddy

  Y para cerrar con Vercel:
    · en Vercel:  VITE_API_URL = el mismo valor que PUBLIC_URL del .env
    · en el .env: DASHBOARD_ORIGIN = la URL del panel
    · después:    sudo systemctl restart $SERVICIO

  Operación:
    journalctl -u $SERVICIO -f
    systemctl restart $SERVICIO
    systemctl status $SERVICIO

FIN
