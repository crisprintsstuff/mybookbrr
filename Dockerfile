FROM node:22-bookworm-slim AS build

WORKDIR /app
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json* ./
RUN npm install

COPY tsconfig.json ./
COPY src ./src
COPY client ./client
RUN npm run build

FROM node:22-bookworm-slim

WORKDIR /app
RUN apt-get update && apt-get install -y python3 make g++ curl && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json* ./
RUN npm install --omit=dev

COPY --from=build /app/dist ./dist
COPY --from=build /app/client/dist ./client/dist

ENV PORT=7480
ENV HOST=0.0.0.0
ENV DATA_DIR=/app/data
ENV DOWNLOADS_DIR=/app/downloads
ENV AUTH_PASSWORD=changeme

EXPOSE 7480
VOLUME ["/app/data", "/app/downloads"]

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD curl -f http://localhost:7480/api/auth/me || exit 1

CMD ["node", "dist/server.js"]
