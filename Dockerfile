# ─────────────────────────────────────────────────────────────
#  trackers-stats — Dockerfile
#  Image : Node 20 slim + Chromium headless (Debian bookworm)
# ─────────────────────────────────────────────────────────────
FROM node:20-slim

# Chromium + polices pour le rendu headless
RUN apt-get update \
    && apt-get install -y \
       chromium \
       fonts-liberation \
       fonts-noto-cjk \
       --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Dépendances d'abord (mise en cache Docker)
COPY package*.json ./
RUN npm install --omit=dev

# Code source
COPY . .

# Le dossier data est un volume — juste s'assurer qu'il existe
RUN mkdir -p data

# Variables d'environnement
ENV CHROME_PATH=/usr/bin/chromium
ENV NODE_ENV=production
ENV PORT=3000
ENV HEADLESS=true

EXPOSE 3000

CMD ["node", "server.js"]
