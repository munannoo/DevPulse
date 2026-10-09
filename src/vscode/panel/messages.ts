import type { SecretFinding } from '../../core/security/secretScan';

export type PanelMessage = { type: 'scan' } | { type: 'install' } | { type: 'fix'; id: string };
export type SecurityState = { type: 'security'; findings: SecretFinding[]; message: string };

export function panelMessage(value: unknown): PanelMessage | undefined {
  if (!value || typeof value !== 'object') { return undefined; }
  const item = value as Record<string, unknown>;
  if (item.type === 'scan' || item.type === 'install') { return { type: item.type }; }
  if (item.type === 'fix' && typeof item.id === 'string' && /^[a-f0-9]{64}$/.test(item.id)) { return { type: 'fix', id: item.id }; }
  return undefined;
}
