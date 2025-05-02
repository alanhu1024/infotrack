import axios from 'axios';
import { NotificationService, NotificationPayload } from './types';
import { env } from '@/config/env';

export class FeishuNotificationService implements NotificationService {
  private readonly appId: string;
  private readonly appSecret: string;
  private accessToken: string = '';
  private tokenExpireTime: number = 0;

  constructor() {
    if (!env.FEISHU_APP_ID || !env.FEISHU_APP_SECRET) {
      throw new Error('Feishu credentials not configured');
    }
    this.appId = env.FEISHU_APP_ID;
    this.appSecret = env.FEISHU_APP_SECRET;
  }

  private async getAccessToken(): Promise<string> {
    if (this.accessToken && Date.now() < this.tokenExpireTime) {
      return this.accessToken;
    }

    const response = await axios.post('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
      app_id: this.appId,
      app_secret: this.appSecret,
    });

    this.accessToken = response.data.tenant_access_token;
    this.tokenExpireTime = Date.now() + response.data.expire * 1000;

    return this.accessToken;
  }

  async send(payload: NotificationPayload): Promise<void> {
    const token = await this.getAccessToken();

    await axios.post(
      'https://open.feishu.cn/open-apis/message/v4/send/',
      {
        msg_type: 'interactive',
        card: {
          header: {
            title: { tag: 'plain_text', content: payload.title },
          },
          elements: [
            {
              tag: 'div',
              text: { tag: 'lark_md', content: payload.content },
            },
            payload.url && {
              tag: 'action',
              actions: [
                {
                  tag: 'button',
                  text: { tag: 'plain_text', content: '查看详情' },
                  url: payload.url,
                  type: 'default',
                },
              ],
            },
          ].filter(Boolean),
        },
      },
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      }
    );
  }
}