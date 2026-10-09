// Protocol: src/vscode/panel/messages.ts. Source and secret values never enter the webview.
const vscode = acquireVsCodeApi();
document.getElementById('scan').addEventListener('click', () => vscode.postMessage({ type: 'scan' }));
document.getElementById('install').addEventListener('click', () => vscode.postMessage({ type: 'install' }));
window.addEventListener('message', event => {
  const state = event.data;
  if (!state || state.type !== 'security' || !Array.isArray(state.findings)) { return; }
  document.getElementById('status').textContent = state.message;
  const list = document.getElementById('findings');
  list.replaceChildren();
  for (const finding of state.findings) {
    const card = document.createElement('article');
    const title = document.createElement('h3');
    title.textContent = finding.title;
    const location = document.createElement('p');
    location.textContent = `${finding.file}:${finding.startLine}`;
    const explanation = document.createElement('p');
    explanation.textContent = finding.explanation;
    card.append(title, location, explanation);
    if (finding.canFix) {
      const button = document.createElement('button');
      button.textContent = 'Fix';
      button.addEventListener('click', () => vscode.postMessage({ type: 'fix', id: finding.id }));
      card.append(button);
    } else {
      const help = document.createElement('p');
      help.textContent = 'Manual fix required. Remove the credential and verify again.';
      card.append(help);
    }
    list.append(card);
  }
});
vscode.postMessage({ type: 'scan' });
