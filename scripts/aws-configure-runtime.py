"""EC2 root-only installer: SSM SecureString -> root-owned systemd files.

Never prints SSM values or subprocess error output. No keys enter shell arguments.
"""
import json
import os
from pathlib import Path
import re
import subprocess
from urllib.parse import urlparse


def env_text(values):
    lines = []
    for key, value in values.items():
        if not re.fullmatch(r"[A-Z][A-Z0-9_]*", key) or not isinstance(value, str) or any(c in value for c in "\r\n\0"):
            raise ValueError("Invalid runtime setting")
        # systemd EnvironmentFile quoting (no shell expansion).
        escaped = value.replace("\\", "\\\\").replace('"', '\\"').replace("`", "\\`").replace("$", "\\$")
        lines.append(f'{key}="{escaped}"')
    return "\n".join(lines) + "\n"


def install():
    os.umask(0o077)
    result = subprocess.run([
        "aws", "ssm", "get-parameter", "--region", "ap-northeast-2",
        "--name", "/gammaru/web/runtime", "--with-decryption", "--output", "json",
    ], capture_output=True, check=False)
    if result.returncode:
        raise RuntimeError("Cannot load runtime settings")
    values = json.loads(json.loads(result.stdout)["Parameter"]["Value"])
    origin = urlparse(values.get("REPORTS_SITE_URL", ""))
    if origin.scheme != "https" or not re.fullmatch(r"[a-z0-9]+\.cloudfront\.net", origin.netloc) or origin.path:
        raise ValueError("Unexpected site origin")
    root = Path("/etc/gammaru")
    root.mkdir(mode=0o700, exist_ok=True)
    worker = {key: values[key] for key in ("REPORTS_SITE_URL", "DISCORD_BOT_TOKEN", "DISCORD_WORKER_TOKEN", "DISCORD_POLL_SECONDS")}
    for name, settings in [("web.env", values), ("worker.env", worker)]:
        temporary = root / (name + ".new")
        temporary.write_text(env_text(settings), encoding="utf-8")
        temporary.chmod(0o600)
        temporary.replace(root / name)
    # Host, scheme and cookies must reach Next unchanged. Never log OAuth query codes.
    nginx = '''user nginx;
worker_processes auto;
events { worker_connections 1024; }
http {
  include /etc/nginx/mime.types;
  default_type application/octet-stream;
  access_log off;
  error_log /var/log/nginx/error.log crit;
  server_tokens off;
  client_max_body_size 6m;
  server { listen 80 default_server; server_name _; return 444; }
  server {
    listen 80;
    server_name DOMAIN;
    location / {
      proxy_pass http://127.0.0.1:3000;
      proxy_http_version 1.1;
      proxy_set_header Host DOMAIN;
      proxy_set_header X-Forwarded-Host DOMAIN;
      proxy_set_header X-Forwarded-Proto https;
      proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
      proxy_set_header Connection "";
      proxy_buffering off;
      proxy_read_timeout 60s;
    }
  }
}
'''.replace("DOMAIN", origin.netloc)
    Path("/etc/nginx/nginx.conf").write_text(nginx, encoding="utf-8")


if __name__ == "__main__":
    try:
        install()
    except Exception:
        raise SystemExit("Runtime configuration failed; no secret details logged") from None
