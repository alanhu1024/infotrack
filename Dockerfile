FROM node:18.19.0-alpine AS base

# 安装依赖
FROM base AS deps
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm install

# 构建应用
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# 确保prisma目录和schema文件存在
RUN test -d ./prisma && test -f ./prisma/schema.prisma || (echo "Error: prisma/schema.prisma not found" && exit 1)


# 生成Prisma客户端
RUN npx prisma generate --schema=./prisma/schema.prisma

# 构建应用
RUN npm run build

# 生产环境
FROM base AS runner
WORKDIR /app

ENV NODE_ENV production

# 创建非root用户
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs
USER nextjs

COPY --from=builder /app/public ./public
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/prisma.js ./prisma.js

# 使用standalone输出以减小镜像体积
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# 复制环境变量配置脚本
COPY --from=builder --chown=nextjs:nodejs /app/set-env.sh ./

# 暴露端口
EXPOSE 3000

# 设置环境变量
ENV PORT 3000
ENV HOSTNAME "0.0.0.0"

# 启动应用
CMD ["node", "server.js"] 