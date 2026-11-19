ARG NODE_VERSION=24
FROM node:${NODE_VERSION}-bookworm-slim AS builder
WORKDIR /app
COPY package*.json tsconfig.json ./
RUN npm ci --ignore-scripts
COPY src ./src
COPY scripts ./scripts
COPY myluz.config.example.json ./
RUN npm run build:prod

FROM node:${NODE_VERSION}-bookworm-slim AS production
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgtk-3-0 libayatana-appindicator3-1 libxdo3 libnotify-bin \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/lib ./lib
COPY --from=builder /app/myluz.config.example.json ./
COPY --from=builder /app/node_modules ./node_modules
RUN npm prune --omit=dev --ignore-scripts --no-audit --no-fund --fetch-retries=0 --fetch-timeout=20000 \
    && npm run os:install
ENV PLAYWRIGHT_BROWSERS_PATH=/opt/playwright
RUN npx playwright install --with-deps chromium
USER node
ENTRYPOINT ["node", "lib/cjs/bin/cli.cjs"]
CMD ["--help"]
LABEL name="Scheduler" description="MyLuz appointment and exam scheduler CLI"
