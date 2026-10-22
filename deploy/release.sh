#!/bin/sh
# 部署阶段执行脚本（发布包直部署）：解包 → 覆盖 → 迁移 → 重启 → 健康探测
# 运行目录为构建产物下载后的目录（含 apphub-release-*.tar.gz）
# 服务器一次性初始化（node 22 / pm2 / /opt/apphub / server.env / nginx 站点）见 docs/指南/发布包打包与部署指南.md
set -e

APP_DIR=/opt/apphub

TAR=$(ls apphub-release-*.tar.gz 2>/dev/null | head -1)
[ -n "$TAR" ] || { echo "未找到发布包 apphub-release-*.tar.gz"; exit 1; }
[ -f "$APP_DIR/server.env" ] || { echo "缺少 $APP_DIR/server.env，请参照 server.env.example 初始化"; exit 1; }
command -v pm2 >/dev/null 2>&1 || { echo "未安装 pm2（npm install -g pm2，初始化见部署指南）"; exit 1; }

# 解包到同盘暂存目录（失败即退出，线上服务不受影响）
STAGE=$APP_DIR/.staging
rm -rf "$STAGE" && mkdir -p "$STAGE"
echo "== 解包 $TAR =="
tar -xzf "$TAR" -C "$STAGE"
cat "$STAGE/release-info"

echo "== 覆盖发布 =="
rsync -a --delete "$STAGE/web-dist/" "$APP_DIR/web-dist/"
rsync -a --delete "$STAGE/server/" "$APP_DIR/server/"
rm -rf "$STAGE"

echo "== 执行数据库迁移（ADR-005：迁移是唯一建表通道）=="
cd "$APP_DIR/server"
set -a && . "$APP_DIR/server.env" && set +a
./node_modules/.bin/typeorm migration:run -d dist/data-source.js

echo "== 重启服务（pm2：已注册则 restart --update-env 继承上面 source 的 server.env 最新值；首次部署自动拉起）=="
if pm2 describe apphub >/dev/null 2>&1; then
  pm2 restart apphub --update-env
else
  pm2 start dist/main.js --name apphub
fi

echo "== 健康探测 =="
for i in $(seq 1 10); do
  if curl -sf http://127.0.0.1:3000/api/health >/dev/null; then
    echo "健康检查通过（/api/health）"
    pm2 status apphub
    exit 0
  fi
  sleep 2
done
echo "警告：健康探测未通过，查看日志：pm2 logs apphub" >&2
exit 1
