FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive
ENV DISPLAY=:99
ENV TBP_SERVER_PORT=7860
ENV XRAY_BIN=/usr/local/bin/xray
ENV NODE_ENV=production

# ---- System packages ----
RUN apt-get update && apt-get install -y \
    firefox xvfb xdotool xclip openbox \
    python3 python3-pip \
    wget curl ca-certificates gnupg unzip procps \
    && rm -rf /var/lib/apt/lists/*

# ---- Node.js 20 ----
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

# ---- Xray ----
RUN ARCH=$(uname -m) && \
    if [ "$ARCH" = "x86_64" ]; then XA="64"; \
    elif [ "$ARCH" = "aarch64" ]; then XA="arm64-v8a"; \
    else XA="64"; fi && \
    wget -q "https://github.com/XTLS/Xray-core/releases/latest/download/Xray-linux-${XA}.zip" -O /tmp/xray.zip && \
    unzip -q /tmp/xray.zip -d /tmp/xray && \
    mv /tmp/xray/xray /usr/local/bin/xray && \
    chmod +x /usr/local/bin/xray && \
    rm -rf /tmp/xray /tmp/xray.zip

# ---- tbp ----
RUN pip3 install --break-system-packages termux-browser-pilot

# ---- App ----
WORKDIR /app
COPY package*.json ./
RUN npm install --production
COPY . .
RUN chmod +x start.sh

CMD ["./start.sh"]
