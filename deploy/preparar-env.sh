#!/usr/bin/env bash
# Genera el .env de producción a partir del .env de desarrollo.
#
#   bash deploy/preparar-env.sh bot.midominio.com
#
# El primer argumento admite un subpath, para cuando el bot vive colgado de un
# dominio que el proxy ya sirve:
#
#   bash deploy/preparar-env.sh vps.midominio.com/miska-bot
#
# Corre en TU máquina y escribe `.env.produccion`, listo para copiar al servidor.
# Nunca imprime el valor de una credencial: solo dice si está o no.
#
# Qué cambia respecto del .env local:
#   · TELEGRAM_MODE pasa a webhook (en un servidor el polling no corresponde)
#   · agrega PUBLIC_URL con el dominio que le pases
#   · genera ADMIN_TOKEN y TELEGRAM_WEBHOOK_SECRET al azar
#   · deja DASHBOARD_ORIGIN apuntando al panel de Vercel
#   · DESCARTA lo que solo servía para configurar desde tu máquina
#     (SUPABASE_ACCESS_TOKEN, contraseñas del servidor, DATABASE_SSL)

set -uo pipefail
cd "$(dirname "$0")/.." || exit 1

DOMINIO="${1:-}"
PANEL="${2:-https://miska-muska.vercel.app}"
ORIGEN=".env"
DESTINO=".env.produccion"

[ -n "$DOMINIO" ] || { echo "Uso: bash deploy/preparar-env.sh TU-DOMINIO [URL-DEL-PANEL]"; exit 1; }
[ -f "$ORIGEN" ]  || { echo "No encuentro $ORIGEN"; exit 1; }

DOMINIO="${DOMINIO#https://}"; DOMINIO="${DOMINIO#http://}"; DOMINIO="${DOMINIO%/}"
PANEL="${PANEL%/}"

leer() { grep -E "^$1=" "$ORIGEN" | head -1 | cut -d= -f2-; }

aleatorio() {
  if command -v openssl >/dev/null 2>&1; then openssl rand -hex 24
  else node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"; fi
}

FALTAN=()
for v in DATABASE_URL DATABASE_PASSWORD OPENROUTER_API_KEY TELEGRAM_BOT_TOKEN; do
  [ -n "$(leer "$v")" ] || FALTAN+=("$v")
done
[ ${#FALTAN[@]} -eq 0 ] || { echo "Faltan en $ORIGEN: ${FALTAN[*]}"; exit 1; }

ADMIN_TOKEN_NUEVO="$(aleatorio)"
WEBHOOK_SECRET_NUEVO="$(aleatorio)"

# Se resuelve antes: `${$(cmd):-5}` no es sustitución válida en bash y aborta el
# bloque entero, dejando el archivo escrito a medias.
POOL="$(leer DATABASE_POOL_MAX)"
POOL="${POOL:-5}"
GRAPH="$(leer WHATSAPP_GRAPH_VERSION)"
GRAPH="${GRAPH:-v21.0}"

{
  echo "# Configuración de producción del bot de Miska Muska."
  echo "# Generado por deploy/preparar-env.sh — no se commitea."
  echo
  echo "# --- Base de datos (Supabase) ---"
  echo "DATABASE_URL=$(leer DATABASE_URL)"
  echo "DATABASE_PASSWORD=$(leer DATABASE_PASSWORD)"
  echo "DATABASE_POOL_MAX=$POOL"
  echo
  echo "# --- Modelo ---"
  echo "OPENROUTER_API_KEY=$(leer OPENROUTER_API_KEY)"
  echo "OPENROUTER_MODEL=$(leer OPENROUTER_MODEL)"
  echo
  echo "# --- Servidor ---"
  echo "# Con systemd el bot abre este puerto de verdad: va en loopback, y quien"
  echo "# lo publica es el proxy. (Con Docker da igual: el compose pisa las dos"
  echo "# variables y el mapeo 127.0.0.1:3011 hace de contención.)"
  echo "PORT=3011"
  echo "HOST=127.0.0.1"
  echo "PUBLIC_URL=https://$DOMINIO"
  echo "DASHBOARD_ORIGIN=$PANEL"
  echo "ADMIN_TOKEN=$ADMIN_TOKEN_NUEVO"
  echo
  echo "# --- Telegram ---"
  echo "TELEGRAM_BOT_TOKEN=$(leer TELEGRAM_BOT_TOKEN)"
  echo "TELEGRAM_MODE=webhook"
  echo "TELEGRAM_WEBHOOK_SECRET=$WEBHOOK_SECRET_NUEVO"
  echo
  echo "# --- WhatsApp (etapa 2) ---"
  echo "WHATSAPP_ACCESS_TOKEN=$(leer WHATSAPP_ACCESS_TOKEN)"
  echo "WHATSAPP_PHONE_NUMBER_ID=$(leer WHATSAPP_PHONE_NUMBER_ID)"
  echo "WHATSAPP_VERIFY_TOKEN=$(leer WHATSAPP_VERIFY_TOKEN)"
  echo "WHATSAPP_APP_SECRET=$(leer WHATSAPP_APP_SECRET)"
  echo "WHATSAPP_GRAPH_VERSION=$GRAPH"
} > "$DESTINO"

chmod 600 "$DESTINO" 2>/dev/null

echo "Escrito $DESTINO"
echo
echo "  Variables incluidas (sin mostrar valores):"
grep -oE '^[A-Z_]+=' "$DESTINO" | tr -d '=' | while read -r k; do
  v=$(grep -E "^$k=" "$DESTINO" | head -1 | cut -d= -f2-)
  [ -n "$v" ] && echo "    $k  ✔" || echo "    $k  (vacío)"
done
echo
echo "  Descartado a propósito: SUPABASE_ACCESS_TOKEN, contraseñas del servidor,"
echo "  DATABASE_SSL (solo servían para configurar desde tu máquina)."
echo
echo "  TELEGRAM_MODE=webhook  ·  PUBLIC_URL=https://$DOMINIO"
echo "  ADMIN_TOKEN y TELEGRAM_WEBHOOK_SECRET generados nuevos."
echo
echo "  Copialo al servidor con:"
echo "    scp $DESTINO root@TU-IP:/opt/miska-muska/.env"
