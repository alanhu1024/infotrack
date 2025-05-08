#!/bin/sh

# 检查prisma目录和schema文件
echo "检查prisma目录..."
if [ -d "./prisma" ]; then
  echo "prisma目录已存在"
  if [ -f "./prisma/schema.prisma" ]; then
    echo "schema.prisma文件已存在"
    echo "正在生成Prisma客户端..."
    npx prisma generate --schema=./prisma/schema.prisma
  else
    echo "错误: prisma/schema.prisma文件不存在！"
    ls -la ./prisma/
    exit 1
  fi
else
  echo "错误: prisma目录不存在！"
  ls -la
  exit 1
fi
