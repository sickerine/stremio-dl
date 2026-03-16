#!/bin/bash
# Usage:
#   Manual:  curl -fsSL https://raw.githubusercontent.com/sickerine/stremio-dl/main/scripts/update.sh | bash
#   Server:  bash /tmp/stremio-dl-update.sh --pid 12345

REPO="sickerine/stremio-dl"
API="https://api.github.com/repos/$REPO/releases/latest"
LOG="/tmp/stremio-dl-update.log"
TARGET_PID=""

# Parse args
while [ $# -gt 0 ]; do
  case "$1" in
    --pid) TARGET_PID="$2"; shift 2 ;;
    *) shift ;;
  esac
done

# Log everything
exec >> "$LOG" 2>&1
echo "=== Update $(date) ==="

OS=$(uname -s | tr '[:upper:]' '[:lower:]')
ARCH=$(uname -m)

case "$ARCH" in
  x86_64|amd64) ARCH="x64" ;;
  arm64|aarch64) ARCH="arm64" ;;
  *) echo "Unsupported architecture: $ARCH"; exit 1 ;;
esac

case "$OS" in
  darwin) ASSET="stremio-dl-darwin-${ARCH}.app.zip" ;;
  linux)  ASSET="stremio-dl-linux-${ARCH}" ;;
  *)      echo "Unsupported OS: $OS"; exit 1 ;;
esac

echo "Fetching latest release..."
URL=$(curl -fsSL "$API" | grep "browser_download_url.*$ASSET\"" | head -1 | cut -d '"' -f 4)

if [ -z "$URL" ]; then
  echo "Could not find $ASSET in latest release"
  exit 1
fi

VERSION=$(echo "$URL" | grep -oE 'v[0-9]+\.[0-9]+\.[0-9]+')
echo "Latest: $VERSION ($ASSET)"

# Kill running instance — by exact PID if given, otherwise by pattern
if [ -n "$TARGET_PID" ]; then
  echo "Killing PID $TARGET_PID..."
  kill "$TARGET_PID" 2>/dev/null || true
else
  echo "Killing by pattern..."
  OWN_PGID=$(ps -o pgid= -p $$ 2>/dev/null | tr -d ' ')
  for pid in $(pgrep -f '[s]tremio-dl' 2>/dev/null); do
    PID_PGID=$(ps -o pgid= -p "$pid" 2>/dev/null | tr -d ' ')
    if [ "$PID_PGID" != "$OWN_PGID" ]; then
      kill "$pid" 2>/dev/null && echo "Stopped $pid" || true
    fi
  done
fi
sleep 2

if [ "$OS" = "darwin" ]; then
  echo "Downloading..."
  curl -fSL -o /tmp/stremio-dl.zip "$URL"
  rm -rf "/Applications/Stremio DL.app"
  unzip -qo /tmp/stremio-dl.zip -d /Applications
  rm -f /tmp/stremio-dl.zip
  xattr -cr "/Applications/Stremio DL.app" 2>/dev/null || true
  echo "Launching..."
  open "/Applications/Stremio DL.app"
else
  INSTALL_DIR="$HOME/.local/bin"
  mkdir -p "$INSTALL_DIR"
  echo "Downloading..."
  curl -fSL -o "$INSTALL_DIR/stremio-dl" "$URL"
  chmod +x "$INSTALL_DIR/stremio-dl"
  echo "Launching..."
  "$INSTALL_DIR/stremio-dl" &
fi

echo "=== Done: $VERSION ==="
