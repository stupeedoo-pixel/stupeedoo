# ZiroClips web (Next.js standalone). Build from ziroclips/:  docker build -f web/Dockerfile .
FROM node:22-slim AS deps
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
WORKDIR /app/web
COPY web/package.json web/package-lock.json ./
COPY web/prisma ./prisma
RUN npm ci

FROM deps AS build
WORKDIR /app
COPY shared ./shared
COPY web ./web
WORKDIR /app/web
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:22-slim AS run
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
WORKDIR /app
COPY --from=build /app/web/.next/standalone ./
COPY --from=build /app/web/.next/static ./web/.next/static
COPY --from=build /app/web/public ./web/public
# Prisma CLI + schema so the container can apply migrations on boot.
COPY --from=build /app/web/prisma ./web/prisma
COPY --from=build /app/web/node_modules/prisma ./web/node_modules/prisma
COPY --from=build /app/web/node_modules/@prisma ./web/node_modules/@prisma
WORKDIR /app/web
EXPOSE 3000
CMD ["sh", "-c", "node node_modules/prisma/build/index.js migrate deploy && node server.js"]
