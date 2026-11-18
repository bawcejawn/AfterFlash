#!/usr/bin/env bash
# Starts a fresh local AfterFlash Cloud and runs the browser test against it.
set -euo pipefail
cd "$(dirname "$0")/../.."
node --no-warnings cloud/test/server.mjs 8788 > /tmp/ps-cloud-server.log 2>&1 &
SERVER=$!
trap 'kill $SERVER 2>/dev/null || true' EXIT
for i in $(seq 1 40); do curl -sf http://localhost:8788/api >/dev/null && break; sleep 0.25; done
python3 cloud/test/e2e.py
