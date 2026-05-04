#!/usr/bin/env bash
# Check that marmot.sh is serving traffic (HTTP 200 on root).
# This is an SSR site, not a JSON API — no /health route.

set -uo pipefail

URL="https://marmot.sh/"

status=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 "$URL" 2>/dev/null)

if [[ "$status" == "200" ]]; then
  echo "✅ web: ${URL} (HTTP ${status})"
  exit 0
else
  echo "❌ web: ${URL} (HTTP ${status:-unreachable})"
  exit 1
fi
