#!/bin/bash
set -e

REPO="sickerine/stremio-dl"
API="https://api.github.com/repos/$REPO/releases/latest"

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
  *)      echo "Unsupported OS: $OS (use update.ps1 for Windows)"; exit 1 ;;
esac

echo "Fetching latest release..."
URL=$(curl -s "$API" | grep "browser_download_url.*$ASSET\"" | head -1 | cut -d '"' -f 4)

if [ -z "$URL" ]; then
  echo "Could not find $ASSET in latest release"
  exit 1
fi

VERSION=$(echo "$URL" | grep -oE 'v[0-9]+\.[0-9]+\.[0-9]+')
echo "Latest: $VERSION ($ASSET)"

# Kill running stremio-dl server instance, but not our own process tree.
# pgrep -f matches command lines, which would include this script's parent
# shell, so we filter out our own process group.
OWN_PGID=$(ps -o pgid= -p $$ 2>/dev/null | tr -d ' ')
for pid in $(pgrep -f '[s]tremio-dl' 2>/dev/null); do
  PID_PGID=$(ps -o pgid= -p "$pid" 2>/dev/null | tr -d ' ')
  if [ "$PID_PGID" != "$OWN_PGID" ]; then
    kill "$pid" 2>/dev/null && echo "Stopped process $pid" || true
  fi
done
sleep 1

if [ "$OS" = "darwin" ]; then
  INSTALL_DIR="/Applications"
  echo "Downloading..."
  curl -L -o /tmp/stremio-dl.zip "$URL"
  rm -rf "$INSTALL_DIR/Stremio DL.app"
  unzip -qo /tmp/stremio-dl.zip -d "$INSTALL_DIR"
  rm /tmp/stremio-dl.zip
  xattr -cr "$INSTALL_DIR/Stremio DL.app"
  echo "Installed to $INSTALL_DIR/Stremio DL.app"
  open "$INSTALL_DIR/Stremio DL.app"
else
  INSTALL_DIR="$HOME/.local/bin"
  mkdir -p "$INSTALL_DIR"
  echo "Downloading..."
  curl -L -o "$INSTALL_DIR/stremio-dl" "$URL"
  chmod +x "$INSTALL_DIR/stremio-dl"
  echo "Installed to $INSTALL_DIR/stremio-dl"
  "$INSTALL_DIR/stremio-dl" &
fi

echo "Done — $VERSION is running"
