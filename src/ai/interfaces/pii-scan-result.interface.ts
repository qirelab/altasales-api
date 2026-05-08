export interface PiiScanResult {
  hasPii: boolean;
  stats: Record<string, number>;
}
