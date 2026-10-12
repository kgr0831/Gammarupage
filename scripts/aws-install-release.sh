#!/bin/bash
# Invoked through SSM, on the dedicated instance only. Never enable shell tracing.
set -euo pipefail
exec 9>/var/lock/gammaru-deploy.lock
flock -n 9 || { echo 'Another release is being installed'; exit 1; }
release="${1:-}"
origin="${2:-}"
[[ "$release" =~ ^/opt/gammaru/releases/[a-f0-9]{40}$ ]] || exit 2
[[ "$origin" =~ ^https://[a-z0-9]+\.cloudfront\.net$ ]] || exit 2
test -f /opt/gammaru/bootstrap-ready
test -f "$release/package-lock.json"
chown -R gammaru:gammaru "$release"
# Build without any runtime credentials. No .env files exist in the archive.
runuser -u gammaru -- bash -c 'cd "$1"; npm-22 ci --no-audit --no-fund; NEXT_PUBLIC_SITE_URL="$2" REPORTS_DEPLOY_TARGET=aws NEXT_TELEMETRY_DISABLED=1 NODE_OPTIONS=--max-old-space-size=1536 npm-22 run build' -- "$release" "$origin"
cp -a "$release/public" "$release/.next/standalone/"
cp -a "$release/.next/static" "$release/.next/standalone/.next/"
# These service entrypoints are not traced by Next and share the release dependencies.
test -f "$release/.next/standalone/server.js"
python3 "$release/scripts/aws-configure-runtime.py"
cat > /etc/systemd/system/gammaru-web.service <<'UNIT'
[Unit]
Description=Gammaru web
After=network-online.target
Wants=network-online.target
[Service]
User=gammaru
Group=gammaru
WorkingDirectory=/opt/gammaru/current/.next/standalone
EnvironmentFile=/etc/gammaru/web.env
Environment=NODE_ENV=production PORT=3000 HOSTNAME=127.0.0.1 NEXT_TELEMETRY_DISABLED=1
ExecStart=/usr/bin/node-22 server.js
Restart=on-failure
RestartSec=5
TimeoutStopSec=45
UMask=0077
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ProtectHome=true
[Install]
WantedBy=multi-user.target
UNIT
cat > /etc/systemd/system/gammaru-notifier.service <<'UNIT'
[Unit]
Description=Gammaru Discord notification worker
After=network-online.target gammaru-web.service
Wants=network-online.target gammaru-web.service
[Service]
User=gammaru
Group=gammaru
WorkingDirectory=/opt/gammaru/current
EnvironmentFile=/etc/gammaru/worker.env
ExecStart=/usr/bin/node-22 discord-notifier/index.js
Restart=on-failure
RestartSec=30
TimeoutStopSec=45
UMask=0077
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ProtectHome=true
[Install]
WantedBy=multi-user.target
UNIT
cat > /etc/systemd/system/gammaru-retention.service <<'UNIT'
[Unit]
Description=Gammaru seven-day HTML retention
After=network-online.target
[Service]
Type=oneshot
User=gammaru
Group=gammaru
WorkingDirectory=/opt/gammaru/current
EnvironmentFile=/etc/gammaru/web.env
ExecStart=/usr/bin/node-22 scripts/run-report-retention.mjs
TimeoutStartSec=300
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ProtectHome=true
UNIT
cat > /etc/systemd/system/gammaru-retention.timer <<'UNIT'
[Unit]
Description=Prune old report HTML at 00:10 Korea time
[Timer]
OnCalendar=*-*-* 15:10:00 UTC
Persistent=true
RandomizedDelaySec=30
[Install]
WantedBy=timers.target
UNIT
# Keep the previous release until the new web process passes health checks.
previous=$(readlink -f /opt/gammaru/current || true)
ln -sfn "$release" /opt/gammaru/current-next
mv -Tf /opt/gammaru/current-next /opt/gammaru/current
systemctl daemon-reload
systemctl enable gammaru-web gammaru-notifier gammaru-retention.timer
systemctl restart gammaru-web
healthy=false
for attempt in $(seq 1 30); do
  if curl --fail --silent --output /dev/null http://127.0.0.1:3000/; then healthy=true; break; fi
  sleep 2
done
if [ "$healthy" != true ]; then
  if [[ "$previous" =~ ^/opt/gammaru/releases/[a-f0-9]{40}$ ]]; then
    ln -sfn "$previous" /opt/gammaru/current
    systemctl restart gammaru-web
  fi
  echo 'Release health check failed; notification worker was not restarted'
  exit 1
fi
nginx -t
systemctl reload nginx
systemctl restart gammaru-notifier
systemctl start gammaru-retention.timer
echo 'Release running; check authenticated routes and worker status before cutover'
