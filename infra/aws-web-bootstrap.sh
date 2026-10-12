#!/bin/bash
# Cloud-init contains no credentials or application configuration.
set -euo pipefail
dnf install -y nodejs22 nodejs22-npm nginx python3
command -v aws
command -v node-22
command -v npm-22
id gammaru >/dev/null 2>&1 || useradd --system --create-home --home-dir /opt/gammaru gammaru
install -d -m 0755 /opt/gammaru/releases
install -d -m 0700 /etc/gammaru
# Bounded swap lets ARM builds complete on a 2 GB instance. Root EBS is encrypted.
if [ ! -f /var/gammaru.swap ]; then
  fallocate -l 2G /var/gammaru.swap
  chmod 600 /var/gammaru.swap
  mkswap /var/gammaru.swap
  swapon /var/gammaru.swap
  printf '/var/gammaru.swap none swap sw 0 0\n' >> /etc/fstab
fi
# Serve only a non-sensitive bootstrap status until configuration is complete.
cat > /etc/nginx/nginx.conf <<'NGINX'
user nginx;
worker_processes auto;
events { worker_connections 1024; }
http {
  access_log off;
  server { listen 80 default_server; location / { return 503; } }
}
NGINX
nginx -t
systemctl enable --now nginx amazon-ssm-agent
touch /opt/gammaru/bootstrap-ready
