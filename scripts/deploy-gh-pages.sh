#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
PUBLIC_DIR="$REPO_ROOT/public"

REPO_GIT_URL="${NEXFORCE_REPO_URL:-https://github.com/DevEchoX2/NexForce.git}"
PAGES_BRANCH="${NEXFORCE_PAGES_BRANCH:-gh-pages}"
VERIFY_BASE_URL="${NEXFORCE_VERIFY_BASE_URL:-https://devechox2.github.io/NexForce}"
VERIFY_PATH="${NEXFORCE_VERIFY_PATH:-/play.html?game=Fortnite}"
CUSTOM_VERIFY_BASE_URL="${NEXFORCE_CUSTOM_VERIFY_BASE_URL:-http://wafflev1.me/NexForce}"

if [[ ! -d "$PUBLIC_DIR" ]]; then
  echo "error: public directory not found at $PUBLIC_DIR" >&2
  exit 1
fi

WORK_DIR="$(mktemp -d /tmp/nexforce-ghpages.XXXXXX)"
cleanup() {
  rm -rf "$WORK_DIR"
}
trap cleanup EXIT

cp -r "$PUBLIC_DIR/." "$WORK_DIR/"

if grep -q "data-game-canvas" "$WORK_DIR/play.html"; then
  echo "warning: detected legacy runtime marker data-game-canvas in play.html"
fi

if ! grep -q "data-enter-fullscreen" "$WORK_DIR/play.html"; then
  echo "error: expected fullscreen marker data-enter-fullscreen is missing from play.html" >&2
  exit 1
fi

pushd "$WORK_DIR" >/dev/null
git init >/dev/null
git checkout -b "$PAGES_BRANCH" >/dev/null
git add .
git -c user.name='GitHub Copilot' -c user.email='copilot@users.noreply.github.com' commit -m "Deploy NexForce public site" >/dev/null
git remote add origin "$REPO_GIT_URL"
git push --force origin "$PAGES_BRANCH"
popd >/dev/null

STAMP="$(date +%s)"
PRIMARY_URL="${VERIFY_BASE_URL}${VERIFY_PATH}&v=${STAMP}"
PRIMARY_BODY="$(mktemp /tmp/nexforce-live-primary.XXXXXX.html)"

verify_marker_with_retry() {
  local url="$1"
  local output_file="$2"
  local max_attempts="${3:-12}"
  local sleep_seconds="${4:-5}"

  for attempt in $(seq 1 "$max_attempts"); do
    curl -sSL "$url" -o "$output_file"
    if grep -q "data-enter-fullscreen" "$output_file"; then
      return 0
    fi
    sleep "$sleep_seconds"
  done

  return 1
}

if verify_marker_with_retry "$PRIMARY_URL" "$PRIMARY_BODY"; then
  echo "verified: $PRIMARY_URL"
else
  echo "error: deploy verification failed for $PRIMARY_URL" >&2
  exit 1
fi

if [[ -n "$CUSTOM_VERIFY_BASE_URL" ]]; then
  CUSTOM_URL="${CUSTOM_VERIFY_BASE_URL}${VERIFY_PATH}&v=${STAMP}"
  CUSTOM_BODY="$(mktemp /tmp/nexforce-live-custom.XXXXXX.html)"
  if verify_marker_with_retry "$CUSTOM_URL" "$CUSTOM_BODY"; then
    echo "verified: $CUSTOM_URL"
  else
    echo "warning: custom domain has not propagated yet: $CUSTOM_URL"
  fi
fi

echo "live-url: ${VERIFY_BASE_URL}/"