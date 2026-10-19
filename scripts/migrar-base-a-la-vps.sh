#!/usr/bin/env bash
# Trae la base de Supabase a la VPS. Se corre EN LA VPS.
#
# A Supabase solo se le LEE. No se borra ni se modifica nada allá, asi que si
# algo sale mal se vuelve restaurando el .env y reiniciando: los datos viejos
# siguen intactos del otro lado.
set -euo pipefail
cd /opt/miska-muska

VIEJA_URL=$(grep '^DATABASE_URL=' .env | cut -d= -f2- | tr -d '"')
export PGPASSWORD=$(grep '^DATABASE_PASSWORD=' .env | cut -d= -f2- | tr -d '"')
PGDUMP=/usr/lib/postgresql/17/bin/pg_dump
DIR=/var/lib/postgresql/migracion
NUEVA_PASS=$(cat /root/.miska-db-pass)

echo "→ respaldando el .env"
cp .env .env.antes-de-migrar-la-base

echo "→ parando el bot (acá empieza la ventana)"
INICIO=$(date +%s)
systemctl stop miska-bot

echo "→ dump fresco de Supabase"
sudo -u postgres rm -f "$DIR/miska.dump"
$PGDUMP "$VIEJA_URL" --schema=public --no-owner --no-acl --no-comments -Fc -f /tmp/miska-fresco.dump
mv /tmp/miska-fresco.dump "$DIR/miska.dump"
chown postgres:postgres "$DIR/miska.dump"

echo "→ recreando la base local"
sudo -u postgres psql -qc "DROP DATABASE IF EXISTS miska WITH (FORCE)"
sudo -u postgres psql -qc "CREATE DATABASE miska OWNER miska_app ENCODING UTF8"

echo "→ restaurando"
sudo -u postgres pg_restore -d miska --no-owner --no-acl "$DIR/miska.dump" 2>&1 | grep -v "CREATE SCHEMA public" | tail -3 || true
sudo -u postgres psql -d miska -qc "ALTER SCHEMA public OWNER TO miska_app;
  GRANT ALL ON SCHEMA public TO miska_app;
  GRANT ALL ON ALL TABLES IN SCHEMA public TO miska_app;
  GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO miska_app"

echo "→ apuntando el bot a la base local"
# La URL vieja queda comentada arriba: es el camino de vuelta si hace falta.
python3 - "$NUEVA_PASS" <<'PY'
import sys, re
clave = sys.argv[1]
p = "/opt/miska-muska/.env"
s = open(p).read()
vieja = re.search(r"^DATABASE_URL=.*$", s, re.M).group(0)
s = re.sub(r"^DATABASE_URL=.*$",
           "# Antes de migrar a la VPS (19/10/2026), por si hay que volver:\n# " + vieja
           + "\nDATABASE_URL=postgresql://miska_app@127.0.0.1:5432/miska", s, count=1, flags=re.M)
s = re.sub(r"^DATABASE_PASSWORD=.*$", "DATABASE_PASSWORD=" + clave, s, count=1, flags=re.M)
open(p, "w").write(s)
print("   .env actualizado")
PY

echo "→ arrancando el bot"
systemctl start miska-bot
sleep 8
FIN=$(date +%s)
systemctl is-active miska-bot
echo "→ ventana sin servicio: $((FIN-INICIO)) segundos"
