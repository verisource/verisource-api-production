FROM node:20-slim

WORKDIR /app

RUN apt-get update && apt-get install -y \
    libvips-dev \
    && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm ci --only=production

COPY . .

ENV NODE_ENV=production
ENV PORT=8080
ENV CRAWL_INTERVAL=60
ENV MAX_IMAGES_PER_SOURCE=50
ENV CRAWL_TIERS=wire_services,international,us_major,other_major

EXPOSE 8080

CMD ["npm", "start"]
