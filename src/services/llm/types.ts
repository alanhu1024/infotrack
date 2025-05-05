export interface LLMService {
  analyzeTextRelevance(text: string, criteria: string): Promise<{
    relevanceScore: number;
    explanation: string;
  }>;
} 