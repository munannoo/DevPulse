import type { BranchStatus } from '../../core/git/repo';
import type { Finding } from '../../core/llm/schemas';

export type ReviewState = {
  phase: 'idle' | 'checking' | 'reviewing' | 'complete' | 'failed' | 'cancelled';
  message: string;
  branch?: BranchStatus;
  findings: Finding[];
  summaries: Array<{ file: string; text: string }>;
  skipped: string[];
  offline: boolean;
  reviewedFiles: number;
};
export type PanelMessage =
  | { type: 'ready' | 'reviewChanges' | 'analyzeFile' | 'refreshBranch' | 'cancelReview' }
  | { type: 'openFinding'; index: number };
export type ExtensionMessage = { type: 'state'; state: ReviewState };

export function isPanelMessage(value: unknown): value is PanelMessage {
  if (!value || typeof value !== 'object') { return false; }
  const message = value as Record<string, unknown>;
  if (message.type === 'openFinding') {
    return Number.isInteger(message.index) && Number(message.index) >= 0;
  }
  return ['ready', 'reviewChanges', 'analyzeFile', 'refreshBranch', 'cancelReview'].includes(String(message.type));
}
