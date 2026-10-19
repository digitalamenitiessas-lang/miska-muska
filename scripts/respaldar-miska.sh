#!/usr/bin/env bash
#
# Respaldo diario de la base de Miska.
#
# POR QUE EXISTE: hasta el 19 de octubre de 2026 la base vivia en Supabase, que
# hacia los respaldos sola. Al traerla a la VPS por latencia, esa red de
# seguridad se perdio y nadie la reemplazo. Una base sin respaldo no es una base
# mas rapida: es una base que un dia no esta. Esto es la contrapartida de la
# mudanza y no un extra.
#
# QUE GUARDA: un dump comprimido por dia, catorce dias para atras. Son unos
# 450 MB cada uno, casi todo `media` (las fotos que mandan los clientes), asi
# que catorce entran de sobra en el disco que hay.
#
# LO QUE ESTO NO RESUELVE, y conviene tenerlo escrito: el respaldo queda en el
# MISMO disco que la base. Sirve para un borrado por error, una tabla
# arruinada o una migracion que sale mal —que es lo que pasa casi siempre—,
# pero no para que se muera el disco. Para eso hace falta una copia afuera.
set -euo pipefail

DESTINO=/var/backups/miska
DIAS=14
HOY=$(date +%Y-%m-%d)
ARCHIVO="$DESTINO/miska-$HOY.dump"

mkdir -p "$DESTINO"
chmod 700 "$DESTINO"

pg_dump -d miska --no-owner --no-acl -Fc -f "$ARCHIVO.parcial"

# SE VERIFICA ANTES DE DARLO POR BUENO. Un archivo de cero bytes tambien
# "existe", y un respaldo que nadie abrio hasta el dia que lo necesita es un
# respaldo que no sabemos si sirve. `pg_restore -l` lee el indice del dump: si
# el archivo esta cortado o corrupto, falla acá y no dentro de seis meses.
if ! pg_restore -l "$ARCHIVO.parcial" > /dev/null 2>&1; then
  echo "RESPALDO INVALIDO: $ARCHIVO.parcial no se puede leer" >&2
  rm -f "$ARCHIVO.parcial"
  exit 1
fi

TABLAS=$(pg_restore -l "$ARCHIVO.parcial" | grep -c "TABLE DATA" || true)
if [ "$TABLAS" -lt 10 ]; then
  echo "RESPALDO SOSPECHOSO: solo $TABLAS tablas con datos, se esperaban 17" >&2
  rm -f "$ARCHIVO.parcial"
  exit 1
fi

# Recien ahora pasa a llamarse como corresponde: mientras se escribia tenia
# otro nombre, asi que un corte a mitad de camino no deja un archivo que
# parezca un respaldo bueno.
mv "$ARCHIVO.parcial" "$ARCHIVO"

# Los viejos se van. Sin esto el disco se llena solo y el primer sintoma es que
# la base deja de poder escribir.
find "$DESTINO" -name 'miska-*.dump' -mtime "+$DIAS" -delete

echo "$(date '+%F %T') ok  $ARCHIVO  $(du -h "$ARCHIVO" | cut -f1)  $TABLAS tablas"
