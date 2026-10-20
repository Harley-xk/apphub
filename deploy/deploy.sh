#!/bin/sh
# 云效「主机部署」执行脚本：加载新镜像并重建容器
# 运行目录为云效下载构建产物后的目录（含 apphub-image.tar.gz 与本 deploy/ 目录）
set -e

APP_DIR=/opt/apphub
IMAGE_TAR=apphub-image.tar.gz

# 运行文件须已一次性初始化（见 docs/指南/Docker打包与部署指南.md §4）
[ -f "$APP_DIR/server.env" ] || { echo "缺少 $APP_DIR/server.env，请参照 server.env.example 初始化"; exit 1; }
[ -f "$APP_DIR/docker-compose.yml" ] || { echo "缺少 $APP_DIR/docker-compose.yml"; exit 1; }

docker load -i "$IMAGE_TAR"
docker compose -f "$APP_DIR/docker-compose.yml" up -d

# 仅清悬空层：带编号 tag 的历史镜像保留，供快速回滚
docker image prune -f

docker compose -f "$APP_DIR/docker-compose.yml" ps
