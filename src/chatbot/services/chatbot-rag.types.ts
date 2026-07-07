export type ChatbotRagInput = {
  question: string;
};

export type ChatbotRagSource = {
  documentId: string;
  documentTitle: string | null;
  chunkIndex: number;
  score: number;
};

export type ChatbotRagRefusalReason =
  | 'empty_question'
  | 'no_results'
  | 'below_threshold'
  | 'empty_llm_response'
  | 'retrieval_failed'
  | 'generation_failed'
  | 'context_too_large';

export type ChatbotRagResponse = {
  answer: string;
  hasContext: boolean;
  sources: ChatbotRagSource[];
  refusalReason?: ChatbotRagRefusalReason;
};
