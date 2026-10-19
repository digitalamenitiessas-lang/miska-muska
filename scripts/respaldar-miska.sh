#!/usr/bin/env bash
#
# Respaldo de la base de Miska. Dos ritmos, y la diferencia es de 30 a 1.
#
# POR QUE EXISTE: hasta el 19 de octubre de 2026 la base vivia en Supabase, que
# hacia los respaldos sola. Al traerla a la VPS por latencia, esa red de
# seguridad se perdio y nadie la reemplazo. Una base sin respaldo no es una
# base mas rapida: es una base que un dia no esta.
#
# POR QUE DOS RITMOS. Medido: el respaldo entero pesa 444 MB y sin las fotos de
# los clientes pesa 14 MB. Todo el peso esta en `media`; los mensajes, los
# pedidos, los contactos y el catalogo —lo que de verdad no se puede perder—
# entran en catorce megas.
#
#   DIARIO   sin las fotos. 14 MB. Catorce dias para atras.
#   DOMINGO  entero, con las fotos. 444 MB. Cuatro semanas para atras.
#
# Asi lo critico tiene una copia de ayer, y las fotos una de hace a lo sumo
# siete dias. La alternativa era borrar fotos para que el respaldo pesara
# menos, y eso es tirar comprobantes de pago: cuando alguien reclama que pago y
# no figura, ese archivo es la respuesta.
#
# LO QUE ESTO NO RESUELVE, y conviene tenerlo escrito: el respaldo queda en el
# MISMO disco que la base. Sirve para un borrado por error, una tabla arruinada
# o una migracion que sale mal —que es lo que pasa casi siempre—, pero no para
# que se muera el disco. Para eso hace falta una copia afuera.
set -euo pipefail

# SE PARA EN UN DIRECTORIO QUE PUEDA LEER. Corriendo como postgres desde /root,
# find aborta con "Failed to restore initial working directory" y la limpieza
# de los respaldos viejos NO pasa — en silencio, porque el dump de arriba ya
# salio bien. El disco se llena semanas despues y el primer sintoma es que la
# base no puede escribir.
cd /

DESTINO=/var/backups/miska
DIAS_LIVIANO=14
DIAS_ENTERO=28

mkdir -p "$DESTINO"
chmod 700 "$DESTINO"

# Domingo es el 7. Se puede forzar con `respaldar-miska.sh entero`.
if [ "${1:-}" = "entero" ] || [ "$(date +%u)" = "7" ]; then
  MODO=entero
  EXCLUIR=()
  ESPERADAS=17
else
  MODO=liviano
  # Se excluyen los DATOS de media, no la tabla: el respaldo liviano restaura
  # una base completa y usable, solo que sin los archivos adjuntos.
  EXCLUIR=(--exclude-table-data=media)
  ESPERADAS=16
fi

ARCHIVO="$DESTINO/miska-$(date +%Y-%m-%d)-$MODO.dump"
pg_dump -d miska --no-owner --no-acl "${EXCLUIR[@]}" -Fc -f "$ARCHIVO.parcial"

# SE VERIFICA ANTES DE DARLO POR BUENO. Un archivo de cero bytes tambien
# "existe", y un respaldo que nadie abrio hasta el dia que lo necesita es un
# respaldo que no sabemos si sirve. `pg_restore -l` lee el indice: si el
# archivo quedo cortado o corrupto, falla aca y no dentro de seis meses.
if ! pg_restore -l "$ARCHIVO.parcial" > /dev/null 2>&1; then
  echo "RESPALDO INVALIDO: no se puede leer $ARCHIVO.parcial" >&2
  rm -f "$ARCHIVO.parcial"
  exit 1
fi

TABLAS=$(pg_restore -l "$ARCHIVO.parcial" | grep -c "TABLE DATA" || true)
if [ "$TABLAS" -lt "$ESPERADAS" ]; then
  echo "RESPALDO SOSPECHOSO ($MODO): $TABLAS tablas con datos, se esperaban $ESPERADAS" >&2
  rm -f "$ARCHIVO.parcial"
  exit 1
fi

# Recien ahora pasa a llamarse como corresponde: mientras se escribia tenia
# otro nombre, asi que un corte a mitad de camino no deja tirado un archivo que
# parezca un respaldo bueno.
mv "$ARCHIVO.parcial" "$ARCHIVO"

# Cada tipo se vence por su cuenta. Sin esto el disco se llena solo, y el
# primer sintoma es que la base deja de poder escribir.
find "$DESTINO" -name 'miska-*-liviano.dump' -mtime "+$DIAS_LIVIANO" -delete
find "$DESTINO" -name 'miska-*-entero.dump'  -mtime "+$DIAS_ENTERO"  -delete

echo "$(date '+%F %T') ok  $MODO  $(du -h "$ARCHIVO" | cut -f1)  $TABLAS tablas"
