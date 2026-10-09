import type { BranchStatus } from '../../core/git/repo';
import type { Finding } from '../../core/llm/schemas';
import type { GitHubRepository } from '../../core/github/repository';
import type { PullRequest } from '../../core/github/client';
import type { PullReviewResult } from '../../core/review/pullRequest';

export type PullRequestState = {
  phase: 'idle' | 'disconnected' | 'loading' | 'ready' | 'reviewing' | 'complete' | 'failed' | 'cancelled';
  message: string; repository?: GitHubRepository; items: PullRequest[]; truncated: boolean;
  selected?: number; result?: PullReviewResult; offline?: boolean;
};

export type ReviewState = {
  phase: 'idle' | 'checking' | 'reviewing' | 'complete' | 'failed' | 'cancelled';
  message: string;
  branch?: BranchStatus;
  findings: Finding[];
  summaries: Array<{ file: string; text: string }>;
  skipped: string[];
  offline: boolean;
  reviewedFiles: number;
  pullRequests?: PullRequestState;
};
export type PanelMessage =
  | { type: 'ready' | 'reviewChanges' | 'analyzeFile' | 'refreshBranch' | 'cancelReview' }
  | { type: 'openFinding'; index: number }
  | PullPanelMessage;
export type PullPanelMessage =
  | { type: 'connectGitHub' | 'refreshPullRequests' | 'cancelPullReview' }
  | { type: 'reviewPullRequest'; number: number }
  | { type: 'openPullFinding'; index: number };
export type ExtensionMessage = { type: 'state'; state: ReviewState };

export function isPanelMessage(value: unknown): value is PanelMessage {
  if (!value || typeof value !== 'object') { return false; }
  const message = value as Record<string, unknown>;
  if (message.type === 'openFinding' || message.type === 'openPullFinding') {
    return Number.isInteger(message.index) && Number(message.index) >= 0;
  }
  if (message.type === 'reviewPullRequest') { return Number.isSafeInteger(message.number) && Number(message.number) > 0; }
  return ['ready', 'reviewChanges', 'analyzeFile', 'refreshBranch', 'cancelReview', 'connectGitHub', 'refreshPullRequests', 'cancelPullReview'].includes(String(message.type));
}
import type { SecretFinding } from '../../core/security/secretScan';

export type SecurityPanelMessage = { type: 'scan' } | { type: 'install' } | { type: 'fix'; id: string };
export type SecurityState = { type: 'security'; findings: SecretFinding[]; message: string };

export function securityPanelMessage(value: unknown): SecurityPanelMessage | undefined {
  if (!value || typeof value !== 'object') { return undefined; }
  const item = value as Record<string, unknown>;
  if (item.type === 'scan' || item.type === 'install') { return { type: item.type }; }
  if (item.type === 'fix' && typeof item.id === 'string' && /^[a-f0-9]{64}$/.test(item.id)) { return { type: 'fix', id: item.id }; }
  return undefined;
}
