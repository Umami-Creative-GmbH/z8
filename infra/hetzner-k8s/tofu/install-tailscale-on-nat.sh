#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ne 1 ]; then
  echo "Usage: $0 <tailscale-auth-key>"
  exit 1
fi

TS_AUTH_KEY="$1"

if ! command -v tailscale >/dev/null 2>&1; then
  curl -fsSL https://tailscale.com/install.sh | sh
fi

sudo tailscale up --auth-key="${TS_AUTH_KEY}" --ssh --accept-routes=false
tailscale status
