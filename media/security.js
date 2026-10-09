// @ts-check
// Protocol: src/vscode/panel/messages.ts. Source and secret values never enter the webview.
// @ts-ignore acquireVsCodeApi is provided by the VS Code webview host.
const vscode = acquireVsCodeApi();

document.getElementById('scan')?.addEventListener('click', () => vscode.postMessage({ type: 'scan' }));
document.getElementById('install')?.addEventListener('click', () => vscode.postMessage({ type: 'install' }));

window.addEventListener('message', event => {
  const state = event.data;
  if (!state || state.type !== 'security' || !Array.isArray(state.findings)) { return; }

  const statusEl = document.getElementById('status');
  if (statusEl) {
    statusEl.textContent = state.message;
  }

  const list = document.getElementById('findings');
  if (!list) { return; }
  list.replaceChildren();

  if (state.findings.length === 0) {
    const emptyCard = document.createElement('div');
    emptyCard.className = 'empty-state';

    const title = document.createElement('p');
    title.className = 'empty-title';
    title.textContent = 'All Clear';

    const desc = document.createElement('p');
    desc.className = 'empty-desc';
    desc.textContent = 'No credentials or secrets detected in staged additions.';

    emptyCard.append(title, desc);
    list.append(emptyCard);
    return;
  }

  for (const finding of state.findings) {
    const card = document.createElement('article');
    card.className = 'finding-card';

    const meta = document.createElement('div');
    meta.className = 'finding-meta';

    const threat = document.createElement('span');
    threat.className = 'threat-pill';
    threat.textContent = 'Security';

    const location = document.createElement('span');
    location.className = 'location-tag';
    location.textContent = `${finding.file}:${finding.startLine}`;

    meta.append(threat, location);

    const title = document.createElement('h4');
    title.className = 'finding-title';
    title.textContent = finding.title;

    const explanation = document.createElement('p');
    explanation.className = 'finding-explanation';
    explanation.textContent = finding.explanation;

    card.append(meta, title, explanation);

    if (finding.canFix) {
      const button = document.createElement('button');
      button.className = 'btn-fix';
      button.textContent = 'Auto-Fix Secret';
      button.addEventListener('click', () => vscode.postMessage({ type: 'fix', id: finding.id }));
      card.append(button);
    } else {
      const help = document.createElement('p');
      help.className = 'manual-fix-note';
      help.textContent = 'Manual remediation required. Remove the credential and verify again.';
      card.append(help);
    }

    list.append(card);
  }
});

vscode.postMessage({ type: 'scan' });
