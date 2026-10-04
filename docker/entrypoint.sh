#!/bin/sh
set -e
# Gemountete Datenordner gehören auf dem Host oft root – für den unprivilegierten Serverprozess korrigieren.
if [ "$(id -u)" = "0" ]; then
  chown -R node:node "${DATA_DIR:-/data}"
  exec su-exec node "$@"
fi
exec "$@"
