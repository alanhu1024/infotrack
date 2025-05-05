import { LLMService } from './types';

export class AliService implements LLMService {
  constructor(private apiKey: string) {}

  async analyzeTextRelevance(text: string, criteria: string) {
    const prompt = `请严格按照如下JSON模板输出，不要输出任何多余内容：\n\n{\n  "score": 0.8,\n  "explanation": "这条推文高度相关，因为……"\n}\n\n要求：\n1. 只输出JSON，不要有任何解释、代码块、markdown、前后缀等。\n2. score字段为0~1之间的小数，代表相关性分数。\n3. explanation字段为简要中文说明，解释分数原因。\n\n推文内容：\n${text}\n\n筛选标准：\n${criteria}`;

    let responseText = '';
    try {
      const response = await fetch('https://dashscope.aliyuncs.com/api/v1/services/aigc/text-generation/generation', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: 'qwen-turbo',
          input: { prompt },
        }),
      });

      if (!response.ok) {
        const errText = await response.text();
        console.error('[AliService] API请求失败:', response.status, errText);
        throw new Error(`AliService API error: ${response.status}`);
      }

      const data = await response.json();
      responseText = data.output?.text || data.choices?.[0]?.message?.content || '';
      console.log('[AliService] 大模型原始返回:', responseText);
    } catch (e) {
      console.error('[AliService] fetch请求异常:', e);
      return { relevanceScore: 0, explanation: 'API请求失败' };
    }

    let score = 0;
    let explanation = '无法解析';
    try {
      let jsonStr = responseText.trim();
      const match = jsonStr.match(/\{[\s\S]*\}/);
      if (match) {
        jsonStr = match[0];
      }
      const result = JSON.parse(jsonStr);
      // 分数类型和范围校验
      score = Number(result.score);
      if (isNaN(score) || score < 0 || score > 1) score = 0;
      explanation = typeof result.explanation === 'string' ? result.explanation : '无解释';
      console.log('[AliService] 解析后相关性分数:', score, '类型:', typeof score);
    } catch (e) {
      console.warn('[AliService] 解析大模型返回内容失败:', e, '原始内容:', responseText);
    }
    return { relevanceScore: score, explanation };
  }
} 