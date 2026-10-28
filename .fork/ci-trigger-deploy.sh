#!/usr/bin/env bash
# Runs in CI. SSHes into the VPS using a restricted key (forced command) and
# invokes /opt/open-seo/.fork/oc-deploy.sh on the host, which calls Coolify's
# localhost API. No Coolify API is exposed publicly.
#
# Required env (from GitHub Secrets):
#   VPS_SSH_KEY  - private key (written to a temp file here)
#   VPS_HOST     - VPS hostname/IP
#   VPS_USER     - SSH user (default: ubuntu)
set -euo pipefail

: "${VPS_HOST:?VPS_HOST is required}"
VPS_USER="${VPS_USER:-ubuntu}"

key_file="$(mktemp)"
trap 'rm -f "$key_file"' EXIT
printf '%s\n' "$VPS_SSH_KEY" > "$key_file"
chmod 600 "$key_file"

# Forced command on the host ignores the remote command, but we pass a marker
# for logging/audit purposes.
ssh -i "$key_file" \
  -o StrictHostKeyChecking=accept-new \
  -o UserKnownHostsFile=/dev/null \
  -o ServerAliveInterval=30 \
  -o ServerAliveCountMax=10 \
  "${VPS_USER}@${VPS_HOST}" "deploy"
