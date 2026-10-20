#!/bin/sh
# n-1 容器入口：等待数据库就绪 → 执行迁移（ADR-005）→ 拉起 nginx 与 NestJS
set -e

# 数据库探测：pg 客户端直连验证（DB_* 由 compose env_file 注入）
WAIT_TIMEOUT=${DB_WAIT_TIMEOUT:-120}
elapsed=0
until node -e "const { Client } = require('pg')
const c = new Client({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT || 5432),
  user: process.env.DB_USERNAME,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_DATABASE,
})
c.connect().then(() => c.end()).then(() => process.exit(0)).catch(() => process.exit(1))"; do
  if [ "$elapsed" -ge "$WAIT_TIMEOUT" ]; then
    echo "数据库等待超时（${WAIT_TIMEOUT}s），容器退出" >&2
    exit 1
  fi
  echo "等待数据库就绪（已等 ${elapsed}s）..."
  sleep 2
  elapsed=$((elapsed + 2))
done

echo "执行数据库迁移..."
./node_modules/.bin/typeorm migration:run -d dist/data-source.js

echo "启动 nginx 与应用..."
nginx

# node 接管 PID 1：docker stop 的 SIGTERM 直达应用，触发优雅关停
exec node dist/main.js
