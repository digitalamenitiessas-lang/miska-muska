#!/usr/bin/env bash
#
# Publica el panel en la VPS. Se corre EN LA VPS, dentro de /opt/miska-muska.
#
# Hasta el 19 de octubre de 2026 esto lo hacía Vercel solo con cada push. Ese
# día se cayó el plan y el panel pasó a servirse con Caddy. Ahora no lo hace
# nadie: después de tocar algo de apps/dashboard hay que correr esto, o el
# panel sigue mostrando la versión vieja sin avisar.
#
#   ssh root@2.25.185.242 'cd /opt/miska-muska && bash scripts/publicar-panel.sh'
#
# SE PUBLICAN DOS COPIAS, y no es un descuido:
#
#   1. miskamuska.2-25-185-242.sslip.io  → la raíz. Es el link que se le pasa
#      al local: dice Miska y no el nombre del dueño de la VPS. El bot está en
#      el mismo origen, así que el panel le habla con rutas relativas.
#
#   2. vps.marcorossi.com.ar/miska-panel/ → el respaldo. sslip.io es un
#      servicio de DNS de terceros; si se cae, este sigue en pie. Va bajo un
#      prefijo, así que necesita su propio build con --base y con la URL del
#      bot completa.
#
# Las dos salen del mismo código y se publican juntas a propósito: dos copias
# que se actualizan por separado terminan distintas, y la que se olvida es
# justo la que alguien abre el día que la otra no anda.
#
# El servidor del bot NO se toca acá: eso es `git pull && npm run build &&
# systemctl restart miska-bot`. Son dos despliegues distintos.
set -euo pipefail

RAIZ=/opt/miska-muska
BOT=https://vps.marcorossi.com.ar/miska-bot

cd "$RAIZ"

echo "→ actualizando el repo"
git pull --ff-only

publicar() {
  local nombre="$1" base="$2" api="$3" destino="$4" prueba="$5"
  echo
  echo "→ $nombre"
  # VITE_API_URL=/ significa "el bot está en el mismo origen": el panel usa
  # rutas relativas. Vacío a secas haría que el panel muestre el cartel de
  # "falta configurar". Ver `apiBaseFaltante` en apps/dashboard/src/api.ts.
  VITE_API_URL="$api" npm run build -w @miska/dashboard -- --base="$base" >/dev/null
  mkdir -p "$destino"
  # rsync --delete y no cp: cada build genera nombres nuevos para el JS y el
  # CSS, así que copiar encima deja los viejos ahí para siempre.
  rsync -a --delete "$RAIZ/apps/dashboard/dist/" "$destino/"
  chown -R caddy:caddy "$destino" 2>/dev/null || true

  local js codigo
  js=$(grep -o "${base}assets/index-[^\"]*\.js" "$destino/index.html" | head -1)
  codigo=$(curl -s -o /dev/null -w '%{http_code}' "${prueba}")
  if [ "$codigo" != "200" ]; then
    echo "   PROBLEMA: $prueba responde $codigo" >&2
    exit 1
  fi
  echo "   ok: publicado y respondiendo ($js)"
}

publicar "panel principal (sslip.io, en la raíz)" \
  "/" "/" /opt/miska-panel-raiz \
  "https://miskamuska.2-25-185-242.sslip.io/"

publicar "panel de respaldo (vps.marcorossi.com.ar)" \
  "/miska-panel/" "$BOT" /opt/miska-panel \
  "https://vps.marcorossi.com.ar/miska-panel/"

echo
echo "Listo."
echo "  Principal: https://miskamuska.2-25-185-242.sslip.io/"
echo "  Respaldo : https://vps.marcorossi.com.ar/miska-panel/"
