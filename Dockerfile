FROM node:18-bullseye
RUN apt-get update && apt-get install -y python3 python3-pip ffmpeg && rm -rf /var/lib/apt/lists/*
RUN pip3 install --no-cache-dir huggingface_hub==0.16.4 pyannote.audio==3.1.1 torch torchaudio
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
EXPOSE 8080
CMD ["node", "index.js"]