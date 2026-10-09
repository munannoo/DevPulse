// @ts-check
/** @typedef {import('../src/vscode/panel/messages').PanelMessage} PanelMessage */
/** @typedef {import('../src/vscode/panel/messages').ExtensionMessage} ExtensionMessage */
/** @type {{ postMessage(message: PanelMessage): void }} */
// @ts-ignore acquireVsCodeApi is provided by the VS Code webview host.
const vscode = acquireVsCodeApi();
const element = id => document.getElementById(id);
/** @param {PanelMessage} message */
const send = message => vscode.postMessage(message);

function selectTab(tab) {
  element('overview').hidden = tab !== 'overview';
  element('code').hidden = tab !== 'code';
  document.querySelectorAll('[data-tab]').forEach(button => {
    button.setAttribute('aria-pressed', String(button.dataset.tab === tab));
  });
}

document.querySelectorAll('[data-tab]').forEach(button => {
  button.addEventListener('click', () => selectTab(button.dataset.tab));
});

element('review').addEventListener('click', () => {
  selectTab('code');
  send({ type: 'reviewChanges' });
});

element('analyze').addEventListener('click', () => {
  selectTab('code');
  send({ type: 'analyzeFile' });
});

element('refresh').addEventListener('click', () => send({ type: 'refreshBranch' }));
element('cancel').addEventListener('click', () => send({ type: 'cancelReview' }));

/** @param {MessageEvent<ExtensionMessage>} event */
window.addEventListener('message', event => {
  if (event.data?.type !== 'state') { return; }
  const state = event.data.state;
  const busy = state.phase === 'checking' || state.phase === 'reviewing';

  // Status strip updates
  element('message').textContent = state.message;
  element('message').classList.toggle('loading', busy);

  const statusDot = element('status-dot');
  if (statusDot) {
    if (busy) {
      statusDot.className = 'status-dot busy';
    } else if (state.phase === 'complete') {
      statusDot.className = 'status-dot complete';
    } else if (state.phase === 'failed') {
      statusDot.className = 'status-dot failed';
    } else {
      statusDot.className = 'status-dot idle';
    }
  }

  element('offline').hidden = !state.offline;
  for (const id of ['review', 'refresh', 'analyze']) {
    element(id).disabled = busy;
  }
  element('cancel').hidden = !busy;

  // Branch status formatting
  const branch = state.branch;
  element('branch').replaceChildren();
  if (branch) {
    const branchChip = document.createElement('span');
    branchChip.className = 'branch-pill';
    branchChip.textContent = branch.branch;
    element('branch').append(branchChip);

    if (branch.upstream) {
      if (branch.behind) {
        const behind = document.createElement('span');
        behind.className = 'metric-pill behind';
        behind.textContent = `↓${branch.behind} behind`;
        element('branch').append(behind);
      }
      if (branch.ahead) {
        const ahead = document.createElement('span');
        ahead.className = 'metric-pill ahead';
        ahead.textContent = `↑${branch.ahead} ahead`;
        element('branch').append(ahead);
      }
      if (!branch.behind && !branch.ahead) {
        const synced = document.createElement('span');
        synced.className = 'metric-pill synced';
        synced.textContent = '✓ Synced';
        element('branch').append(synced);
      }
      const remote = document.createElement('span');
      remote.className = 'remote-pill';
      remote.textContent = branch.upstream;
      element('branch').append(remote);
    } else {
      const noUpstream = document.createElement('span');
      noUpstream.className = 'metric-pill muted';
      noUpstream.textContent = 'no upstream';
      element('branch').append(noUpstream);
    }
  } else {
    element('branch').textContent = 'Open a Git repository to check branch status.';
  }

  element('branch-note').textContent = branch?.note ?? (branch?.fresh ? 'Upstream status is up to date.' : '');

  // Attention banner
  const security = state.findings.filter(finding => finding.severity === 'security').length;
  element('attention').hidden = !branch?.behind && !security;
  element('attention-text').textContent = [
    branch?.behind ? `${branch.behind} commit(s) behind upstream${branch.fresh ? '' : ' (last fetched)'}.` : '',
    security ? `${security} security finding(s) detected in local code.` : '',
  ].filter(Boolean).join(' ');

  // Empty state handling
  const hasContent = state.findings.length > 0 || (state.summaries.length > 0 && state.phase !== 'complete');
  element('empty').hidden = hasContent;
  const emptyMsg = element('empty').querySelector('.empty-message');
  if (emptyMsg) {
    emptyMsg.textContent = state.phase === 'complete' && state.reviewedFiles && !state.skipped.length
      ? `All clear: No findings in ${state.reviewedFiles} reviewed file(s).`
      : 'Run a review to see summaries and findings.';
  }

  // Summaries rendering
  element('summaries').replaceChildren();
  for (const summary of state.summaries) {
    const details = document.createElement('details');
    details.className = 'summary-card';
    details.open = true;

    const title = document.createElement('summary');
    title.className = 'summary-header';
    title.textContent = summary.file;

    const text = document.createElement('p');
    text.className = 'summary-text';
    text.textContent = summary.text;

    details.append(title, text);
    element('summaries').append(details);
  }

  // Findings rendering
  element('findings').replaceChildren();
  state.findings.forEach((finding, index) => {
    const card = document.createElement('article');
    card.className = `finding-card ${finding.severity}`;

    const meta = document.createElement('div');
    meta.className = 'finding-meta';

    const severity = document.createElement('span');
    severity.className = 'severity-pill';
    severity.textContent = finding.severity;

    const location = document.createElement('button');
    location.className = 'location-link';
    location.title = `Jump to ${finding.file}:${finding.startLine}`;
    location.textContent = `${finding.file}:${finding.startLine} ↗`;
    location.addEventListener('click', () => send({ type: 'openFinding', index }));

    meta.append(severity, location);

    const title = document.createElement('h4');
    title.className = 'finding-title';
    title.textContent = finding.title;

    const explanation = document.createElement('p');
    explanation.className = 'finding-explanation';
    explanation.textContent = finding.explanation;

    card.append(meta, title, explanation);

    if (finding.suggestion) {
      const details = document.createElement('details');
      details.className = 'suggestion-box';

      const label = document.createElement('summary');
      label.className = 'suggestion-summary';
      label.textContent = 'Suggested Fix';

      const suggestion = document.createElement('pre');
      suggestion.className = 'suggestion-code';
      suggestion.textContent = finding.suggestion;

      details.append(label, suggestion);
      card.append(details);
    }

    element('findings').append(card);
  });

  // Skipped files
  element('skipped').hidden = !state.skipped.length;
  element('skipped-list').replaceChildren();
  for (const file of state.skipped) {
    const item = document.createElement('li');
    item.textContent = file;
    element('skipped-list').append(item);
  }
});

send({ type: 'ready' });
