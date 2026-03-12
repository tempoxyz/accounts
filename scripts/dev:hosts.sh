#!/usr/bin/env bash
set -euo pipefail

AUTH_HOST="auth.local"
PLAYGROUND_A_HOST="playground.a"
PLAYGROUND_B_HOST="playground.b"

AUTH_PORT="${AUTH_PORT:-5174}"
PLAYGROUND_PORT_A="${PLAYGROUND_PORT_A:-5173}"
PLAYGROUND_PORT_B="${PLAYGROUND_PORT_B:-5175}"

# Check /etc/hosts entries.
MISSING=()
for host in "$AUTH_HOST" "$PLAYGROUND_A_HOST" "$PLAYGROUND_B_HOST"; do
  if ! grep -qE "127\.0\.0\.1\s+$host" /etc/hosts; then
    MISSING+=("$host")
  fi
done

if [[ ${#MISSING[@]} -gt 0 ]]; then
  echo "Missing /etc/hosts entries. Run:"
  echo ""
  for host in "${MISSING[@]}"; do
    echo "  echo '127.0.0.1 $host' | sudo tee -a /etc/hosts"
  done
  echo ""
  exit 1
fi

cleanup() {
  [[ -n "${AUTH_PID:-}" ]] && kill "$AUTH_PID" 2>/dev/null || true
  [[ -n "${PLAYGROUND_A_PID:-}" ]] && kill "$PLAYGROUND_A_PID" 2>/dev/null || true
  [[ -n "${PLAYGROUND_B_PID:-}" ]] && kill "$PLAYGROUND_B_PID" 2>/dev/null || true
}
trap cleanup EXIT

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo ""
echo "Auth:         https://$AUTH_HOST:$AUTH_PORT"
echo "Playground A: https://$PLAYGROUND_A_HOST:$PLAYGROUND_PORT_A"
echo "Playground B: https://$PLAYGROUND_B_HOST:$PLAYGROUND_PORT_B"
echo ""

cd "$ROOT/auth"
PORT="$AUTH_PORT" VITE_HOST="$AUTH_HOST" pnpm dev &
AUTH_PID=$!

cd "$ROOT/playground"
PORT="$PLAYGROUND_PORT_A" VITE_HOST="$PLAYGROUND_A_HOST" VITE_AUTH_HOST="https://$AUTH_HOST:$AUTH_PORT" pnpm dev &
PLAYGROUND_A_PID=$!

cd "$ROOT/playground"
PORT="$PLAYGROUND_PORT_B" VITE_HOST="$PLAYGROUND_B_HOST" VITE_AUTH_HOST="https://$AUTH_HOST:$AUTH_PORT" pnpm dev &
PLAYGROUND_B_PID=$!

wait $AUTH_PID $PLAYGROUND_A_PID $PLAYGROUND_B_PID
