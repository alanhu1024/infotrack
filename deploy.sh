#!/bin/bash

# InfoTrack一键部署脚本
# 使用方法: ./deploy.sh

set -e  # 遇到错误立即退出

echo "===== InfoTrack 部署脚本 ====="
echo "此脚本将帮助您将InfoTrack部署到服务器。"
echo "确保您已安装Docker和Docker Compose。"

# 检查Docker是否安装
if ! command -v docker &> /dev/null; then
    echo "ERROR: Docker未安装。请先安装Docker: https://docs.docker.com/get-docker/"
    exit 1
fi

# 检查Docker Compose是否安装
if ! command -v docker-compose &> /dev/null; then
    echo "ERROR: Docker Compose未安装。请先安装Docker Compose: https://docs.docker.com/compose/install/"
    exit 1
fi

# 构建应用
echo "Step 1: 构建应用..."
docker-compose build

# 启动应用
echo "Step 2: 启动应用..."
docker-compose up -d

# 等待数据库启动
echo "Step 3: 等待数据库启动..."
sleep 5

# 运行数据库迁移
echo "Step 4: 运行数据库迁移..."
docker-compose exec -T app npx prisma migrate deploy

echo "===== 部署完成 ====="
echo "InfoTrack应用已成功部署!"
echo "您可以通过以下地址访问应用: http://$(hostname -I | awk '{print $1}'):3000" 