FROM node:22-slim

# Prisma's engines need OpenSSL on Debian slim
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY prisma ./prisma
RUN npx prisma generate

COPY src ./src
COPY scripts ./scripts
COPY tests ./tests

ENV NODE_ENV=production \
    PORT=4000 \
    DATA_DIR=/data

EXPOSE 4000

# Applies migrations, seeds the database if it is empty, then starts the server
CMD ["node", "scripts/start.js"]
