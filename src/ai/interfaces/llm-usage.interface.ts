export interface LlmUsage {
  tokensIn: number;
  tokensOut: number;
  costRub?: number;
  latencyMs: number;
}
