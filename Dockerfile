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
RUN npm run build

ENV NODE_ENV=production

EXPOSE 8080

CMD ["node", "scripts/railway-start.cjs"]
