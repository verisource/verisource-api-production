FROM node:20-slim
RUN apt-get update && apt-get install -y libvips-dev && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
CMD ["node", "civitai-scheduler.js"]
