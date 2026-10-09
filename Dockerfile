# JF Hub: Server, Web-App (PWA) und Admin-Oberfläche in einem Image.
#   docker build -t jf-hub .
#   docker run -p 8080:8080 -v jf-hub-data:/data jf-hub

# ---- 1. Web-App (PWA) bauen ----
FROM node:22-alpine AS web
WORKDIR /build/app
COPY app/package.json app/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY app/index.html app/tsconfig.json app/vite.config.ts app/.env.web ./
COPY app/src ./src
COPY app/public ./public
RUN npx vite build --mode web --outDir /out/web --emptyOutDir

# ---- 2. Server bauen ----
FROM node:22-alpine AS server
WORKDIR /build/server
COPY server/package.json server/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY server/tsconfig.json ./
COPY server/src ./src
RUN npx tsc -p . && npm prune --omit=dev

# ---- 3. Laufzeit ----
FROM node:22-alpine
ARG VERSION=dev
ARG REVISION=unknown
LABEL org.opencontainers.image.title="JF Hub" \
      org.opencontainers.image.description="Selbst gehostete Verwaltung für die Jugendfeuerwehr: Protokolle, Dienste, Aufgaben, Wettkampf-Training" \
      org.opencontainers.image.licenses="AGPL-3.0-only" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.revision="${REVISION}"
RUN apk add --no-cache su-exec tini
WORKDIR /app
ENV NODE_ENV=production DATA_DIR=/data PORT=8080 \
    ADMIN_DIR=/app/public/admin WEB_DIR=/app/public/web \
    NODE_OPTIONS=--disable-warning=ExperimentalWarning
COPY --from=server /build/server/node_modules ./node_modules
COPY --from=server /build/server/dist ./dist
COPY server/package.json ./
COPY server/public/admin ./public/admin
COPY --from=web /out/web ./public/web
COPY docker/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh && mkdir -p /data && chown node:node /data
VOLUME /data
EXPOSE 8080
# Beim ersten Start nach dem Update auf 3.0.0 stellt der Server die Texte aller Protokolle um (mit Backup davor); das kann bei vielen Protokollen dauern.
HEALTHCHECK --interval=30s --timeout=5s --start-period=120s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8080/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
# Startet als root nur, um die Rechte des gemounteten Datenordners zu richten, und läuft dann als `node`.
ENTRYPOINT ["/sbin/tini", "--", "/usr/local/bin/entrypoint.sh"]
CMD ["node", "dist/index.js"]
