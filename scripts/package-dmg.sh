#!/usr/bin/env bash
# Build an Apple Silicon DMG for local submission.
#
# electron-builder skips code signing entirely when no "Developer ID
# Application" identity is present, which leaves a broken signature that macOS
# reports as "damaged". This script packages the .app, ad-hoc signs it (valid
# for a locally-built, non-notarized build), and then creates the DMG.
set -euo pipefail
cd "$(dirname "$0")/.."

VERSION="$(node -p "require('./package.json').version")"
ARCH="arm64"
APP="release/mac-arm64/Intelligent Enterprise Assistant.app"
DMG="release/Intelligent-Enterprise-Assistant-${VERSION}-${ARCH}.dmg"

# Build the web bundle and package the .app (no DMG yet so we can sign it).
npm run build
npx electron-builder --mac --dir

# Ad-hoc sign so Gatekeeper does not report the app as damaged.
codesign --force --deep --sign - "$APP"
codesign --verify --deep --strict "$APP"

# Create the DMG with the standard Applications shortcut.
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT
cp -R "$APP" "$STAGE/"
ln -s /Applications "$STAGE/Applications"
rm -f "$DMG" "$DMG.blockmap"
hdiutil create \
  -volname "Intelligent Enterprise Assistant" \
  -srcfolder "$STAGE" \
  -ov \
  -format UDZO \
  "$DMG"

echo "Created $DMG"
