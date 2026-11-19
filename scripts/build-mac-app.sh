#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
dest=${1:?Bir çıktı klasörü belirt}
stage=$(mktemp -d)
trap 'rm -rf "$stage"' EXIT
app="$stage/CareerPilot.app/Contents"
runtime="$app/Resources/panel"
mkdir -p "$app/MacOS" "$runtime/node_modules/pdfmake/build"
cp "$(node -p 'process.execPath')" "$app/Resources/node"
cp package.json "$runtime/"
cp -R src "$runtime/"
for name in tsx esbuild @esbuild playwright playwright-core zod; do
  cp -R "node_modules/$name" "$runtime/node_modules/"
done
cp node_modules/pdfmake/LICENSE node_modules/pdfmake/package.json "$runtime/node_modules/pdfmake/"
cp node_modules/pdfmake/build/pdfmake.min.js node_modules/pdfmake/build/vfs_fonts.js "$runtime/node_modules/pdfmake/build/"
cp scripts/mac-launch "$app/MacOS/CareerPilot"
cp scripts/mac-info.plist "$app/Info.plist"
chmod +x "$app/MacOS/CareerPilot"
codesign --force --sign - "$stage/CareerPilot.app"
codesign --verify --strict "$stage/CareerPilot.app"
mkdir -p "$dest"
target="$dest/CareerPilot.app"
install_dir=$(mktemp -d "$dest/.careerpilot-install.XXXXXX")
ditto --norsrc --noextattr "$stage/CareerPilot.app" "$install_dir/CareerPilot.app"
# The clean build passed strict verification above. Synced destinations add Finder metadata.
codesign --verify "$install_dir/CareerPilot.app"
if [ -e "$target" ]; then
  if [ "$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$target/Contents/Info.plist")" != local.careerpilot.search ]; then
    echo "Çıktı konumunda farklı bir uygulama var." >&2
    exit 1
  fi
  mv "$target" "$install_dir/previous.app"
fi
if mv "$install_dir/CareerPilot.app" "$target"; then
  rm -rf "$install_dir"
else
  if [ -d "$install_dir/previous.app" ]; then mv "$install_dir/previous.app" "$target"; fi
  exit 1
fi
