#!/usr/bin/env bash
#
# Publica el panel en la VPS. Se corre EN LA VPS, dentro de /opt/miska-muska.
#
# Hasta el 19 de octubre de 2026 esto lo hacía Vercel solo con cada push. Ese
# día se cayó el plan y el panel pasó a servirse con Caddy desde /opt/miska-panel.
# Ahora no lo hace nadie: después de tocar algo de apps/dashboard hay que correr
# esto, o el panel sigue mostrando la versión vieja.
#
#   ssh root@2.25.185.242 'cd /opt/miska-muska && bash scripts/publicar-panel.sh'
#
# El servidor del bot NO se toca acá: eso es `git pull && npm run build && systemctl
# restart miska-bot`. Son dos cosas distintas y conviene que sigan separadas.
set -euo pipefail

RAIZ=/opt/miska-muska
DESTINO=/opt/miska-panel

# El prefijo donde lo sirve Caddy. Tiene que terminar en barra: Vite lo pega
# adelante de cada asset tal cual.
BASE=/miska-panel/

# A dónde le habla el panel. Mismo dominio que el panel, así que no hay CORS;
# el prefijo /miska-bot es el que Caddy le saca antes de pasárselo al bot.
export VITE_API_URL=https://vps.marcorossi.com.ar/miska-bot

cd "$RAIZ"

echo "→ actualizando el repo"
git pull --ff-only

echo "→ compilando el panel (base $BASE)"
npm run build -w @miska/dashboard -- --base="$BASE"

# SE PUBLICA CON rsync --delete Y NO CON cp. Cada build genera un nombre de
# archivo nuevo para el JS y el CSS; copiando encima, los viejos se quedan para
# siempre y el directorio crece sin que nadie lo mire.
echo "→ publicando en $DESTINO"
mkdir -p "$DESTINO"
rsync -a --delete "$RAIZ/apps/dashboard/dist/" "$DESTINO/"
chown -R caddy:caddy "$DESTINO" 2>/dev/null || true

# Caddy sirve archivos del disco: no hay nada que recargar. Se verifica que el
# index que quedó publicado sea el que se acaba de compilar.
echo "→ verificando"
JS=$(grep -o '/miska-panel/assets/index-[^"]*\.js' "$DESTINO/index.html" | head -1)
CODIGO=$(curl -s -o /dev/null -w '%{http_code}' "https://vps.marcorossi.com.ar$JS")
if [ "$CODIGO" = "200" ]; then
  echo "   ok: $JS responde 200"
else
  echo "   PROBLEMA: $JS responde $CODIGO" >&2
  exit 1
fi

echo "Listo. El panel está en https://vps.marcorossi.com.ar/miska-panel/"
