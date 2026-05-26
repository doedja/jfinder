#!/bin/sh
set -e

# Ensure DOWNLOAD_DIR exists and is owned by the app user.
# Needed because Coolify-managed Docker volumes are root-owned by default
# while the runtime drops to a non-root uid.
DIR="${DOWNLOAD_DIR:-/app/downloads}"
mkdir -p "$DIR"
chown -R app:app "$DIR" 2>/dev/null || true

exec su-exec app:app /app/jfinder "$@"
