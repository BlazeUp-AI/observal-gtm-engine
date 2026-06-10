#!/usr/bin/env bash
# One-shot bootstrap for the gtm-engine VM (Debian 12, e2-micro).
# Run as root:  sudo bash setup-vm.sh
# Afterwards copy .env to /opt/gtm-engine/.env and: systemctl restart gtm-scheduler gtm-server
set -euo pipefail

REPO=https://github.com/aryaniyaps/observal-gtm-engine.git
DIR=/opt/gtm-engine

echo "== swap (e2-micro has 1GB RAM) =="
if [ ! -f /swapfile ]; then
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

echo "== packages =="
apt-get update
apt-get install -y curl git python3-venv ca-certificates

echo "== node 22 =="
if ! command -v node >/dev/null; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi

echo "== docker (for Reacher) =="
if ! command -v docker >/dev/null; then
  curl -fsSL https://get.docker.com | sh
fi

echo "== app user + clone =="
id -u gtm &>/dev/null || useradd -r -m -s /usr/sbin/nologin gtm
if [ ! -d "$DIR" ]; then
  git clone "$REPO" "$DIR"
fi
cd "$DIR"
npm install
sudo -u gtm python3 -m venv services/jobspy/.venv || python3 -m venv services/jobspy/.venv
services/jobspy/.venv/bin/pip install --quiet python-jobspy

echo "== reacher =="
docker compose -f services/reacher/docker-compose.yml up -d

echo "== database =="
[ -f .env ] || cp .env.example .env  # placeholder; replace with the real .env
npm run db:migrate
chown -R gtm:gtm "$DIR"

echo "== systemd =="
cp deploy/gtm-scheduler.service deploy/gtm-server.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now gtm-scheduler gtm-server

echo "== done =="
systemctl --no-pager status gtm-scheduler gtm-server | head -20
echo
echo "NEXT: copy the real .env to $DIR/.env, then: systemctl restart gtm-scheduler gtm-server"
