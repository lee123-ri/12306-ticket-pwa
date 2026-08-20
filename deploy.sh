#!/usr/bin/env bash
set -e

# ============================================================
#  火车票助手 · 一键部署脚本
#  用法：在项目根目录执行  bash deploy.sh
#  前提：服务器已安装 Docker + Docker Compose
# ============================================================

echo ""
echo "======================================"
echo "  火车票助手 · 部署"
echo "======================================"

# 1. 检查 Docker
if ! command -v docker >/dev/null 2>&1; then
  echo "[错误] 未检测到 Docker。请先安装："
  echo "  curl -fsSL https://get.docker.com | sh"
  exit 1
fi

# 2. 收集配置
echo ""
read -p "你的子域名（例如 ticket.example.com，不要带 https://）：" DOMAIN
if [ -z "$DOMAIN" ]; then
  echo "[错误] 子域名不能为空"
  exit 1
fi

read -p "DeepSeek API Key（没有就回车跳过，用内置规则）：" DS_KEY

# 3. 生成 .env
cat > .env <<EOF
PORT=8080
BASE_URL=https://${DOMAIN}
DEEPSEEK_API_KEY=${DS_KEY}
DEEPSEEK_API_URL=https://api.deepseek.com/chat/completions
DEEPSEEK_MODEL=deepseek-chat
VAPID_SUBJECT=mailto:you@example.com
POLL_INTERVAL_SEC=10
EOF
echo "[完成] 已生成 .env"

# 4. 生成 Caddyfile
cat > Caddyfile <<EOF
${DOMAIN} {
    reverse_proxy app:8080
}
EOF
echo "[完成] 已生成 Caddyfile（自动签 HTTPS 证书）"

# 5. 构建并启动
echo ""
echo "开始构建并启动（首次会自动拉取镜像、签证书，可能需要几分钟）..."
docker compose up -d --build

# 6. 等待健康检查
echo ""
echo "等待服务就绪..."
for i in $(seq 1 30); do
  code=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:8080/api/health" 2>/dev/null || echo "000")
  if [ "$code" = "200" ]; then
    echo "[完成] 服务已就绪"
    break
  fi
  sleep 2
done

echo ""
echo "======================================"
echo "  部署完成！"
echo "  访问地址：https://${DOMAIN}"
echo ""
echo "  手机使用："
echo "    1. 手机浏览器打开上面的地址"
echo "    2. 点右上角「开启通知」允许权限"
echo "    3. 浏览器菜单「添加到主屏幕」"
echo "======================================"
echo ""
echo "提示：请先确认 ${DOMAIN} 已解析到本服务器公网 IP（A 记录），否则证书签不出来。"
