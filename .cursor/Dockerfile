# Cloud Agent base image for dsh-coding-subscription-oauth.
# Canonical verification is Docker-in-Docker (`docker build --target check|verify`).
# Nested Docker cannot use overlay2 here; vfs is required so `promote-release.mjs`
# directory renames succeed (fuse-overlayfs hits ENOTEMPTY).
FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive \
    NVM_DIR=/home/ubuntu/.nvm \
    PATH=/home/ubuntu/.nvm/versions/node/v22.19.0/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates \
        curl \
        git \
        gnupg \
        iptables \
        sudo \
        fuse-overlayfs \
    && install -m 0755 -d /etc/apt/keyrings \
    && curl --retry 3 --retry-delay 5 -fsSL https://download.docker.com/linux/ubuntu/gpg \
        | gpg --dearmor -o /etc/apt/keyrings/docker.gpg \
    && chmod a+r /etc/apt/keyrings/docker.gpg \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu noble stable" \
        > /etc/apt/sources.list.d/docker.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends \
        docker-ce=5:28.5.2-1~ubuntu.24.04~noble \
        docker-ce-cli=5:28.5.2-1~ubuntu.24.04~noble \
        containerd.io \
        docker-buildx-plugin \
        docker-compose-plugin \
    && update-alternatives --set iptables /usr/sbin/iptables-legacy \
    && update-alternatives --set ip6tables /usr/sbin/ip6tables-legacy \
    && mkdir -p /etc/docker \
    && printf '%s\n' '{' '  "storage-driver": "vfs"' '}' > /etc/docker/daemon.json \
    && useradd -m -s /bin/bash -u 1000 ubuntu \
    && echo 'ubuntu ALL=(ALL) NOPASSWD:ALL' > /etc/sudoers.d/ubuntu \
    && chmod 0440 /etc/sudoers.d/ubuntu \
    && usermod -aG docker ubuntu \
    && rm -rf /var/lib/apt/lists/*

USER ubuntu
WORKDIR /home/ubuntu

RUN curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash \
    && . "$NVM_DIR/nvm.sh" \
    && nvm install 22.19.0 \
    && nvm alias default 22.19.0 \
    && corepack enable \
    && corepack prepare pnpm@11.21.0 --activate \
    && node --version \
    && pnpm --version

USER ubuntu
