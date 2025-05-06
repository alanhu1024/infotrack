# 通知服务

项目支持多种通知渠道，用于在检测到满足特定规则的推文时通知用户。

## 可用通知服务

- **飞书（Feishu）**: 通过飞书机器人发送通知消息
- **百度智能外呼**: 通过百度智能外呼平台自动呼叫用户

## 配置百度智能外呼服务

1. 在项目根目录的 `.env` 文件中添加以下配置：

```
# 百度智能外呼平台
BAIDU_ACCESS_KEY=1c0dcd70ec4c4af1a4418c137e314abe
BAIDU_SECRET_KEY=b53c0c34e7564cddb4169a35847ffcc6
BAIDU_ROBOT_ID=6c428d95-790b-4ef4-8b1c-d6622520c8b6
BAIDU_CALLER_NUMBER=您的主叫号码
```

2. 配置说明：
   - `BAIDU_ACCESS_KEY`: 百度智能云访问密钥 ID
   - `BAIDU_SECRET_KEY`: 百度智能云访问密钥密码
   - `BAIDU_ROBOT_ID`: 已配置的机器人 ID
   - `BAIDU_CALLER_NUMBER`: 已购买的主叫号码

## 使用方法

在需要发送通知的地方：

```typescript
import { notificationServices } from '@/services/notification';

// 发送飞书通知
const feishuService = notificationServices.get('feishu');
if (feishuService) {
  await feishuService.send({
    userId: 'user123',
    channelId: 'channel456',
    title: '检测到重要推文',
    content: '推文内容...',
    metadata: {
      tweetId: '12345',
      authorId: 'author789',
      // 其他元数据...
    }
  });
}

// 发送百度智能外呼通知（直接呼叫用户手机）
const baiduCallingService = notificationServices.get('baidu-calling');
if (baiduCallingService) {
  await baiduCallingService.send({
    userId: '13800138000', // 用户手机号码
    channelId: 'calling',
    title: '检测到重要推文',
    content: '推文内容...',
    metadata: {
      tweetId: '12345',
      authorId: 'author789',
      // 其他元数据...
    }
  });
}
```

## 注意事项

1. 使用百度智能外呼服务时，`userId` 应为用户的手机号码（11位）
2. 百度智能外呼服务将把通知内容作为对话变量传递给百度机器人，确保机器人已配置相应的对话变量
3. 确保遵守电话营销相关法规，避免骚扰用户
4. 合理设置呼叫时间，避免在休息时间打扰用户 