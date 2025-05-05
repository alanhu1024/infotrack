import { LLMService } from './types';
import { OpenAI } from 'openai';
import { env } from '@/config/env';

export class OpenAIService implements LLMService {
  private client: OpenAI;

  constructor(apiKey?: string) {
    this.client = new OpenAI({ apiKey: apiKey || env.OPENAI_API_KEY });
  }

  async analyzeTextRelevance(text: string, criteria: string) {
    const prompt = `\n分析以下推文与给定标准的相关性：\n\n推文内容：\n${text}\n\n筛选标准：\n${criteria}\n\n请分析推文内容与筛选标准的相关程度，并给出0到1之间的相关性分数。\n格式要求：\n1. 相关性分数（0-1之间的小数）\n2. 分析说明（解释为什么给出这个分数）\n\n只返回 JSON 格式：\n{\n  "score": 0.8,\n  "explanation": "这条推文高度相关，因为..."}`;

    const response = await this.client.chat.completions.create({
      model: 'gpt-4',
      messages: [
        {
          role: 'system',
          content: '你是一个专业的内容分析助手，负责分析推文与给定标准的相关性。',
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
      response_format: { type: 'json_object' },
    });

    const result = JSON.parse(response.choices[0].message.content || '{"score": 0, "explanation": "无法分析"}');

    return {
      relevanceScore: result.score,
      explanation: result.explanation,
    };
  }
} 