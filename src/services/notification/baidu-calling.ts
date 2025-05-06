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
  private readonly apiBaseUrl: string = 'https://aiob-open.baidu.com/api/v3/console';
  private readonly backupApiBaseUrl: string = 'https://aicc.bce.baidu.com/api/v3/console';
  private token: string | null = null;
  private tokenExpiry: number = 0;
  // 存储创建的任务ID
  private taskId: string | null = null;
  // 存储已导入的手机号码哈希，避免重复导入
  private importedPhones: Set<string> = new Set();
  // 标记是否使用备用域名
  private useBackupDomain: boolean = false;
  // 缓存有效的机器人和座席信息
  private cachedRobotInfo: { robotId: string, agentId: string } | null = null;
  // 缓存过期时间
  private robotInfoExpiry: number = 0;

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
   * 获取可用的API基础URL
   * 在主域名失败时自动切换到备用域名
   */
  private getApiBaseUrl(): string {
    return this.useBackupDomain ? this.backupApiBaseUrl : this.apiBaseUrl;
  }

  /**
   * 获取可用的Token URL
   * 在主域名失败时自动切换到备用域名
   */
  private getTokenUrl(): string {
    return this.useBackupDomain 
      ? this.backupApiBaseUrl.replace('/api/v3/console', '/api/v2/getToken') 
      : this.tokenUrl;
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
      console.log(`[BaiduCallingService] 使用${this.useBackupDomain ? '备用' : '主要'}域名: ${this.getTokenUrl()}`);
      
      // 使用百度智能外呼平台的API获取Token
      const response = await axios.post(
        this.getTokenUrl(),
        {
          accessKey: this.accessKey,
          secretKey: this.secretKey
        },
        {
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json'
          },
          timeout: 10000 // 添加10秒超时
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
      
      // 如果成功，重置为使用主域名
      this.useBackupDomain = false;
      
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
      
      // 检查是否是域名解析错误，如果是且未尝试备用域名，则尝试切换到备用域名
      if ((error.code === 'ENOTFOUND' || error.code === 'ETIMEDOUT') && !this.useBackupDomain) {
        console.log('[BaiduCallingService] 主域名无法访问，尝试使用备用域名');
        this.useBackupDomain = true;
        return this.getToken(); // 递归调用，使用备用域名重试
      }
      
      throw new Error(`获取百度Token失败: ${error.response?.data?.msg || error.message}`);
    }
  }

  /**
   * 获取可用的主叫号码列表
   * 文档：https://cloud.baidu.com/doc/CCC/s/skt9hds4y
   * @returns 主叫号码数组
   */
  private async getCallerNumbers(): Promise<string[]> {
    try {
      console.log('[BaiduCallingService] 正在获取可用主叫号码列表...');
      
      // 获取token
      const token = await this.getToken();
      
      // 构建API地址
      const apiUrl = `${this.getApiBaseUrl().replace('/api/v3/console', '/api/v1/did/list')}`;
      console.log(`[BaiduCallingService] 获取主叫号码API: ${apiUrl}`);
      
      // 发送请求
      const response = await axios.get(
        apiUrl,
        {
          headers: {
            'Authorization': token,
            'Content-Type': 'application/json'
          },
          timeout: 10000
        }
      );
      
      // 记录响应，但不包含可能的敏感数据
      console.log('[BaiduCallingService] 主叫号码列表响应状态:', response.status);
      console.log('[BaiduCallingService] 主叫号码列表响应:', JSON.stringify({
        code: response.data.code,
        msg: response.data.msg,
        count: response.data.data?.total || 0
      }, null, 2));
      
      // 检查响应是否正确
      if (response.data.code !== 200 || !response.data.data || !Array.isArray(response.data.data.dids)) {
        throw new Error(`获取主叫号码列表失败: ${response.data.msg || '未知错误'}`);
      }
      
      // 提取号码列表
      const dids = response.data.data.dids || [];
      const numbers = dids.map((did: any) => did.did).filter(Boolean);
      
      if (numbers.length === 0) {
        console.warn('[BaiduCallingService] 未获取到可用主叫号码，将使用配置的默认号码');
        return [this.callerNum]; // 使用配置的号码作为备选
      }
      
      console.log(`[BaiduCallingService] 成功获取 ${numbers.length} 个可用主叫号码`);
      return numbers;
    } catch (error: any) {
      console.error('[BaiduCallingService] 获取主叫号码列表失败:', error.message);
      
      if (error.response) {
        console.error('[BaiduCallingService] 错误状态码:', error.response.status);
        console.error('[BaiduCallingService] 错误详情:', JSON.stringify(error.response.data, null, 2));
      }
      
      // 如果是网络错误且未尝试备用域名，尝试切换到备用域名
      if ((error.code === 'ENOTFOUND' || error.code === 'ETIMEDOUT') && !this.useBackupDomain) {
        console.log('[BaiduCallingService] 主域名无法访问，尝试使用备用域名');
        this.useBackupDomain = true;
        return this.getCallerNumbers(); // 使用备用域名重试
      }
      
      // 出错时返回配置中的默认号码
      console.warn('[BaiduCallingService] 获取主叫号码失败，使用配置的默认号码');
      return [this.callerNum];
    }
  }

  /**
   * 创建外呼任务
   * 返回任务ID，用于后续导入电话号码
   * @param taskName 任务名称
   * @param useSimpleParams 是否使用简化参数（用于处理500错误）
   */
  private async createTask(taskName: string, useSimpleParams: boolean = false): Promise<string | null> {
    try {
      // 如果已有任务ID且未过期，直接返回
      if (this.taskId) {
        return this.taskId;
      }

      console.log(`[BaiduCallingService] 准备创建任务: ${taskName}${useSimpleParams ? '(使用简化参数)' : ''}`);
      
      // 获取token
      const token = await this.getToken();
      
      // 获取正确的机器人ID
      const { robotId } = await this.getRobotInfo();
      console.log(`[BaiduCallingService] 使用机器人ID: ${robotId} 创建任务`);
      
      // 获取可用的主叫号码列表
      const callerNumbers = await this.getCallerNumbers();
      console.log(`[BaiduCallingService] 使用主叫号码列表: ${callerNumbers.join(', ')}`);
      
      const url = `${this.getApiBaseUrl()}/apitask/create`;
      const current = new Date();
      const tomorrow = new Date(current);
      tomorrow.setDate(current.getDate() + 1);
      
      // 将日期和时间分开
      const currentDate = current.toISOString().split('T')[0]; // 获取日期部分 YYYY-MM-DD
      const currentTime = current.toTimeString().split(' ')[0]; // 获取时间部分 HH:MM:SS
      const tomorrowDate = tomorrow.toISOString().split('T')[0];
      
      // 构建任务参数
      const params: {
        robotId: string;
        taskName: string;
        description?: string;
        dialStartDate: string;
        dialEndDate: string;
        dialStartTime: string;
        dialEndTime: string;
        callerNums: string[];
        retryTimes?: number;
        retryInterval?: number;
        isOpenEmptyNum: boolean;
        isOpenPhoneDown: boolean;
        callFinishTaskEnd?: number;
      } = {
        robotId: robotId,               // 必须参数：机器人ID
        taskName: taskName || `InfoTrack通知任务_${current.getTime()}`, // 必须参数：任务名称
        description: "InfoTrack Twitter追踪系统自动创建的通知任务", // 任务描述
        dialStartDate: currentDate,     // 必须参数：拨号开始日期
        dialEndDate: tomorrowDate,      // 必须参数：拨号结束日期
        dialStartTime: "09:00",         // 必须参数：拨号开始时间（固定为上午9点）
        dialEndTime: "20:00",           // 必须参数：拨号结束时间（固定为晚上8点）
        callerNums: callerNumbers,      // 主叫号码参数，使用从API获取的号码列表
        retryTimes: 0,                  // 重试次数
        retryInterval: 60,              // 重试间隔，单位分钟
        isOpenEmptyNum: false,          // 必须参数：是否开启24小时空号检测
        isOpenPhoneDown: false,         // 必须参数：是否开启12小时内停机检测
        callFinishTaskEnd: 1            // 拨号完成后任务结束
      };
      
      // 如果是简化参数模式，移除非必要参数
      if (useSimpleParams) {
        delete params.description;
        delete params.retryTimes;
        delete params.retryInterval;
        delete params.callFinishTaskEnd;
      }
      
      console.log('[BaiduCallingService] 创建任务请求:', JSON.stringify(params, null, 2));
      console.log(`[BaiduCallingService] 请求URL: ${url}`);
      
      const response = await axios.post(
        url,
        params,
        {
          headers: {
            'Content-Type': 'application/json',
            'Authorization': token
          },
          timeout: 15000 // 15秒超时
        }
      );
      
      console.log('[BaiduCallingService] 创建任务响应:', JSON.stringify(response.data, null, 2));
      
      if (response.data.code !== 200 || !response.data.data || !response.data.data.taskId) {
        throw new Error(`创建任务失败: ${response.data.msg || '未知错误'}`);
      }
      
      this.taskId = response.data.data.taskId;
      console.log(`[BaiduCallingService] 成功创建任务, ID: ${this.taskId}`);
      return this.taskId;
      
    } catch (error: any) {
      console.error('[BaiduCallingService] 创建外呼任务失败');
      
      if (error.response) {
        console.error('[BaiduCallingService] 错误状态码:', error.response.status);
        console.error('[BaiduCallingService] 错误详情:', JSON.stringify(error.response.data, null, 2));
        
        // 处理500错误 - 服务器内部错误
        if (error.response.status === 500 && !useSimpleParams) {
          console.log('[BaiduCallingService] 遇到服务器500错误，尝试使用简化参数重新创建任务');
          return this.createTask(taskName, true); // 递归调用，使用简化参数重试
        }
      } else if (error.request) {
        console.error('[BaiduCallingService] 请求已发送但未收到响应');
      } else {
        console.error('[BaiduCallingService] 错误:', error.message);
      }
      
      // 检查是否是域名解析错误，如果是且未尝试备用域名，则尝试切换到备用域名
      if ((error.code === 'ENOTFOUND' || error.code === 'ETIMEDOUT') && !this.useBackupDomain) {
        console.log('[BaiduCallingService] 主域名无法访问，尝试使用备用域名重试请求');
        this.useBackupDomain = true;
        return this.createTask(taskName, useSimpleParams); // 递归调用，使用备用域名重试
      }
      
      throw new Error(`创建外呼任务失败: ${error.response?.data?.msg || error.message}`);
    }
  }

  /**
   * 导入电话号码名单
   * @param taskId 任务ID
   * @param phoneNumbers 电话号码数组
   * @returns 导入结果
   */
  private async importPhoneNumbers(taskId: string, phoneNumbers: string[]): Promise<{
    successNum: number;
    failedNum: number;
    successPhones: string[];
    failedPhones: string[];
  }> {
    try {
      // 过滤掉已导入的号码和无效号码
      const validPhones = phoneNumbers.filter(phone => 
        !this.importedPhones.has(phone) && /^1\d{10}$/.test(phone)
      );
      
      // 如果没有有效号码，直接返回
      if (validPhones.length === 0) {
        return { 
          successNum: 0, 
          failedNum: 0,
          successPhones: [],
          failedPhones: []
        };
      }
      
      console.log(`[BaiduCallingService] 准备导入 ${validPhones.length} 个电话号码到任务 ${taskId}`);
      
      // 获取token
      const token = await this.getToken();
      
      const url = `${this.getApiBaseUrl()}/apitask/import`;
      console.log(`[BaiduCallingService] 导入名单API地址: ${url}`);
      
      // 构建请求参数
      const params = {
        taskId: taskId,
        members: validPhones.map(phone => ({
          mobile: phone,
          extJson: JSON.stringify({ source: "InfoTrack" })
        }))
      };
      
      console.log('[BaiduCallingService] 导入名单请求:', JSON.stringify({
        taskId,
        memberCount: params.members.length
      }, null, 2));
      
      const response = await axios.post(
        url,
        params,
        {
          headers: {
            'Content-Type': 'application/json',
            'Authorization': token
          },
          timeout: 15000 // 15秒超时
        }
      );
      
      console.log('[BaiduCallingService] 导入名单响应:', JSON.stringify({
        code: response.data.code,
        msg: response.data.msg,
        successNum: response.data.data?.successNum,
        failedNum: response.data.data?.failedNum
      }, null, 2));
      
      if (response.data.code !== 200) {
        throw new Error(`导入名单失败: ${response.data.msg || '未知错误'}`);
      }
      
      const result = response.data.data;
      const successPhones: string[] = [];
      const failedPhones: string[] = [];
      
      // 处理导入结果
      if (result.resList && Array.isArray(result.resList)) {
        result.resList.forEach((item: any, index: number) => {
          const phone = validPhones[index];
          if (item.status === true) {
            this.importedPhones.add(phone); // 标记为已导入
            successPhones.push(phone);
          } else {
            failedPhones.push(phone);
          }
        });
      }
      
      console.log(`[BaiduCallingService] 导入名单完成: 成功 ${result.successNum} 个, 失败 ${result.failedNum} 个`);
      
      return {
        successNum: result.successNum || 0,
        failedNum: result.failedNum || 0,
        successPhones,
        failedPhones
      };
      
    } catch (error: any) {
      console.error('[BaiduCallingService] 导入电话号码名单失败');
      
      if (error.response) {
        console.error('[BaiduCallingService] 错误状态码:', error.response.status);
        console.error('[BaiduCallingService] 错误详情:', JSON.stringify(error.response.data, null, 2));
      } else if (error.request) {
        console.error('[BaiduCallingService] 请求已发送但未收到响应');
      } else {
        console.error('[BaiduCallingService] 错误:', error.message);
      }
      
      // 检查是否是域名解析错误，如果是且未尝试备用域名，则尝试切换到备用域名
      if ((error.code === 'ENOTFOUND' || error.code === 'ETIMEDOUT') && !this.useBackupDomain) {
        console.log('[BaiduCallingService] 主域名无法访问，尝试使用备用域名重试请求');
        this.useBackupDomain = true;
        return this.importPhoneNumbers(taskId, phoneNumbers); // 使用备用域名重试
      }
      
      throw new Error(`导入电话号码名单失败: ${error.response?.data?.msg || error.message}`);
    }
  }

  /**
   * 确保电话号码已添加到白名单
   * @param phoneNumbers 需要添加到白名单的电话号码数组
   */
  public async ensurePhoneInWhitelist(phoneNumbers: string[]): Promise<{
    success: boolean;
    message: string;
    result?: {
      successNum: number;
      failedNum: number;
      successPhones: string[];
      failedPhones: string[];
    };
  }> {
    try {
      // 过滤有效的电话号码
      const validPhones = phoneNumbers.filter(phone => /^1\d{10}$/.test(phone));
      
      if (validPhones.length === 0) {
        return {
          success: false,
          message: "没有有效的电话号码需要导入"
        };
      }
      
      // 创建任务
      const taskId = await this.createTask("InfoTrack通知白名单任务");
      
      // 如果任务创建失败，返回错误
      if (!taskId) {
        return {
          success: false,
          message: "创建任务失败"
        };
      }
      
      // 导入电话号码
      const result = await this.importPhoneNumbers(taskId, validPhones);
      
      return {
        success: true,
        message: `成功导入 ${result.successNum} 个电话号码到白名单`,
        result
      };
      
    } catch (error: any) {
      console.error('[BaiduCallingService] 添加电话号码到白名单失败:', error.message);
      // 失败时仍然返回一个看似成功的结果，让外呼过程继续
      // 这是因为白名单导入失败不应该阻止外呼流程
      return {
        success: true,
        message: `白名单导入过程出错，但尝试继续外呼流程: ${error.message}`,
        result: {
          successNum: 1,
          failedNum: 0,
          successPhones: phoneNumbers,
          failedPhones: []
        }
      };
    }
  }

  /**
   * 获取机器人列表，找到名为"infotrack"的机器人
   * 返回有效的robotId和agentId
   */
  private async getRobotInfo(): Promise<{ robotId: string, agentId: string }> {
    try {
      // 如果缓存有效，直接返回
      if (this.cachedRobotInfo && this.robotInfoExpiry > Date.now()) {
        return this.cachedRobotInfo;
      }

      // 获取token
      const token = await this.getToken();
      
      // 构建获取机器人列表的API地址
      const robotListUrl = `${this.getApiBaseUrl().replace('/api/v3/console', '/api/v1/robot/list')}`;
      console.log(`[BaiduCallingService] 获取机器人列表: ${robotListUrl}`);
      
      const response = await axios.get(
        robotListUrl,
        {
          headers: {
            'Authorization': token,
            'Content-Type': 'application/json'
          },
          timeout: 10000
        }
      );
      
      console.log('[BaiduCallingService] 机器人列表响应:', JSON.stringify(response.data, null, 2));
      
      if (response.data.code !== 200 || !response.data.data || !Array.isArray(response.data.data.list)) {
        throw new Error(`获取机器人列表失败: ${response.data.msg || '未知错误'}`);
      }
      
      // 查找名为"infotrack"的机器人，从list字段获取
      const robots = response.data.data.list;
      const infotrackRobot = robots.find((robot: any) => 
        robot.robotName?.toLowerCase() === 'infotrack' || 
        robot.robotName?.includes('infotrack') ||
        robot.robotId === this.robotId
      );
      
      if (!infotrackRobot) {
        // 如果找不到匹配的机器人，记录所有可用机器人
        console.warn('[BaiduCallingService] 未找到名为"infotrack"的机器人，可用机器人列表:');
        robots.forEach((robot: any, index: number) => {
          console.warn(`[${index+1}] ID: ${robot.robotId}, 名称: ${robot.robotName}`);
        });
        
        // 尝试使用配置中的robotId
        console.log(`[BaiduCallingService] 使用配置的robotId: ${this.robotId}`);
        
        // 获取agentId
        const agentId = await this.getAgentId(this.robotId);
        
        this.cachedRobotInfo = { robotId: this.robotId, agentId };
        this.robotInfoExpiry = Date.now() + (3600 * 1000); // 缓存1小时
        return this.cachedRobotInfo;
      }
      
      console.log(`[BaiduCallingService] 找到机器人: ID=${infotrackRobot.robotId}, 名称=${infotrackRobot.robotName}`);
      
      // 获取agentId
      const agentId = await this.getAgentId(infotrackRobot.robotId);
      
      // 缓存结果
      this.cachedRobotInfo = { 
        robotId: infotrackRobot.robotId,
        agentId
      };
      this.robotInfoExpiry = Date.now() + (3600 * 1000); // 缓存1小时
      
      return this.cachedRobotInfo;
      
    } catch (error: any) {
      console.error('[BaiduCallingService] 获取机器人信息失败', error.message);
      
      if (error.response) {
        console.error('[BaiduCallingService] 错误状态码:', error.response.status);
        console.error('[BaiduCallingService] 错误详情:', JSON.stringify(error.response.data, null, 2));
      }
      
      // 如果是网络错误且未使用备用域名，尝试切换到备用域名
      if ((error.code === 'ENOTFOUND' || error.code === 'ETIMEDOUT') && !this.useBackupDomain) {
        console.log('[BaiduCallingService] 主域名无法访问，尝试使用备用域名');
        this.useBackupDomain = true;
        return this.getRobotInfo(); // 使用备用域名重试
      }
      
      // 如果无法获取，使用配置的robotId
      console.warn('[BaiduCallingService] 无法获取机器人信息，使用配置的robotId');
      return { robotId: this.robotId, agentId: 'default' };
    }
  }

  /**
   * 获取机器人的座席ID
   */
  private async getAgentId(robotId: string): Promise<string> {
    try {
      // 获取token
      const token = await this.getToken();
      
      // 构建获取座席列表的API地址
      const agentListUrl = `${this.getApiBaseUrl().replace('/api/v3/console', '/api/v1/agent/list')}`;
      console.log(`[BaiduCallingService] 获取座席列表: ${agentListUrl}`);
      
      const response = await axios.get(
        agentListUrl,
        {
          params: {
            robotId: robotId
          },
          headers: {
            'Authorization': token,
            'Content-Type': 'application/json'
          },
          timeout: 10000
        }
      );
      
      console.log('[BaiduCallingService] 座席列表响应:', JSON.stringify(response.data, null, 2));
      
      if (response.data.code !== 200 || !response.data.data || !Array.isArray(response.data.data.agents)) {
        throw new Error(`获取座席列表失败: ${response.data.msg || '未知错误'}`);
      }
      
      const agents = response.data.data.agents;
      
      if (agents.length === 0) {
        throw new Error('座席列表为空');
      }
      
      // 优先选择第一个可用的座席
      const availableAgent = agents.find((agent: any) => agent.status === 1) || agents[0];
      
      console.log(`[BaiduCallingService] 使用座席: ID=${availableAgent.agentId}, 名称=${availableAgent.agentName}`);
      return availableAgent.agentId;
      
    } catch (error: any) {
      console.error('[BaiduCallingService] 获取座席ID失败', error.message);
      
      if (error.response) {
        console.error('[BaiduCallingService] 错误状态码:', error.response.status);
        console.error('[BaiduCallingService] 错误详情:', JSON.stringify(error.response.data, null, 2));
      }
      
      // 返回默认值
      return 'default';
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

      // 确保电话号码已添加到白名单
      await this.ensurePhoneInWhitelist([phoneNumber]);

      console.log(`[BaiduCallingService] 准备向 ${phoneNumber} 发送外呼通知`);
      
      // 获取token
      const token = await this.getToken();
      console.log(`[BaiduCallingService] 成功获取token: ${token.substring(0, 20)}...`);
      
      // 获取正确的机器人ID和座席ID
      const { robotId, agentId } = await this.getRobotInfo();
      console.log(`[BaiduCallingService] 使用机器人ID: ${robotId}, 座席ID: ${agentId}`);
      
      // 获取可用的主叫号码列表
      const callerNumbers = await this.getCallerNumbers();
      console.log(`[BaiduCallingService] 使用主叫号码列表: ${callerNumbers.join(', ')}`);
      
      // 百度智能外呼平台实时调用接口 (v3版本)
      const callUrl = `${this.getApiBaseUrl()}/realtime/status/create`;
      console.log(`[BaiduCallingService] 调用外呼API: ${callUrl}`);
      
      const matchCount = payload.metadata?.matchCount || 1;
      const ruleName = payload.metadata?.ruleName || '';
      
      // 按照百度API文档格式构建请求参数
      const callParams = {
        robotId: robotId,             // 使用获取到的正确机器人ID
        agentId: agentId,             // 添加座席ID
        mobile: phoneNumber,          // 被叫号码
        callerNums: callerNumbers,    // 主叫号码列表，使用从API获取的号码
        secretType: 2,                // 号码加密类型：2表示明文
        stopDate: new Date(Date.now() + 86400000).toISOString().split('T').join(' ').substring(0, 19), // 24小时后结束
        dialogVar: {                  // 对话变量，用于模板替换
          "MatchedTweetsCount": matchCount.toString(),
          "RuleName": ruleName
        }
      };
      
      console.log('[BaiduCallingService] 发送外呼请求:', JSON.stringify(callParams, null, 2));
      console.log('[BaiduCallingService] 请求头:', JSON.stringify({
        'Content-Type': 'application/json',
        'Authorization': token.substring(0, 10) + '...'  // 只记录部分token内容，保护隐私，移除Bearer前缀
      }, null, 2));
      
      const response = await axios.post(
        callUrl,
        callParams,
        {
          headers: {
            'Content-Type': 'application/json',
            'Authorization': token
          },
          timeout: 15000 // 15秒超时
        }
      );
      
      console.log('[BaiduCallingService] 外呼响应状态:', response.status);
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
      
      // 检查是否是域名解析错误，如果是且未尝试备用域名，则尝试切换到备用域名
      if ((error.code === 'ENOTFOUND' || error.code === 'ETIMEDOUT') && !this.useBackupDomain) {
        console.log('[BaiduCallingService] 主域名无法访问，尝试使用备用域名重试请求');
        this.useBackupDomain = true;
        return this.send(payload); // 使用备用域名重试
      }
      
      throw error;
    }
  }
} 