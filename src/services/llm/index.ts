import { OpenAIService } from './openai';
import { AliService } from './ali';
import { LLMService } from './types';

export function createLLMService(): LLMService {
  const provider = process.env.LLM_PROVIDER || 'openai';
  switch (provider) {
    case 'openai':
      return new OpenAIService();
    case 'ali':
      return new AliService(process.env.ALI_API_KEY || '');
    // 你可以继续扩展其他厂商
    default:
      throw new Error('未配置大模型服务商');
  }
} 