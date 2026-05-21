#!/usr/bin/env bash
set -euo pipefail

PORT="${PORT:-8000}"
cd "$(dirname "$0")"

URL="http://localhost:${PORT}/"
echo "Serving $(pwd) at ${URL}"

(sleep 1 && open "${URL}") &
exec python3 -m http.server "${PORT}"
