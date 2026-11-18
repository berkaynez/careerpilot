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

panel="$stage/CareerPilot Panel.app/Contents"
mkdir -p "$panel/MacOS" "$panel/Resources/panel/node_modules"
cp "$app/Resources/node" "$panel/Resources/node"
cp package.json "$panel/Resources/panel/"
cp -R src "$panel/Resources/panel/"
for name in tsx esbuild @esbuild playwright playwright-core zod; do
  cp -R "node_modules/$name" "$panel/Resources/panel/node_modules/"
done
cp scripts/mac-panel-launch "$panel/MacOS/CareerPilot"
sed -e 's/local.careerpilot.search/local.careerpilot.panel/' -e 's/<string>CareerPilot<\/string>$/<string>CareerPilot Panel<\/string>/'   scripts/mac-info.plist > "$panel/Info.plist"
/usr/libexec/PlistBuddy -c 'Set :CFBundleExecutable CareerPilot' "$panel/Info.plist"
codesign --force --sign - "$stage/CareerPilot Panel.app"
codesign --verify --strict "$stage/CareerPilot Panel.app"
ditto "$stage/CareerPilot Panel.app" "$dest/CareerPilot Panel.app"
