#!/bin/bash
# 飞牛音乐播放器 - 构建打包脚本
# 需要 fnpack CLI: https://static2.fnnas.com/fnpack/
# 使用方式: cd fn-music-player && ./build.sh

set -e

APP_NAME="fn-music-player"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "========================================"
echo "  🎵 构建 ${APP_NAME}"
echo "========================================"

# 检查 fnpack
if ! command -v fnpack &>/dev/null; then
  echo "❌ 未找到 fnpack CLI，请先安装："
  echo "   https://static2.fnnas.com/fnpack/fnpack-1.2.1-linux-amd64"
  echo "   安装后移动到 /usr/local/bin/fnpack 并 chmod +x"
  exit 1
fi

# 进入项目目录
cd "$SCRIPT_DIR"

# 构建
echo "📦 开始打包..."
fnpack build --directory "$SCRIPT_DIR"

if [ -f "${APP_NAME}.fpk" ]; then
  echo "✅ 打包成功: ${APP_NAME}.fpk"
  echo "   文件大小: $(ls -lh "${APP_NAME}.fpk" | awk '{print $5}')"
  echo ""
  echo "📋 安装到飞牛 NAS："
  echo "   appcenter-cli install-fpk ${APP_NAME}.fpk"
  echo ""
  echo "📋 静默安装（跳过向导）："
  echo "   appcenter-cli install-fpk ${APP_NAME}.fpk --env config.env"
else
  echo "❌ 打包失败"
  exit 1
fi
