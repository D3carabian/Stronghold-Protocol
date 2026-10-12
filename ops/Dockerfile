# Code-only image: matching, verified assets are mounted read-only by compose.
FROM node:22-alpine@sha256:0a7108bf6c7bf5de370ffb1a3ed6be93d405b43ff159f681a8d18c0e2bc2e402 AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund
COPY tools/vendor.mjs tools/vendor.mjs
RUN node tools/vendor.mjs

FROM node:22-alpine@sha256:0a7108bf6c7bf5de370ffb1a3ed6be93d405b43ff159f681a8d18c0e2bc2e402
ARG REVISION=unknown
LABEL org.opencontainers.image.source="https://github.com/D3carabian/Stronghold-Protocol" \
      org.opencontainers.image.revision=$REVISION
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000 SP_COMBAT=client SP_VERIFY=off
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/public/vendor ./public/vendor
COPY package.json ./
COPY server ./server
COPY shared ./shared
COPY data ./data
COPY public ./public
COPY packs ./packs
COPY docs/research/*.json ./docs/research/
COPY LICENSE NOTICE.md THIRD-PARTY-NOTICES.md ./
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=3s --start-period=30s --retries=4 \
  CMD wget -q -O /dev/null http://127.0.0.1:3000/healthz || exit 1
CMD ["node", "server/index.js"]
