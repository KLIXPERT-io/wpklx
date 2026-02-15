#!/bin/sh
set -eu

REPO="KLIXPERT-io/wpklx"
INSTALL_DIR="$HOME/.local/bin"

main() {
  os=$(uname -s | tr '[:upper:]' '[:lower:]')
  arch=$(uname -m)

  case "$os" in
    linux)  platform="linux" ;;
    darwin) platform="darwin" ;;
    *)
      echo "Unsupported OS: $os"
      echo "Download manually: https://github.com/$REPO/releases/tag/latest"
      exit 1
      ;;
  esac

  case "$arch" in
    x86_64|amd64)  arch="x64" ;;
    aarch64|arm64)
      if [ "$platform" = "linux" ]; then
        echo "Error: No Linux arm64 binary available."
        exit 1
      fi
      arch="arm64"
      ;;
    *)
      echo "Unsupported architecture: $arch"
      exit 1
      ;;
  esac

  binary="wpklx-${platform}-${arch}"
  url="https://github.com/$REPO/releases/download/latest/$binary"

  tmpfile=$(mktemp)
  trap 'rm -f "$tmpfile"' EXIT

  echo "Downloading $binary..."
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL "$url" -o "$tmpfile"
  elif command -v wget >/dev/null 2>&1; then
    wget -qO "$tmpfile" "$url"
  else
    echo "Error: curl or wget required"
    exit 1
  fi

  mkdir -p "$INSTALL_DIR"
  mv "$tmpfile" "$INSTALL_DIR/wpklx"
  chmod +x "$INSTALL_DIR/wpklx"

  echo "Installed wpklx to $INSTALL_DIR/wpklx"

  if "$INSTALL_DIR/wpklx" --version >/dev/null 2>&1; then
    echo "Verified: $("$INSTALL_DIR/wpklx" --version)"
  fi

  case ":${PATH}:" in
    *":$INSTALL_DIR:"*) ;;
    *)
      echo ""
      echo "Add $INSTALL_DIR to your PATH:"
      shell_name=$(basename "${SHELL:-/bin/sh}")
      case "$shell_name" in
        bash) echo "  echo 'export PATH=\"\$HOME/.local/bin:\$PATH\"' >> ~/.bashrc && source ~/.bashrc" ;;
        zsh)  echo "  echo 'export PATH=\"\$HOME/.local/bin:\$PATH\"' >> ~/.zshrc && source ~/.zshrc" ;;
        fish) echo "  fish_add_path ~/.local/bin" ;;
        *)    echo "  export PATH=\"\$HOME/.local/bin:\$PATH\"" ;;
      esac
      ;;
  esac
}

main
