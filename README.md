# InfoTrack - 智能信息追踪系统

InfoTrack 是一个智能信息追踪系统，可以帮助用户追踪和筛选社交媒体上的信息。目前支持追踪 Twitter 上指定用户的推文，并通过大模型分析判断是否符合用户设定的筛选标准。

## 功能特点

- 追踪指定 Twitter 用户的推文
- 使用 GPT-4 分析推文内容
- 支持自定义筛选标准
- 多渠道通知支持（飞书、钉钉、微信）
- 美观的 Web 界面，支持配置和查看历史记录

## 技术栈

- Next.js 14
- TypeScript
- Tailwind CSS
- Prisma (PostgreSQL)
- Twitter API v2
- OpenAI API
- 各种通知渠道的 API

## 开发环境设置

1. 克隆项目并安装依赖：

```bash
git clone <repository-url>
cd infotrack
npm install
```

2. 配置环境变量：

复制 `.env.example` 文件为 `.env`，并填写必要的配置信息：

```bash
cp .env.example .env
```

需要配置的环境变量包括：
- 数据库连接信息
- Twitter API 密钥
- OpenAI API 密钥
- 通知渠道的配置信息

3. 初始化数据库：

```bash
npx prisma db push
```

4. 启动开发服务器：

```bash
npm run dev
```

## 部署

1. 构建项目：

```bash
npm run build
```

2. 启动生产服务器：

```bash
npm start
```

## 使用方法

1. 注册并登录系统
2. 配置要追踪的 Twitter 用户
3. 设置信息筛选标准
4. 配置通知渠道
5. 启动追踪

系统会自动追踪指定用户的新推文，并根据设定的标准进行筛选。符合条件的推文会通过配置的渠道发送通知。

## 扩展性

系统设计时考虑了良好的扩展性：

- 信息源：可以轻松添加新的社交媒体平台
- 通知渠道：支持添加新的通知方式
- 分析能力：可以扩展或替换当前的分析模型

## 贡献

欢迎提交 Issue 和 Pull Request！

## 许可证

MIT
