#!/bin/sh
set -e

# Ensure downloads directory exists and is writable
mkdir -p /app/downloads
chmod 755 /app/downloads

# Start the application
exec node build/index.js
