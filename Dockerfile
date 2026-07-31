# Imagen del bot (servidor de webhooks + API + SSE).
# El panel NO va acá: se despliega estático en Vercel.
#
# Sirve igual para Railway, Fly.io, Render o un VPS con Docker.
# Requisito único de infraestructura: UNA sola instancia. El debounce que junta
# los mensajes seguidos del cliente y el mutex por conversación viven en memoria;
# con dos réplicas el bot contestaría dos veces.

# ---------------------------------------------------------------- build ------
FROM node:22-alpine AS build

WORKDIR /app

# Se copian solo los manifiestos primero para que la capa de dependencias se
# cachee mientras no cambien.
COPY package.json package-lock.json ./
COPY apps/server/package.json ./apps/server/
COPY apps/dashboard/package.json ./apps/dashboard/
RUN npm ci

COPY apps/server ./apps/server
RUN npm run build -w @miska/server

# -------------------------------------------------------------- runtime ------
FROM node:22-alpine AS runtime

ENV NODE_ENV=production \
    PORT=3001 \
    HOST=0.0.0.0 \
    TZ=America/Argentina/Tucuman

WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/server/package.json ./apps/server/
COPY apps/dashboard/package.json ./apps/dashboard/

# Solo las dependencias de producción del servidor: `pg` y `fastify`.
RUN npm ci --omit=dev --workspace @miska/server --include-workspace-root \
    && npm cache clean --force

COPY --from=build /app/apps/server/dist ./apps/server/dist

USER node
EXPOSE 3001

# /health responde 200 aunque un canal esté caído, a propósito: un token vencido
# de Telegram no debería reiniciar el proceso en bucle.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3001)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# El proceso registra SIGTERM y SIGINT: cierra los canales, el servidor HTTP y el
# pool de Postgres antes de salir. Dale al menos 15 s de gracia al detenerlo.
CMD ["node", "apps/server/dist/main.js"]
