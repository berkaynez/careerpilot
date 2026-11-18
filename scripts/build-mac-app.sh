#!/bin/sh
set -eu
# Build a local, relocatable app for the current Mac architecture.
cd "$(dirname "$0")/.."
dest=${1:?Bir çıktı klasörü belirt}
stage=$(mktemp -d)
trap 'rm -rf "$stage"' EXIT
app="$stage/CareerPilot.app/Contents"
mkdir -p "$app/MacOS" "$app/Resources/public"
cp "$(node -p 'process.execPath')" "$app/Resources/node"
node_modules/.bin/esbuild src/quick/desktop.ts --bundle --platform=node --format=esm --target=node22 --outfile="$app/Resources/desktop.mjs"
cp src/quick/public/* "$app/Resources/public/"
cp scripts/mac-launch "$app/MacOS/CareerPilot"
cp scripts/mac-info.plist "$app/Info.plist"
chmod +x "$app/MacOS/CareerPilot"
codesign --force --sign - "$stage/CareerPilot.app"
codesign --verify --strict "$stage/CareerPilot.app"
mkdir -p "$dest"
ditto "$stage/CareerPilot.app" "$dest/CareerPilot.app"
