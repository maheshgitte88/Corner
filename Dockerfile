FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
COPY client/package.json ./client/package.json
COPY server/package.json ./server/package.json
RUN npm ci
COPY client ./client
COPY shared ./shared
RUN npm run build

FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY package*.json ./
COPY client/package.json ./client/package.json
COPY server/package.json ./server/package.json
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/client/dist ./client/dist
COPY server/src ./server/src
COPY shared ./shared
COPY scripts/migrate-legacy.js ./scripts/migrate-legacy.js
USER node
EXPOSE 4100
CMD ["node", "server/src/server.js"]
