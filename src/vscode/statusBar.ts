import * as vscode from 'vscode';
import type { ReviewState } from './panel/messages';

export function createStatusBar(): vscode.StatusBarItem {
  const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50);
  item.command = 'devpulse.reviewChanges';
  item.text = '$(pulse) DevPulse';
  item.tooltip = 'Review local changes with Gemma';
  item.show();
  return item;
}
export function updateStatusBar(item: vscode.StatusBarItem, state: ReviewState): void {
  const branch = state.branch;
  const busy = state.phase === 'checking' || state.phase === 'reviewing';
  const counts = branch?.upstream ? ` ↓${branch.behind ?? '?'} ↑${branch.ahead ?? '?'}` : '';
  const prs = state.pullRequests?.items.length ?? 0;
  const attention = state.attention?.filter(item => item.id !== 'prs').length ?? 0;
  item.text = `${busy ? '$(sync~spin)' : '$(pulse)'} ${branch?.branch ?? 'DevPulse'}${counts}${prs ? ` | ${prs} PRs` : ''}${attention ? ` | ${attention} reminder(s)` : ''}${state.focus?.inFlow ? ' | ✦ In Flow' : ''}`;
  item.tooltip = `${state.pullReminder ?? state.message}\n${(state.attention ?? []).map(item => item.text).join('\n')}\n${branch?.note ?? ''}\nClick to review local changes.`;
}
