# InfoTrack

信息追踪、智能分析与实时通知的全方位解决方案。

## Railway部署指南

### 准备工作

1. 创建Railway账户并安装Railway CLI
2. 登录Railway CLI: `railway login`

### 部署步骤

1. 创建新项目：`railway init`
2. 添加PostgreSQL数据库：`railway add`
3. 设置环境变量：
   - 在Railway控制台中配置所有`.env.example`中列出的环境变量
   - 确保设置`DATABASE_URL`连接到Railway提供的PostgreSQL实例

4. 部署项目：`railway up`

### 环境变量配置

请参考`.env.example`文件中的变量列表，确保在Railway控制台中配置所有必需的环境变量。

### 数据库迁移

首次部署后，需要执行数据库迁移：

```bash
railway run npx prisma migrate deploy
```

## 本地开发

1. 克隆仓库
2. 安装依赖：`npm install`
3. 复制`.env.example`为`.env`并填写配置
4. 运行开发服务器：`npm run dev`
