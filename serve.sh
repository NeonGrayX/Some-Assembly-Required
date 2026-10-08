#!/usr/bin/env bash
# Serve the game for development, on this machine and on every interface, so a
# phone or another computer on the same network can open it too.
# Usage: ./serve.sh [port]   (default 4290)
# The default is this app's own port from the loopback port registry
# (docs.arrow-lab.de, deployment Part 0) - never a port another app has, so two
# can be served at once. Builds the client, then runs the game server over HTTP;
# the server prints the addresses to open.
set -euo pipefail

PORT="${1:-4290}"
cd "$(dirname "$0")"

[ -d node_modules ] || npm ci
npm run build
PORT="$PORT" exec npm start
