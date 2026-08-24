# ============================================================================
# Entorno de desarrollo reproducible.
#
# NO es la imagen de producción: en producción el código corre en Cloudflare
# Workers, no en un contenedor. Este Dockerfile existe para que cualquiera
# levante el proyecto (Worker + D1 + R2 + KV + Durable Objects simulados por
# Miniflare) con un único comando y la misma versión de Node.
# ============================================================================
FROM node:20-bookworm-slim AS dev

ENV NODE_ENV=development \
    NPM_CONFIG_UPDATE_NOTIFIER=false \
    NPM_CONFIG_FUND=false

# `workerd` (el runtime real de Workers) necesita libc y libstdc++ completas.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Capa de dependencias cacheable.
COPY package.json package-lock.json* ./
RUN npm ci --no-audit --no-fund || npm install --no-audit --no-fund

COPY . .

RUN npm run build:client

EXPOSE 8787

HEALTHCHECK --interval=15s --timeout=5s --start-period=40s --retries=5 \
  CMD curl -fsS http://127.0.0.1:8787/health || exit 1

# --ip 0.0.0.0 para que el puerto sea accesible desde fuera del contenedor.
CMD ["npx", "wrangler", "dev", "--ip", "0.0.0.0", "--port", "8787", "--local"]

# ---------------------------------------------------------------------------
# Etapa de CI: mismas dependencias, pensada para lint/typecheck/tests.
# ---------------------------------------------------------------------------
FROM dev AS ci
CMD ["sh", "-lc", "npm run lint && npm run typecheck && npm run test"]
