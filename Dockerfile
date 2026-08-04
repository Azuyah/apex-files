FROM node:22-bookworm-slim

WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates python3 python3-pip python3-venv \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci

COPY requirements.txt ./
RUN python3 -m venv /opt/apex-venv \
  && /opt/apex-venv/bin/python -m pip install --upgrade pip \
  && /opt/apex-venv/bin/python -m pip install -r requirements.txt

ENV PATH="/opt/apex-venv/bin:${PATH}"

COPY . .

# Vite reads public configuration while the image is built. Railway exposes
# service variables as Docker build arguments, so declare them explicitly.
ARG VITE_APP_MODE=""
ARG VITE_API_BASE_URL=""
ENV VITE_APP_MODE=${VITE_APP_MODE}
ENV VITE_API_BASE_URL=${VITE_API_BASE_URL}
RUN npm run build

ENV NODE_ENV=production

EXPOSE 8080

CMD ["node", "scripts/railway-start.cjs"]
