#!/usr/bin/env bash
# Diagnóstico del VPS antes de desplegar. SOLO LEE: no instala, no modifica,
# no reinicia nada. Corrélo primero y pasame la salida.
#
#   bash deploy/diagnostico.sh
#
# Sirve para saber con qué convive el bot y elegir puerto y proxy sin romper
# nada de lo que ya está funcionando.

set -uo pipefail

titulo() { printf '\n\033[1m== %s ==\033[0m\n' "$1"; }
hay()    { command -v "$1" >/dev/null 2>&1; }

titulo "Sistema"
. /etc/os-release 2>/dev/null && echo "  $PRETTY_NAME"
echo "  kernel: $(uname -r)  ·  arquitectura: $(uname -m)"
echo "  memoria: $(free -h 2>/dev/null | awk '/^Mem:/{print $3" usados de "$2}')"
echo "  disco /: $(df -h / 2>/dev/null | awk 'NR==2{print $3" usados de "$2" ("$5")"}')"
echo "  uptime: $(uptime -p 2>/dev/null)"

titulo "Docker"
if hay docker; then
  echo "  $(docker --version)"
  hay docker-compose && echo "  $(docker-compose --version)"
  docker compose version >/dev/null 2>&1 && echo "  $(docker compose version)"
  echo "  contenedores corriendo:"
  docker ps --format '    {{.Names}}  ·  {{.Image}}  ·  {{.Ports}}' 2>/dev/null || echo "    (sin permisos, probá con sudo)"
  echo "  redes:"
  docker network ls --format '    {{.Name}} ({{.Driver}})' 2>/dev/null
else
  echo "  no está instalado"
fi

titulo "Puertos ocupados"
if hay ss; then
  ss -tlnp 2>/dev/null | awk 'NR>1{print "    "$4"  "$6}' | sort -u
elif hay netstat; then
  netstat -tlnp 2>/dev/null | awk 'NR>2{print "    "$4"  "$7}' | sort -u
else
  echo "  no encontré ss ni netstat"
fi

titulo "¿Están libres los puertos que quiero usar?"
for p in 3011 3012 3013; do
  if (hay ss && ss -tln 2>/dev/null | grep -q ":$p ") || (hay netstat && netstat -tln 2>/dev/null | grep -q ":$p "); then
    echo "    $p  OCUPADO"
  else
    echo "    $p  libre"
  fi
done

titulo "Proxy inverso"
for s in nginx caddy apache2 httpd traefik; do
  if hay $s || systemctl is-active --quiet $s 2>/dev/null; then
    estado=$(systemctl is-active $s 2>/dev/null || echo "?")
    echo "  $s presente (servicio: $estado)"
  fi
done
[ -d /etc/nginx/sites-enabled ] && { echo "  vhosts de nginx:"; ls /etc/nginx/sites-enabled/ 2>/dev/null | sed 's/^/    /'; }
[ -d /etc/nginx/conf.d ]       && { echo "  conf.d de nginx:";  ls /etc/nginx/conf.d/ 2>/dev/null | sed 's/^/    /'; }
[ -f /etc/caddy/Caddyfile ]    && { echo "  dominios en el Caddyfile:"; grep -oE '^[a-z0-9.-]+\.[a-z]{2,}' /etc/caddy/Caddyfile 2>/dev/null | sed 's/^/    /'; }
docker ps --format '{{.Image}}' 2>/dev/null | grep -qiE 'traefik|nginx-proxy|caddy' && echo "  hay un proxy corriendo en Docker"

titulo "Certificados TLS existentes"
[ -d /etc/letsencrypt/live ] && ls /etc/letsencrypt/live/ 2>/dev/null | sed 's/^/    /' || echo "    (ninguno con certbot)"

titulo "Node instalado en el host"
hay node && echo "  $(node --version)" || echo "  no (no hace falta: el bot va en Docker)"

titulo "Salida a internet"
for destino in openrouter.ai api.telegram.org aws-1-us-west-2.pooler.supabase.com; do
  if timeout 5 bash -c "</dev/tcp/$destino/443" 2>/dev/null; then
    echo "    $destino:443  ✔"
  else
    echo "    $destino:443  ✗ (revisar firewall)"
  fi
done

titulo "Firewall"
hay ufw && ufw status 2>/dev/null | head -8 | sed 's/^/    /'
hay firewall-cmd && firewall-cmd --list-all 2>/dev/null | head -8 | sed 's/^/    /'

printf '\n\033[1mListo. Pasame esta salida completa.\033[0m\n'
