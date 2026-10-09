import type { BranchStatus } from '../../core/git/repo';
import type { Finding } from '../../core/llm/schemas';
import type { LeftOffBanner } from '../features/leftOff';
import type { WelcomeState } from '../features/welcome';
import type { FocusState } from '../../core/focus/tracker';
import type { GitHubRepository } from '../../core/github/repository';
import type { PullRequest } from '../../core/github/client';
import type { PullReviewResult } from '../../core/review/pullRequest';

export type PullRequestState = {
  phase: 'idle' | 'disconnected' | 'loading' | 'ready' | 'reviewing' | 'complete' | 'failed' | 'cancelled';
  message: string; repository?: GitHubRepository; items: PullRequest[]; truncated: boolean;
  selected?: number; result?: PullReviewResult; offline?: boolean;
};

export type PanelFinding = Finding & { suggestionId?: string };
export type ChatMessage = { id: string; role: 'user' | 'assistant'; text: string; complete: boolean };
export type ChatState = { messages: ChatMessage[]; busy: boolean; offline: boolean; status: string;
  draft?: { id: string; text: string; includeSelection: boolean } };

export type ReviewState = {
  phase: 'idle' | 'checking' | 'reviewing' | 'complete' | 'failed' | 'cancelled';
  message: string;
  branch?: BranchStatus;
  findings: PanelFinding[];
  summaries: Array<{ file: string; text: string }>;
  skipped: string[];
  offline: boolean;
  reviewedFiles: number;
  leftOff?: LeftOffBanner;
  pullReminder?: string;
  welcome?: WelcomeState;
  focus?: FocusState;
  chat?: ChatState;
  pullRequests?: PullRequestState;
};
export type PanelMessage =
  | { type: 'ready' | 'reviewChanges' | 'analyzeFile' | 'refreshBranch' | 'cancelReview' | 'resumeWork' | 'pullAndSync' }
  | { type: 'openFinding'; index: number }
  | { type: 'applySuggestion'; id: string }
  | { type: 'chatSend'; text: string; includeFile: boolean; includeSelection: boolean }
  | { type: 'chatCancel' | 'chatClear' }
  | { type: 'chatCopy' | 'chatInsert'; id: string }
  | PullPanelMessage;
export type PullPanelMessage =
  | { type: 'connectGitHub' | 'refreshPullRequests' | 'cancelPullReview' }
  | { type: 'reviewPullRequest'; number: number }
  | { type: 'openPullFinding'; index: number };

export type ExtensionMessage = { type: 'state'; state: ReviewState };

export function isPanelMessage(value: unknown): value is PanelMessage {
  if (!value || typeof value !== 'object') { return false; }
  const message = value as Record<string, unknown>;
  if (message.type === 'chatSend') {
    return typeof message.text === 'string' && message.text.trim().length > 0 && message.text.length <= 8000
      && typeof message.includeFile === 'boolean' && typeof message.includeSelection === 'boolean';
  }
  if (message.type === 'chatCopy' || message.type === 'chatInsert') {
    return typeof message.id === 'string' && /^[a-f0-9-]{36}$/.test(message.id);
  }
  if (message.type === 'chatCancel' || message.type === 'chatClear') { return true; }
  if (message.type === 'applySuggestion') {
    return typeof message.id === 'string' && /^[a-f0-9-]{36}$/.test(message.id);
  }
  if (message.type === 'openFinding' || message.type === 'openPullFinding') {
    return Number.isInteger(message.index) && Number(message.index) >= 0;
  }
  if (message.type === 'reviewPullRequest') { return Number.isSafeInteger(message.number) && Number(message.number) > 0; }
  return ['ready', 'reviewChanges', 'analyzeFile', 'refreshBranch', 'cancelReview', 'resumeWork', 'pullAndSync', 'connectGitHub', 'refreshPullRequests', 'cancelPullReview'].includes(String(message.type));
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
