import axios from 'axios';
import crypto from 'crypto';
import { NotificationService, NotificationPayload } from './types';
import { env } from '@/config/env';

export class BaiduCallingService implements NotificationService {
  private readonly accessKey: string;
  private readonly secretKey: string;
  private readonly robotId: string;
  private readonly callerNum: string;
  private readonly baseUrl: string = 'https://aip.baidubce.com/rpc/2.0/cloud_callbot';
  private readonly tokenUrl: string = 'https://aiob-open.baidu.com/api/v2/getToken';
  private token: string | null = null;
  private tokenExpiry: number = 0;

  constructor() {
    if (!env.BAIDU_ACCESS_KEY || !env.BAIDU_SECRET_KEY || !env.BAIDU_ROBOT_ID || !env.BAIDU_CALLER_NUMBER) {
      throw new Error('百度智能外呼平台凭证未配置');
    }
    this.accessKey = env.BAIDU_ACCESS_KEY;
    this.secretKey = env.BAIDU_SECRET_KEY;
    this.robotId = env.BAIDU_ROBOT_ID;
    this.callerNum = env.BAIDU_CALLER_NUMBER;
    
    console.log('[BaiduCallingService] 已初始化百度智能外呼服务', {
      accessKey: this.accessKey.substring(0, 5) + '...',
      secretKey: this.secretKey.substring(0, 5) + '...',
      robotId: this.robotId,
      callerNum: this.callerNum
    });
  }

  /**
   * 获取百度智能外呼平台访问Token
   * 
   * 文档: https://cloud.baidu.com/doc/CCC/s/Llssjaptf
   * 使用POST方法，直接在请求体中提供accessKey和secretKey
   */
  private async getToken(): Promise<string> {
    if (this.token && this.tokenExpiry > Date.now()) {
      return this.token;
    }

    try {
      console.log('[BaiduCallingService] 准备获取Token, 使用AccessKey:', this.accessKey.substring(0, 5) + '...');
      
      // 使用百度智能外呼平台的API获取Token
      const response = await axios.post(
        this.tokenUrl,
        {
          accessKey: this.accessKey,
          secretKey: this.secretKey
        },
        {
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json'
          }
        }
      );
      
      console.log('[BaiduCallingService] Token响应:', JSON.stringify(response.data, null, 2));
      
      // 检查响应格式并使用正确的字段名 'accessToken' 而不是 'token'
      if (!response.data.data || !response.data.data.accessToken) {
        throw new Error('获取Token失败：返回数据不包含accessToken');
      }
      
      const token = response.data.data.accessToken;
      // 使用正确的过期时间字段 'expiresTime'
      const expiresIn = response.data.data.expiresTime || 7200; // 使用接口返回的过期时间
      
      this.token = token;
      this.tokenExpiry = Date.now() + (expiresIn * 1000);
      
      console.log('[BaiduCallingService] 成功获取Token，有效期:', expiresIn, '秒');
      return token;
    } catch (error: any) {
      console.error('[BaiduCallingService] 获取百度Token失败');
      
      // 增加详细错误日志
      if (error.response) {
        console.error('[BaiduCallingService] 错误状态码:', error.response.status);
        console.error('[BaiduCallingService] 错误详情:', JSON.stringify(error.response.data, null, 2));
        console.error('[BaiduCallingService] 请求头:', JSON.stringify(error.config?.headers, null, 2));
        console.error('[BaiduCallingService] 请求体:', JSON.stringify(error.config?.data, null, 2));
      } else if (error.request) {
        console.error('[BaiduCallingService] 请求已发送但未收到响应');
      } else {
        console.error('[BaiduCallingService] 请求配置错误:', error.message);
      }
      
      throw new Error(`获取百度Token失败: ${error.response?.data?.msg || error.message}`);
    }
  }

  /**
   * 发送百度智能外呼通知
   * 
   * 文档: https://cloud.baidu.com/doc/CCC/s/Llssjaptf
   * 需要通过dialog_var传递对话变量，用于外呼模板中的变量替换
   */
  async send(payload: NotificationPayload): Promise<void> {
    try {
      const phoneNumber = payload.userId;
      if (!phoneNumber || !/^1\d{10}$/.test(phoneNumber)) {
        console.warn(`[BaiduCallingService] 无效的电话号码: ${phoneNumber}`);
        return;
      }

      console.log(`[BaiduCallingService] 准备向 ${phoneNumber} 发送外呼通知`);
      
      // 获取token
      const token = await this.getToken();
      console.log(`[BaiduCallingService] 成功获取token: ${token.substring(0, 20)}...`);
      
      const matchCount = payload.metadata?.matchCount || 1;
      const ruleName = payload.metadata?.ruleName || '';
      
      // 百度智能外呼平台实时调用接口 (v3版本)
      // 根据截图更新为最新的API接口
      const callUrl = 'https://aiob-open.baidu.com/api/v3/console/realtime/status/create';
      console.log(`[BaiduCallingService] 调用外呼API: ${callUrl}`);
      
      // 按照百度API文档格式构建请求参数
      const callParams = {
        accessToken: token,  // 使用accessToken作为参数名，与获取到的字段名一致
        robotId: this.robotId,
        mobile: phoneNumber,               // 被叫号码
        callerNum: [this.callerNum],       // 主叫号码，使用数组形式
        secretType: 2,                     // 号码加密类型：2表示明文
        stopDate: new Date(Date.now() + 86400000).toISOString().split('T').join(' ').substring(0, 19), // 24小时后结束
        dialogVar: {                       // 对话变量，用于模板替换
          "MatchedTweetsCount": matchCount.toString(),
          "RuleName": ruleName
        }
      };
      
      console.log('[BaiduCallingService] 发送外呼请求:', JSON.stringify(callParams, null, 2));
      
      const response = await axios.post(
        callUrl,
        callParams,
        {
          headers: {
            'Content-Type': 'application/json'
          }
        }
      );
      
      console.log('[BaiduCallingService] 外呼响应:', JSON.stringify(response.data, null, 2));
      
      // 根据百度文档，成功响应code为200
      if (response.data.code !== 200) {
        throw new Error(`呼叫失败: ${response.data.msg || '未知错误'}`);
      }
      
      // 获取返回的ID信息
      const responseData = response.data.data;
      console.info(`[BaiduCallingService] 成功呼叫用户 ${phoneNumber}，响应数据:`, responseData);
    } catch (error: any) {
      console.error('[BaiduCallingService] 百度智能外呼失败');
      
      // 增加详细错误日志
      if (error.response) {
        console.error('[BaiduCallingService] 错误状态码:', error.response.status);
        console.error('[BaiduCallingService] 错误详情:', JSON.stringify(error.response.data, null, 2));
      } else if (error.request) {
        console.error('[BaiduCallingService] 请求已发送但未收到响应');
      } else {
        console.error('[BaiduCallingService] 错误:', error.message);
      }
      
      throw error;
    }
  }
} 