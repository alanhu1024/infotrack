import { OpenAI } from 'openai';
import { env } from '@/config/env';

export class AIService {
  private client: OpenAI;

  constructor() {
    this.client = new OpenAI({
      apiKey: env.OPENAI_API_KEY,
    });
  }

  async analyzeTweetRelevance(tweetText: string, criteria: string): Promise<{
    relevanceScore: number;
    explanation: string;
  }> {
    const prompt = `
分析以下推文与给定标准的相关性：

推文内容：
${tweetText}

筛选标准：
${criteria}

请分析推文内容与筛选标准的相关程度，并给出0到1之间的相关性分数。
格式要求：
1. 相关性分数（0-1之间的小数）
2. 分析说明（解释为什么给出这个分数）

只返回 JSON 格式：
{
  "score": 0.8,
  "explanation": "这条推文高度相关，因为..."
}`;

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