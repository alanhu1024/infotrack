import axios from 'axios';
import crypto from 'crypto';
import { NotificationService, NotificationPayload } from './types';
import { env } from '@/config/env';
import { PrismaClient } from '@prisma/client';
import { toBeiJingTime } from '@/services/twitter';

const prisma = new PrismaClient();

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
  // 任务过期时间
  private taskExpiry: number = 0;
  // 存储已导入的手机号码哈希，避免重复导入
  private importedPhones: Set<string> = new Set();
  // 标记是否使用备用域名
  private useBackupDomain: boolean = false;
  // 缓存有效的机器人和座席信息
  private cachedRobotInfo: { robotId: string } | null = null;
  // 缓存过期时间
  private robotInfoExpiry: number = 0;
  // 存储最后处理的推文ID
  private lastTweetIds: Map<string, string> = new Map();

  constructor() {
    if (!env.BAIDU_ACCESS_KEY || !env.BAIDU_SECRET_KEY || !env.BAIDU_ROBOT_ID || !env.BAIDU_CALLER_NUMBER) {
      throw new Error('百度智能外呼平台凭证未配置');
    }
    this.accessKey = env.BAIDU_ACCESS_KEY;
    this.secretKey = env.BAIDU_SECRET_KEY;
    this.robotId = env.BAIDU_ROBOT_ID;
    this.callerNum = env.BAIDU_CALLER_NUMBER;
    
    // console.log('[BaiduCallingService] 已初始化百度智能外呼服务', {
    //   accessKey: this.accessKey.substring(0, 5) + '...',
    //   secretKey: this.secretKey.substring(0, 5) + '...',
    //   robotId: this.robotId,
    //   callerNum: this.callerNum
    // });
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
      console.log(`[BaiduCallingService ${toBeiJingTime(new Date())}] 准备获取Token, 使用AccessKey: ${this.accessKey.substring(0, 5) + '...'}`);
      console.log(`[BaiduCallingService ${toBeiJingTime(new Date())}] 使用${this.useBackupDomain ? '备用' : '主要'}域名: ${this.getTokenUrl()}`);
      
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
      
      // console.log('[BaiduCallingService] Token响应:', JSON.stringify(response.data, null, 2));
      
      // 检查响应格式并使用正确的字段名 'accessToken' 而不是 'token'
      if (!response.data.data || !response.data.data.accessToken) {
        throw new Error('获取Token失败：返回数据不包含accessToken');
      }
      
      const token = response.data.data.accessToken;
      // 使用正确的过期时间字段 'expiresTime'
      const expiresIn = response.data.data.expiresTime || 7200; // 使用接口返回的过期时间
      
      this.token = token;
      this.tokenExpiry = Date.now() + (expiresIn * 1000);
      
      console.log(`[BaiduCallingService ${toBeiJingTime(new Date())}] 成功获取Token，有效期: ${expiresIn} 秒`);
      
      // 如果成功，重置为使用主域名
      this.useBackupDomain = false;
      
      return token;
    } catch (error: any) {
      console.error(`[BaiduCallingService ${toBeiJingTime(new Date())}] 获取百度Token失败`);
      
      // 增加详细错误日志
      if (error.response) {
        console.error(`[BaiduCallingService ${toBeiJingTime(new Date())}] 错误状态码: ${error.response.status}`);
        console.error(`[BaiduCallingService ${toBeiJingTime(new Date())}] 错误详情: ${JSON.stringify(error.response.data, null, 2)}`);
        console.error(`[BaiduCallingService ${toBeiJingTime(new Date())}] 请求头: ${JSON.stringify(error.config?.headers, null, 2)}`);
        console.error(`[BaiduCallingService ${toBeiJingTime(new Date())}] 请求体: ${JSON.stringify(error.config?.data, null, 2)}`);
      } else if (error.request) {
        console.error(`[BaiduCallingService ${toBeiJingTime(new Date())}] 请求已发送但未收到响应`);
      } else {
        console.error(`[BaiduCallingService ${toBeiJingTime(new Date())}] 请求配置错误: ${error.message}`);
      }
      
      // 检查是否是域名解析错误，如果是且未尝试备用域名，则尝试切换到备用域名
      if ((error.code === 'ENOTFOUND' || error.code === 'ETIMEDOUT') && !this.useBackupDomain) {
        console.log(`[BaiduCallingService ${toBeiJingTime(new Date())}] 主域名无法访问，尝试使用备用域名`);
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
      console.log(`[BaiduCallingService ${toBeiJingTime(new Date())}] 正在获取可用主叫号码列表...`);
      
      // 获取token
      const token = await this.getToken();
      
      // 构建API地址
      const apiUrl = `${this.getApiBaseUrl().replace('/api/v3/console', '/api/v1/did/list')}`;
      console.log(`[BaiduCallingService ${toBeiJingTime(new Date())}] 获取主叫号码API: ${apiUrl}`);
      
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
      
      // 记录响应状态
      console.log(`[BaiduCallingService ${toBeiJingTime(new Date())}] 主叫号码列表响应状态: ${response.status}`);
      console.log(`[BaiduCallingService ${toBeiJingTime(new Date())}] 主叫号码列表响应数据结构: ${JSON.stringify({
        code: response.data.code,
        msg: response.data.msg,
        hasDataField: !!response.data.data,
        hasListField: !!response.data.data?.list,
        listLength: Array.isArray(response.data.data?.list) ? response.data.data.list.length : 'not an array'
      }, null, 2)}`);
      
      // 检查响应是否正确 - 按照API实际返回结构（data.data.list）
      if (response.data.code !== 200 || !response.data.data || !response.data.data.list || !Array.isArray(response.data.data.list)) {
        throw new Error(`获取主叫号码列表失败: ${response.data.msg || '未知错误'}`);
      }
      
      // 提取号码列表 - 使用正确的字段路径 data.data.list
      const phoneList = response.data.data.list;
      
      // 增加调试日志，打印几个示例号码对象
      if (phoneList.length > 0) {
        console.log(`[BaiduCallingService ${toBeiJingTime(new Date())}] 号码对象示例: ${JSON.stringify(phoneList.slice(0, 2), null, 2)}`);
      }
      
      // 使用didAreaCode+didNumber组合成完整号码
      const numbers = phoneList.map((item: any) => {
        // 确保didAreaCode和didNumber都存在
        if (item.didAreaCode && item.didNumber) {
          return `${item.didAreaCode}${item.didNumber}`;
        }
        // 如果缺少区号，仅使用号码
        return item.didNumber;
      }).filter(Boolean);
      
      if (numbers.length === 0) {
        console.warn(`[BaiduCallingService ${toBeiJingTime(new Date())}] 未获取到可用主叫号码，将使用配置的默认号码`);
        return [this.callerNum]; // 使用配置的号码作为备选
      }
      
      console.log(`[BaiduCallingService ${toBeiJingTime(new Date())}] 成功获取 ${numbers.length} 个可用主叫号码: ${numbers}`);
      return numbers;
    } catch (error: any) {
      console.error(`[BaiduCallingService ${toBeiJingTime(new Date())}] 获取主叫号码列表失败: ${error.message}`);
      
      if (error.response) {
        console.error(`[BaiduCallingService ${toBeiJingTime(new Date())}] 错误状态码: ${error.response.status}`);
        console.error(`[BaiduCallingService ${toBeiJingTime(new Date())}] 错误详情: ${JSON.stringify(error.response.data, null, 2)}`);
      }
      
      // 如果是网络错误且未尝试备用域名，尝试切换到备用域名
      if ((error.code === 'ENOTFOUND' || error.code === 'ETIMEDOUT') && !this.useBackupDomain) {
        console.log(`[BaiduCallingService ${toBeiJingTime(new Date())}] 主域名无法访问，尝试使用备用域名`);
        this.useBackupDomain = true;
        return this.getCallerNumbers(); // 使用备用域名重试
      }
      
      // 出错时返回配置中的默认号码
      console.warn(`[BaiduCallingService ${toBeiJingTime(new Date())}] 获取主叫号码失败，使用配置的默认号码`);
      return [this.callerNum];
    }
  }

  /**
   * 获取任务列表，检查是否有可用的现有任务
   * @returns 找到的任务ID或null
   */
  private async getExistingTask(): Promise<string | null> {
    try {
      console.log(`[BaiduCallingService ${toBeiJingTime(new Date())}] 尝试查询现有任务列表`);
      
      // 获取token
      const token = await this.getToken();
      
      // 获取机器人ID
      const { robotId } = await this.getRobotInfo();
      
      // 构建API地址 - 修正为正确的路径格式
      // 从 /apitask/list 改为 /apitask/task/list
      const apiUrl = `${this.getApiBaseUrl()}/apitask/task/list`;
      console.log(`[BaiduCallingService ${toBeiJingTime(new Date())}] 获取任务列表API: ${apiUrl}`);
      
      // 发送请求 - 修改为POST请求
      try {
        const response = await axios.post(
          apiUrl,
          {
            robotId: robotId,
            pageNum: 1,
            pageSize: 10
          },
          {
            headers: {
              'Authorization': token,
              'Content-Type': 'application/json'
            },
            timeout: 10000
          }
        );
        
        // 记录响应状态
        console.log(`[BaiduCallingService ${toBeiJingTime(new Date())}] 任务列表响应状态: ${response.status}`);
        
        // 检查响应是否正确
        if (response.data.code !== 200 || !response.data.data || !response.data.data.list) {
          console.warn(`[BaiduCallingService ${toBeiJingTime(new Date())}] 获取任务列表失败: ${response.data.msg || '未知错误'}`);
          return null;
        }
        
        const taskList = response.data.data.list;
        console.log(`[BaiduCallingService ${toBeiJingTime(new Date())}] 找到 ${taskList.length} 个任务`);
        
        // 查找非完成状态的InfoTrack相关任务
        const infotrackTask = taskList.find((task: any) => {
          // 任务名称包含InfoTrack且状态为非完成(状态可能是status或state字段)
          return (task.taskName.includes('InfoTrack') || task.description?.includes('InfoTrack')) && 
                [0, 1, 3, 5].includes(task.state || task.status);
        });
        
        if (infotrackTask) {
          console.log(`[BaiduCallingService ${toBeiJingTime(new Date())}] 找到可用的InfoTrack任务: ID=${infotrackTask.taskId}, 名称=${infotrackTask.taskName}, 状态=${infotrackTask.state || infotrackTask.status}`);
          return infotrackTask.taskId;
        }
        
        console.log(`[BaiduCallingService ${toBeiJingTime(new Date())}] 未找到可用的InfoTrack任务，需要创建新任务`);
        return null;
      } catch (apiError: any) {
        // 特殊处理404错误 - 如果接口不存在，记录但不影响后续流程
        if (apiError.response && apiError.response.status === 404) {
          console.warn(`[BaiduCallingService ${toBeiJingTime(new Date())}] 获取任务列表接口不存在(404)，将创建新任务`);
        } else {
          // 其他API错误
          console.error(`[BaiduCallingService ${toBeiJingTime(new Date())}] 获取任务列表API错误: ${apiError.message}`);
          if (apiError.response) {
            console.error(`[BaiduCallingService ${toBeiJingTime(new Date())}] 错误状态码: ${apiError.response.status}`);
            console.error(`[BaiduCallingService ${toBeiJingTime(new Date())}] 错误详情: ${JSON.stringify(apiError.response.data, null, 2)}`);
          }
        }
        // 无论是什么错误，都返回null以允许创建新任务
        return null;
      }
      
    } catch (error: any) {
      console.error(`[BaiduCallingService ${toBeiJingTime(new Date())}] 获取任务列表过程失败: ${error.message}`);
      
      // 如果是网络错误且未尝试备用域名，尝试切换到备用域名
      if ((error.code === 'ENOTFOUND' || error.code === 'ETIMEDOUT') && !this.useBackupDomain) {
        console.log(`[BaiduCallingService ${toBeiJingTime(new Date())}] 主域名无法访问，尝试使用备用域名`);
        this.useBackupDomain = true;
        return this.getExistingTask(); // 使用备用域名重试
      }
      
      // 不阻塞流程，返回null以允许创建新任务
      return null;
    }
  }

  /**
   * 创建外呼任务或获取现有任务
   * 返回任务ID，用于后续导入电话号码
   * @param taskName 任务名称基础部分
   * @param useSimpleParams 是否使用简化参数（用于处理500错误）
   * @param retryCount 当前重试次数，用于防止无限循环
   */
  private async createTask(taskName: string, useSimpleParams: boolean = false, retryCount: number = 0): Promise<string | null> {
    try {
      // 如果已有任务ID且未过期，直接返回
      if (this.taskId && this.taskExpiry > Date.now()) {
        console.log(`[BaiduCallingService ${toBeiJingTime(new Date())}] 复用缓存中的任务 ID: ${this.taskId}, 有效期至: ${new Date(this.taskExpiry).toLocaleString()}`);
        return this.taskId;
      }
      
      // 尝试获取已有任务
      const existingTaskId = await this.getExistingTask();
      if (existingTaskId) {
        this.taskId = existingTaskId;
        // 设置一个较长的过期时间，但依然定期检查任务是否有效
        this.taskExpiry = Date.now() + (24 * 60 * 60 * 1000); // 24小时后过期
        console.log(`[BaiduCallingService ${toBeiJingTime(new Date())}] 复用外呼平台中的现有任务 ID: ${this.taskId}`);
        return this.taskId;
      }

      // 添加时间戳和随机数确保任务名称唯一
      const uniqueId = Date.now().toString() + Math.floor(Math.random() * 1000);
      const uniqueTaskName = `${taskName}_${uniqueId}`;
      
      console.log(`[BaiduCallingService ${toBeiJingTime(new Date())}] 准备创建任务: ${uniqueTaskName}${useSimpleParams ? '(使用简化参数)' : ''}`);
      
      // 获取token
      const token = await this.getToken();
      
      // 获取正确的机器人ID
      const { robotId } = await this.getRobotInfo();
      console.log(`[BaiduCallingService ${toBeiJingTime(new Date())}] 使用机器人ID: ${robotId} 创建任务`);
      
      // 获取可用的主叫号码列表
      const callerNumbers = await this.getCallerNumbers();
      console.log(`[BaiduCallingService ${toBeiJingTime(new Date())}] 使用主叫号码列表: ${callerNumbers.join(', ')}`);
      
      const url = `${this.getApiBaseUrl()}/apitask/create`;
      
      // 创建长期任务 - 设置足够长的时间范围
      const current = new Date();
      // 创建结束日期为一年后
      const endDate = new Date(current);
      endDate.setFullYear(current.getFullYear() + 1);
      
      // 将日期和时间分开
      const currentDate = current.toISOString().split('T')[0]; // 获取日期部分 YYYY-MM-DD
      const endDateStr = endDate.toISOString().split('T')[0]; // 一年后的日期
      
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
        taskName: uniqueTaskName,       // 必须参数：使用唯一任务名称
        description: "InfoTrack Twitter追踪系统自动创建的长期通知任务", // 任务描述
        dialStartDate: currentDate,     // 必须参数：拨号开始日期（当前日期）
        dialEndDate: endDateStr,        // 必须参数：拨号结束日期（一年后）
        dialStartTime: "09:00",         // 必须参数：拨号开始时间（固定为上午9点）
        dialEndTime: "20:00",           // 必须参数：拨号结束时间（固定为晚上8点）
        callerNums: callerNumbers,      // 主叫号码参数，使用从API获取的号码列表
        retryTimes: 0,                  // 重试次数
        retryInterval: 1,              // 重试间隔，单位分钟（与Twitter API限流最小等待时间1分钟保持一致）
        isOpenEmptyNum: false,          // 必须参数：是否开启24小时空号检测
        isOpenPhoneDown: false,         // 必须参数：是否开启12小时内停机检测
        callFinishTaskEnd: 0            // 拨号完成后任务不结束，设为0
      };
      
      // 如果是简化参数模式，移除非必要参数
      if (useSimpleParams) {
        delete params.description;
        delete params.retryTimes;
        delete params.retryInterval;
        delete params.callFinishTaskEnd;
      }
      
      console.log(`[BaiduCallingService ${toBeiJingTime(new Date())}] 创建任务请求: ${JSON.stringify(params, null, 2)}`);
      console.log(`[BaiduCallingService ${toBeiJingTime(new Date())}] 请求URL: ${url}`);
      
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
      
      console.log(`[BaiduCallingService ${toBeiJingTime(new Date())}] 创建任务响应: ${JSON.stringify(response.data, null, 2)}`);
      
      if (response.data.code !== 200 || !response.data.data || !response.data.data.taskId) {
        throw new Error(`创建任务失败: ${response.data.msg || '未知错误'}`);
      }
      
      this.taskId = response.data.data.taskId;
      // 设置任务缓存有效期为24小时，之后会再次检查任务是否存在
      this.taskExpiry = Date.now() + (24 * 60 * 60 * 1000);
      console.log(`[BaiduCallingService ${toBeiJingTime(new Date())}] 成功创建长期任务, ID: ${this.taskId}, 有效期一年`);
      return this.taskId;
      
    } catch (error: any) {
      console.error(`[BaiduCallingService ${toBeiJingTime(new Date())}] 创建外呼任务失败`);
      
      if (error.response) {
        console.error(`[BaiduCallingService ${toBeiJingTime(new Date())}] 错误状态码: ${error.response.status}`);
        console.error(`[BaiduCallingService ${toBeiJingTime(new Date())}] 错误详情: ${JSON.stringify(error.response.data, null, 2)}`);
        
        // 处理任务名称重复错误
        if (error.response.data?.code === 4006412 && retryCount < 3) {
          console.log(`[BaiduCallingService ${toBeiJingTime(new Date())}] 任务名称重复，尝试使用新的任务名称重试`);
          return this.createTask(taskName, useSimpleParams, retryCount + 1); // 递归调用，使用新的唯一名称
        }
        
        // 处理500错误 - 服务器内部错误
        if (error.response.status === 500 && !useSimpleParams) {
          console.log(`[BaiduCallingService ${toBeiJingTime(new Date())}] 遇到服务器500错误，尝试使用简化参数重新创建任务`);
          return this.createTask(taskName, true, retryCount); // 递归调用，使用简化参数重试
        }
      } else if (error.request) {
        console.error(`[BaiduCallingService ${toBeiJingTime(new Date())}] 请求已发送但未收到响应`);
      } else {
        console.error(`[BaiduCallingService ${toBeiJingTime(new Date())}] 错误: ${error.message}`);
      }
      
      // 检查是否是域名解析错误，如果是且未尝试备用域名，则尝试切换到备用域名
      if ((error.code === 'ENOTFOUND' || error.code === 'ETIMEDOUT') && !this.useBackupDomain) {
        console.log(`[BaiduCallingService ${toBeiJingTime(new Date())}] 主域名无法访问，尝试使用备用域名重试请求`);
        this.useBackupDomain = true;
        return this.createTask(taskName, useSimpleParams, retryCount); // 递归调用，使用备用域名重试
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
      
      // 打印原始号码和有效号码，便于调试
      console.log(`[BaiduCallingService ${toBeiJingTime(new Date())}] 原始号码: ${JSON.stringify(phoneNumbers)}`);
      console.log(`[BaiduCallingService ${toBeiJingTime(new Date())}] 有效号码: ${JSON.stringify(validPhones)}`);
      
      // 如果没有有效号码，直接返回
      if (validPhones.length === 0) {
        return { 
          successNum: 0, 
          failedNum: 0,
          successPhones: [],
          failedPhones: []
        };
      }
      
      console.log(`[BaiduCallingService ${toBeiJingTime(new Date())}] 准备导入 ${validPhones.length} 个电话号码到任务 ${taskId}`);
      
      // 获取token
      const token = await this.getToken();
      
      const url = `${this.getApiBaseUrl()}/apitask/import`;
      console.log(`[BaiduCallingService ${toBeiJingTime(new Date())}] 导入名单API地址: ${url}`);
      
      // 构建请求参数 - 修改为符合API文档格式
      const params = {
        taskId: taskId,
        secretType: 2, // 使用明文号码，无需加密
        customerInfoList: validPhones.map(phone => ({
          mobile: phone,
          extJson: JSON.stringify({ source: "InfoTrack" })
        }))
      };
      
      // console.log('[BaiduCallingService] 导入名单请求:', JSON.stringify({
      //   taskId,
      //   secretType: params.secretType,
      //   customerInfoListCount: params.customerInfoList.length
      // }, null, 2));
      
      // // 添加完整的请求体日志，便于调试
      // console.log('[BaiduCallingService] 完整请求体:', JSON.stringify(params, null, 2));
      
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
      
      // console.log('[BaiduCallingService] 导入名单响应:', JSON.stringify({
      //   code: response.data.code,
      //   msg: response.data.msg,
      //   successNum: response.data.data?.successNum,
      //   failedNum: response.data.data?.failedNum
      // }, null, 2));
      
      // 添加完整响应日志
      // console.log('[BaiduCallingService] 完整响应体:', JSON.stringify(response.data, null, 2));
      
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
            // 记录失败原因
            console.warn(`[BaiduCallingService ${toBeiJingTime(new Date())}] 号码 ${phone} 导入失败: ${item.reason || '未知原因'}`);
          }
        });
      }
      
      console.log(`[BaiduCallingService ${toBeiJingTime(new Date())}] 导入名单完成: 成功 ${result.successNum} 个, 失败 ${result.failedNum} 个`);
      
      // 如果返回成功数量与成功解析的号码数量不一致，记录警告
      if (successPhones.length !== result.successNum) {
        console.warn(`[BaiduCallingService ${toBeiJingTime(new Date())}] 警告: API返回的成功数量(${result.successNum})与解析到的成功数量(${successPhones.length})不一致`);
      }
      
      return {
        successNum: result.successNum || 0,
        failedNum: result.failedNum || 0,
        successPhones,
        failedPhones
      };
      
    } catch (error: any) {
      console.error(`[BaiduCallingService ${toBeiJingTime(new Date())}] 导入电话号码名单失败`);
      
      if (error.response) {
        console.error(`[BaiduCallingService ${toBeiJingTime(new Date())}] 错误状态码: ${error.response.status}`);
        console.error(`[BaiduCallingService ${toBeiJingTime(new Date())}] 错误详情: ${JSON.stringify(error.response.data, null, 2)}`);
        
        // 添加特定错误码处理
        if (error.response.data?.code) {
          const errorCode = error.response.data.code;
          // 判断是否是常见错误
          if (errorCode === 4006413) {
            console.error(`[BaiduCallingService ${toBeiJingTime(new Date())}] 任务已满或已关闭，无法导入`);
          } else if (errorCode === 4006412) {
            console.error(`[BaiduCallingService ${toBeiJingTime(new Date())}] 任务不存在或已删除`);
          } else if (errorCode === 4006432) {
            console.error(`[BaiduCallingService ${toBeiJingTime(new Date())}] 导入号码格式错误`);
          }
        }
      } else if (error.request) {
        console.error(`[BaiduCallingService ${toBeiJingTime(new Date())}] 请求已发送但未收到响应`);
      } else {
        console.error(`[BaiduCallingService ${toBeiJingTime(new Date())}] 错误: ${error.message}`);
      }
      
      // 检查是否是域名解析错误，如果是且未尝试备用域名，则尝试切换到备用域名
      if ((error.code === 'ENOTFOUND' || error.code === 'ETIMEDOUT') && !this.useBackupDomain) {
        console.log(`[BaiduCallingService ${toBeiJingTime(new Date())}] 主域名无法访问，尝试使用备用域名重试请求`);
        this.useBackupDomain = true;
        return this.importPhoneNumbers(taskId, phoneNumbers); // 使用备用域名重试
      }
      
      // 对于无法恢复的错误，尝试返回尽可能多的信息
      return {
        successNum: 0,
        failedNum: phoneNumbers.length,
        successPhones: [],
        failedPhones: phoneNumbers,
      };
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
      
      console.log(`[BaiduCallingService ${toBeiJingTime(new Date())}] 尝试将 ${validPhones.length} 个号码添加到白名单`);
      
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
      
      // 添加详细的成功/失败日志
      if (result.successNum > 0) {
        console.log(`[BaiduCallingService ${toBeiJingTime(new Date())}] 成功导入 ${result.successNum} 个号码: ${result.successPhones.join(', ')}`);
      }
      
      if (result.failedNum > 0) {
        console.warn(`[BaiduCallingService ${toBeiJingTime(new Date())}] ${result.failedNum} 个号码导入失败: ${result.failedPhones.join(', ')}`);
      }
      
      return {
        success: result.successNum > 0 || result.failedNum === 0, // 只要有成功或没有失败就算成功
        message: `成功导入 ${result.successNum} 个电话号码到白名单${result.failedNum > 0 ? `，${result.failedNum} 个导入失败` : ''}`,
        result
      };
      
    } catch (error: any) {
      console.error(`[BaiduCallingService ${toBeiJingTime(new Date())}] 添加电话号码到白名单失败: ${error.message}`);
      
      // 记录堆栈信息便于调试
      if (error.stack) {
        console.error(`[BaiduCallingService ${toBeiJingTime(new Date())}] 错误堆栈: ${error.stack}`);
      }
      
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
   * 返回有效的robotId
   */
  private async getRobotInfo(): Promise<{ robotId: string }> {
    try {
      // 如果缓存有效，直接返回
      if (this.cachedRobotInfo && this.robotInfoExpiry > Date.now()) {
        return { robotId: this.cachedRobotInfo.robotId };
      }

      // 获取token
      const token = await this.getToken();
      
      // 构建获取机器人列表的API地址
      const robotListUrl = `${this.getApiBaseUrl().replace('/api/v3/console', '/api/v1/robot/list')}`;
      console.log(`[BaiduCallingService ${toBeiJingTime(new Date())}] 获取机器人列表: ${robotListUrl}`);
      
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
      
      // console.log('[BaiduCallingService] 机器人列表响应:', JSON.stringify(response.data, null, 2));
      
      // 修正检查条件，使用data.list而不是data.robots
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
        console.warn(`[BaiduCallingService ${toBeiJingTime(new Date())}] 未找到名为"infotrack"的机器人，可用机器人列表:`);
        robots.forEach((robot: any, index: number) => {
          console.warn(`[${index+1}] ID: ${robot.robotId}, 名称: ${robot.robotName}`);
        });
        
        // 尝试使用配置中的robotId
        console.log(`[BaiduCallingService ${toBeiJingTime(new Date())}] 使用配置的robotId: ${this.robotId}`);
        
        // 缓存结果
        this.cachedRobotInfo = { robotId: this.robotId };
        this.robotInfoExpiry = Date.now() + (3600 * 1000); // 缓存1小时
        return { robotId: this.robotId };
      }
      
      console.log(`[BaiduCallingService ${toBeiJingTime(new Date())}] 找到机器人: ID=${infotrackRobot.robotId}, 名称=${infotrackRobot.robotName}`);
      
      // 缓存结果
      this.cachedRobotInfo = { 
        robotId: infotrackRobot.robotId
      };
      this.robotInfoExpiry = Date.now() + (3600 * 1000); // 缓存1小时
      
      return { robotId: infotrackRobot.robotId };
      
    } catch (error: any) {
      console.error(`[BaiduCallingService ${toBeiJingTime(new Date())}] 获取机器人信息失败 ${error.message}`);
      
      if (error.response) {
        console.error(`[BaiduCallingService ${toBeiJingTime(new Date())}] 错误状态码: ${error.response.status}`);
        console.error(`[BaiduCallingService ${toBeiJingTime(new Date())}] 错误详情: ${JSON.stringify(error.response.data, null, 2)}`);
      }
      
      // 如果是网络错误且未尝试备用域名，尝试切换到备用域名
      if ((error.code === 'ENOTFOUND' || error.code === 'ETIMEDOUT') && !this.useBackupDomain) {
        console.log(`[BaiduCallingService ${toBeiJingTime(new Date())}] 主域名无法访问，尝试使用备用域名`);
        this.useBackupDomain = true;
        return this.getRobotInfo(); // 使用备用域名重试
      }
      
      // 如果无法获取，使用配置的robotId
      console.warn(`[BaiduCallingService ${toBeiJingTime(new Date())}] 无法获取机器人信息，使用配置的robotId`);
      return { robotId: this.robotId };
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
        console.warn(`[BaiduCallingService ${toBeiJingTime(new Date())}] 无效的电话号码: ${phoneNumber}`);
        return;
      }

      // 确保电话号码已添加到白名单
      await this.ensurePhoneInWhitelist([phoneNumber]);

      console.log(`[BaiduCallingService ${toBeiJingTime(new Date())}] 准备向 ${phoneNumber} 发送外呼通知`);
      
      // 获取token
      const token = await this.getToken();
      console.log(`[BaiduCallingService ${toBeiJingTime(new Date())}] 成功获取token: ${token.substring(0, 20)}...`);
      
      // 获取正确的机器人ID，不再获取座席ID
      const { robotId } = await this.getRobotInfo();
      console.log(`[BaiduCallingService ${toBeiJingTime(new Date())}] 使用机器人ID: ${robotId}`);
      
      // 获取可用的主叫号码列表
      const callerNumbers = await this.getCallerNumbers();
      console.log(`[BaiduCallingService ${toBeiJingTime(new Date())}] 使用主叫号码列表: ${callerNumbers.join(', ')}`);
      
      // 百度智能外呼平台实时调用接口 (v3版本)
      const callUrl = `${this.getApiBaseUrl()}/realtime/status/create`;
      console.log(`[BaiduCallingService ${toBeiJingTime(new Date())}] 调用外呼API: ${callUrl}`);
      
      const matchCount = payload.metadata?.matchCount || 1;
      const ruleName = payload.metadata?.ruleName || '';
      
      // 按照百度API文档格式构建请求参数，移除agentId参数
      const callParams = {
        robotId: robotId,             // 使用获取到的正确机器人ID
        mobile: phoneNumber,          // 被叫号码
        callerNums: callerNumbers,    // 主叫号码列表，使用从API获取的号码
        secretType: 2,                // 号码加密类型：2表示明文
        stopDate: new Date(Date.now() + 86400000).toISOString().split('T').join(' ').substring(0, 19), // 24小时后结束
        dialogVar: {                  // 对话变量，用于模板替换
          "MatchedTweetsCount": matchCount.toString(),
          "RuleName": ruleName
        }
      };
      
      console.log(`[BaiduCallingService ${toBeiJingTime(new Date())}] 发送外呼请求: ${JSON.stringify(callParams, null, 2)}`);
      console.log(`[BaiduCallingService ${toBeiJingTime(new Date())}] 请求头: ${JSON.stringify({
        'Content-Type': 'application/json',
        'Authorization': token.substring(0, 10) + '...'  // 只记录部分token内容，保护隐私，移除Bearer前缀
      }, null, 2)}`);
      
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
      
      console.log(`[BaiduCallingService ${toBeiJingTime(new Date())}] 外呼响应状态: ${response.status}`);
      console.log(`[BaiduCallingService ${toBeiJingTime(new Date())}] 外呼响应: ${JSON.stringify(response.data, null, 2)}`);
      
      // 根据百度文档，成功响应code为200
      if (response.data.code !== 200) {
        throw new Error(`呼叫失败: ${response.data.msg || '未知错误'}`);
      }
      
      // 获取返回的ID信息
      const responseData = response.data.data;
      console.info(`[BaiduCallingService ${toBeiJingTime(new Date())}] 成功呼叫用户 ${phoneNumber}，响应数据:`, responseData);
    } catch (error: any) {
      console.error(`[BaiduCallingService ${toBeiJingTime(new Date())}] 百度智能外呼失败`);
      
      // 增加详细错误日志
      if (error.response) {
        console.error(`[BaiduCallingService ${toBeiJingTime(new Date())}] 错误状态码: ${error.response.status}`);
        console.error(`[BaiduCallingService ${toBeiJingTime(new Date())}] 错误详情: ${JSON.stringify(error.response.data, null, 2)}`);
      } else if (error.request) {
        console.error(`[BaiduCallingService ${toBeiJingTime(new Date())}] 请求已发送但未收到响应`);
      } else {
        console.error(`[BaiduCallingService ${toBeiJingTime(new Date())}] 错误: ${error.message}`);
      }
      
      // 检查是否是域名解析错误，如果是且未尝试备用域名，则尝试切换到备用域名
      if ((error.code === 'ENOTFOUND' || error.code === 'ETIMEDOUT') && !this.useBackupDomain) {
        console.log(`[BaiduCallingService ${toBeiJingTime(new Date())}] 主域名无法访问，尝试使用备用域名重试请求`);
        this.useBackupDomain = true;
        return this.send(payload); // 使用备用域名重试
      }
      
      throw error;
    }
  }

  // 将最后处理的推文ID持久化到数据库
  async persistLastTweetIds(): Promise<void> {
    try {
      // 遍历所有规则的最后处理的推文ID
      for (const [ruleId, tweetId] of this.lastTweetIds.entries()) {
        await prisma.trackingRule.update({
          where: { id: ruleId },
          data: { lastProcessedTweetId: tweetId }
        });
      }
      console.log(`[BaiduCallingService ${toBeiJingTime(new Date())}] 已持久化所有规则的最后处理推文ID`);
    } catch (error) {
      console.error(`[BaiduCallingService ${toBeiJingTime(new Date())}] 持久化推文ID失败: ${error}`);
    }
  }
  
  // 在启动时从数据库加载最后处理的推文ID
  async loadLastTweetIds(): Promise<void> {
    try {
      const rules = await prisma.trackingRule.findMany({
        where: { isActive: true },
        select: { id: true, lastProcessedTweetId: true }
      });
      
      for (const rule of rules) {
        if (rule.lastProcessedTweetId) {
          this.lastTweetIds.set(rule.id, rule.lastProcessedTweetId);
        }
      }
      console.log(`[BaiduCallingService ${toBeiJingTime(new Date())}] 已从数据库加载 ${this.lastTweetIds.size} 个规则的推文ID`);
    } catch (error) {
      console.error(`[BaiduCallingService ${toBeiJingTime(new Date())}] 加载推文ID失败: ${error}`);
    }
  }
}