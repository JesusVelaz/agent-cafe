#!/bin/sh
# Installs Agent Café on macOS or Linux, with no Node or pnpm needed:
#
#   curl -fsSL https://github.com/JesusVelaz/agent-cafe/releases/latest/download/install.sh | sh
#
# It downloads the app for this computer from the latest release into ~/.local/share/agent-cafe,
# puts an `agent-cafe` command in ~/.local/bin, and adds Agent Café to Applications (macOS) or the
# app menu (Linux). Run it again to update. Your café's data stays in ~/.agent-cafe either way.
# AGENT_CAFE_VERSION=v0.2.0 installs that release instead of the latest.
set -eu

repo="JesusVelaz/agent-cafe"
install_dir="${XDG_DATA_HOME:-$HOME/.local/share}/agent-cafe"
bin_dir="$HOME/.local/bin"

fail() { echo "agent-cafe install: $*" >&2; exit 1; }

case "$(uname -s)" in
  Darwin) os=macos ;;
  Linux) os=linux ;;
  *) fail "this script is for macOS and Linux. On Windows, download AgentCafeSetup.exe from https://github.com/$repo/releases/latest" ;;
esac
case "$(uname -m)" in
  x86_64 | amd64) arch=x64 ;;
  arm64 | aarch64) arch=arm64 ;;
  *) fail "no build for $(uname -m) processors yet." ;;
esac
# A Mac with Apple silicon can run this script under Rosetta; it should still get the native app.
if [ "$os" = macos ] && [ "$arch" = x64 ] && [ "$(sysctl -n sysctl.proc_translated 2>/dev/null || echo 0)" = 1 ]; then arch=arm64; fi

if [ -n "${AGENT_CAFE_VERSION:-}" ]; then
  url="https://github.com/$repo/releases/download/$AGENT_CAFE_VERSION/agent-cafe-$os-$arch.tar.gz"
else
  url="https://github.com/$repo/releases/latest/download/agent-cafe-$os-$arch.tar.gz"
fi

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
echo "Downloading Agent Café for $os ($arch)..."
curl -fL --progress-bar "$url" -o "$tmp/agent-cafe.tar.gz" || fail "couldn't download $url"
tar -xzf "$tmp/agent-cafe.tar.gz" -C "$tmp"
[ -x "$tmp/agent-cafe/agent-cafe" ] || fail "the download doesn't look like Agent Café."

# Swap the new app in whole, so an update never mixes old and new files.
mkdir -p "$(dirname "$install_dir")" "$bin_dir"
rm -rf "$install_dir.old"
if [ -e "$install_dir" ]; then mv "$install_dir" "$install_dir.old"; fi
mv "$tmp/agent-cafe" "$install_dir"
rm -rf "$install_dir.old"
ln -sf "$install_dir/agent-cafe" "$bin_dir/agent-cafe"

if [ "$os" = macos ]; then
  # A small app that opens the café in a Terminal window; closing the window closes the café.
  app="$HOME/Applications/Agent Café.app"
  rm -rf "$app"
  mkdir -p "$app/Contents/MacOS"
  cat > "$app/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>Agent Café</string>
  <key>CFBundleIdentifier</key><string>com.github.jesusvelaz.agent-cafe</string>
  <key>CFBundleExecutable</key><string>agent-cafe</string>
  <key>CFBundlePackageType</key><string>APPL</string>
</dict>
</plist>
PLIST
  printf '#!/bin/sh\nexec open -a Terminal "%s/agent-cafe"\n' "$install_dir" > "$app/Contents/MacOS/agent-cafe"
  chmod +x "$app/Contents/MacOS/agent-cafe"
  where="Open Agent Café from your Applications folder (in your home folder)"
else
  apps="${XDG_DATA_HOME:-$HOME/.local/share}/applications"
  mkdir -p "$apps"
  cat > "$apps/agent-cafe.desktop" <<DESKTOP
[Desktop Entry]
Type=Application
Name=Agent Café
Comment=Watch your Claude Code and Codex agents work
Exec="$install_dir/agent-cafe"
Icon=$install_dir/agent-cafe.png
Terminal=true
Categories=Development;
DESKTOP
  where="Open Agent Café from your app menu"
fi

echo
echo "☕ Agent Café $(sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' "$install_dir/package.json") is installed."
echo "   $where, or run: agent-cafe"
case ":$PATH:" in
  *":$bin_dir:"*) ;;
  *) echo "   (To run it by name, add $bin_dir to your PATH, or run $bin_dir/agent-cafe)" ;;
esac
