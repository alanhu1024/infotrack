# InfoTrack 部署指南

本文档提供了将InfoTrack系统部署到生产服务器的步骤。

## 目录
1. [系统要求](#系统要求)
2. [Docker部署](#docker部署)
3. [手动部署](#手动部署)
4. [环境变量配置](#环境变量配置)
5. [数据库迁移](#数据库迁移)
6. [常见问题](#常见问题)

## 系统要求

- Node.js 18.19.0
- PostgreSQL 数据库
- 公网IP或域名（用于接收Twitter API回调）
- 足够的内存（建议至少2GB）
- 百度智能外呼平台凭证
- Twitter API凭证

## Docker部署

使用Docker是最快速、推荐的部署方式。

### 前提条件

- 安装 [Docker](https://docs.docker.com/get-docker/)
- 安装 [Docker Compose](https://docs.docker.com/compose/install/)

### 部署步骤

1. **克隆代码仓库**:
   ```bash
   git clone <repository-url>
   cd infotrack
   ```

2. **配置环境变量**:
   
   创建`.env.production`文件并填入所有必要的环境变量（参见下面的环境变量配置部分）。

3. **使用Docker Compose启动应用**:
   ```bash
   docker-compose up -d
   ```

4. **执行数据库迁移**:
   ```bash
   docker-compose exec app npx prisma migrate deploy
   ```

5. **访问应用**:
   
   应用现在应该在 http://your-server-ip:3000 运行。

## 手动部署

如果你不想使用Docker，也可以手动部署。

### 前提条件

- Node.js 18.19.0
- PostgreSQL 数据库
- PM2或类似的进程管理器

### 部署步骤

1. **克隆代码仓库**:
   ```bash
   git clone <repository-url>
   cd infotrack
   ```

2. **安装依赖**:
   ```bash
   npm ci
   ```

3. **配置环境变量**:
   
   创建`.env.production`文件并设置所有必要的环境变量。

4. **构建应用**:
   ```bash
   npm run build
   ```

5. **执行数据库迁移**:
   ```bash
   npx prisma migrate deploy
   ```

6. **启动应用**:
   ```bash
   # 使用PM2启动
   pm2 start npm --name "infotrack" -- start
   
   # 或直接启动
   npm start
   ```

## 环境变量配置

以下是应用所需的环境变量列表:

```
# 数据库连接配置
DATABASE_URL=postgresql://username:password@host:port/database

# Twitter API
TWITTER_API_KEY=your_twitter_api_key
TWITTER_API_SECRET=your_twitter_api_secret
TWITTER_ACCESS_TOKEN=your_twitter_access_token
TWITTER_ACCESS_SECRET=your_twitter_access_secret

# OpenAI API
OPENAI_API_KEY=your_openai_api_key

# 阿里大模型 API
ALI_API_KEY=sk-48cac4f6e9ad4dabbcc0688654e70820

# 百度智能外呼平台
BAIDU_ACCESS_KEY=1c0dcd70ec4c4af1a4418c137e314abe
BAIDU_SECRET_KEY=b53c0c34e7564cddb4169a35847ffcc6
BAIDU_ROBOT_ID=6c428d95-790b-4ef4-8b1c-d6622520c8b6
BAIDU_CALLER_NUMBER=057127890909

# NextAuth配置
NEXTAUTH_URL=https://your-production-domain.com
NEXTAUTH_SECRET=generate-a-secure-random-string
```

## 数据库迁移

每次部署新版本时，必须执行数据库迁移:

```bash
# Docker环境
docker-compose exec app npx prisma migrate deploy

# 非Docker环境
npx prisma migrate deploy
```

## 常见问题

### 1. Twitter API连接问题

确保Twitter API凭证正确，并且你的服务器可以访问Twitter API。

### 2. 百度智能外呼服务未配置

确保在环境变量中设置了所有必要的百度智能外呼平台凭证。这些凭证包括访问密钥、密钥、机器人ID和主叫号码。

### 3. 数据库连接问题

检查数据库URL是否正确，以及PostgreSQL服务是否正常运行。对于Docker部署，确保数据库容器已启动。

### 4. 内存不足

如果应用占用过多内存，可以在`next.config.mjs`中调整Node.js的内存限制:

```js
// next.config.mjs
const nextConfig = {
  experimental: {
    // 增加Node.js内存限制
    memoryLimit: 4 * 1024, // 4GB
  },
  // 其他配置...
};
```