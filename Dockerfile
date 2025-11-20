FROM node:20-alpine AS builder
WORKDIR /app/client

COPY client/package.json client/package-lock.json ./

RUN npm ci

COPY client/ ./
RUN mkdir -p public && if [ -f index.html ]; then mv index.html public/index.html; fi
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

COPY server.js ./

COPY --from=builder /app/client/build ./client/build

EXPOSE 3000

USER node

CMD ["node", "server.js"]