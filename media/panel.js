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
  document.querySelectorAll('[data-tab]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.tab === tab)));
}
document.querySelectorAll('[data-tab]').forEach(button => button.addEventListener('click', () => selectTab(button.dataset.tab)));
element('review').addEventListener('click', () => { selectTab('code'); send({ type: 'reviewChanges' }); });
element('analyze').addEventListener('click', () => { selectTab('code'); send({ type: 'analyzeFile' }); });
element('refresh').addEventListener('click', () => send({ type: 'refreshBranch' }));
element('cancel').addEventListener('click', () => send({ type: 'cancelReview' }));
element('pr-connect').addEventListener('click', () => send({ type: 'connectGitHub' }));
element('pr-refresh').addEventListener('click', () => send({ type: 'refreshPullRequests' }));
element('pr-cancel').addEventListener('click', () => send({ type: 'cancelPullReview' }));

/** @param {import('../src/vscode/panel/messages').PullRequestState | undefined} state */
function renderPullRequests(state) {
  if (!state) { return; }
  const busy = state.phase === 'loading' || state.phase === 'reviewing';
  element('pr-message').textContent = state.message;
  element('pr-message').classList.toggle('loading', busy);
  element('pr-connect').hidden = !['idle', 'disconnected', 'failed'].includes(state.phase);
  element('pr-connect').disabled = busy;
  element('pr-refresh').disabled = busy;
  element('pr-cancel').hidden = !busy;
  element('pr-list').replaceChildren();
  for (const pr of state.items) {
    const card = document.createElement('article');
    const title = document.createElement('p'); title.textContent = `#${pr.number} · ${pr.title} — ${pr.author}`;
    const button = document.createElement('button'); button.textContent = 'Review with Gemma'; button.disabled = busy;
    button.addEventListener('click', () => send({ type: 'reviewPullRequest', number: pr.number }));
    card.append(title, button); element('pr-list').append(card);
  }
  element('pr-result').replaceChildren();
  const result = state.result;
  if (!result) { return; }
  const heading = document.createElement('p');
  heading.textContent = `PR #${state.selected} · ${result.head.slice(0, 8)} · Risk: ${result.risk === 'none' ? 'no risks detected in reviewed files' : result.risk}${result.skipped.length ? ' · Partial review' : ''}`;
  element('pr-result').append(heading);
  for (const summary of result.summaries) {
    const section = document.createElement('details'); section.open = true;
    const title = document.createElement('summary'); title.textContent = summary.file;
    const text = document.createElement('p'); text.textContent = summary.text;
    section.append(title, text); element('pr-result').append(section);
  }
  result.findings.forEach((finding, index) => {
    const card = document.createElement('article'); card.className = `finding ${finding.severity}`;
    const title = document.createElement('strong'); title.textContent = finding.title;
    const location = document.createElement('button'); location.className = 'location';
    location.textContent = `${finding.file}:${finding.startLine} · ${finding.severity} · Open reviewed revision on GitHub`;
    location.addEventListener('click', () => send({ type: 'openPullFinding', index }));
    const explanation = document.createElement('p'); explanation.textContent = finding.explanation;
    card.append(title, location, explanation);
    if (finding.suggestion) { const suggestion = document.createElement('pre'); suggestion.textContent = finding.suggestion; card.append(suggestion); }
    element('pr-result').append(card);
  });
  if (result.skipped.length) {
    const skipped = document.createElement('details');
    const title = document.createElement('summary'); title.textContent = 'Skipped PR files';
    const list = document.createElement('ul');
    for (const reason of result.skipped) { const item = document.createElement('li'); item.textContent = reason; list.append(item); }
    skipped.append(title, list); element('pr-result').append(skipped);
  }
}

/** @param {MessageEvent<ExtensionMessage>} event */
window.addEventListener('message', event => {
  if (event.data?.type !== 'state') { return; }
  const state = event.data.state;
  renderPullRequests(state.pullRequests);
  const busy = state.phase === 'checking' || state.phase === 'reviewing';
  element('message').textContent = state.message;
  element('message').classList.toggle('loading', busy);
  element('offline').hidden = !state.offline && !state.pullRequests?.offline;
  for (const id of ['review', 'refresh', 'analyze']) { element(id).disabled = busy; }
  element('cancel').hidden = !busy;
  const branch = state.branch;
  element('branch').textContent = branch
    ? `${branch.branch}${branch.upstream ? ` · ↓${branch.behind ?? '?'} behind · ↑${branch.ahead ?? '?'} ahead · ${branch.upstream}` : ' · no upstream'}`
    : 'Open a Git repository to check branch status.';
  element('branch-note').textContent = branch?.note ?? (branch?.fresh ? 'Fetched upstream status.' : '');
  const security = state.findings.filter(finding => finding.severity === 'security').length;
  element('attention').hidden = !branch?.behind && !security;
  element('attention-text').textContent = [
    branch?.behind ? `${branch.behind} commit(s) behind upstream${branch.fresh ? '' : ' (last fetched)'}.` : '',
    security ? `${security} security finding(s) to check.` : '',
  ].filter(Boolean).join(' ');
  element('empty').hidden = state.findings.length > 0 || (state.summaries.length > 0 && state.phase !== 'complete');
  element('empty').textContent = state.phase === 'complete' && state.reviewedFiles && !state.skipped.length
    ? 'All clear: no findings in the reviewed changes.' : 'Run a review to see summaries and findings.';
  element('summaries').replaceChildren();
  for (const summary of state.summaries) {
    const details = document.createElement('details'); details.open = true;
    const title = document.createElement('summary'); title.textContent = summary.file;
    const text = document.createElement('p'); text.textContent = summary.text;
    details.append(title, text); element('summaries').append(details);
  }
  element('findings').replaceChildren();
  state.findings.forEach((finding, index) => {
    const card = document.createElement('article'); card.className = `finding ${finding.severity}`;
    const title = document.createElement('strong'); title.textContent = finding.title;
    const location = document.createElement('button'); location.className = 'location';
    location.textContent = `${finding.file}:${finding.startLine} · ${finding.severity}`;
    location.addEventListener('click', () => send({ type: 'openFinding', index }));
    const explanation = document.createElement('p'); explanation.textContent = finding.explanation;
    card.append(title, location, explanation);
    if (finding.suggestion) {
      const details = document.createElement('details');
      const label = document.createElement('summary'); label.textContent = 'Suggestion';
      const suggestion = document.createElement('pre'); suggestion.textContent = finding.suggestion;
      details.append(label, suggestion); card.append(details);
    }
    element('findings').append(card);
  });
  element('skipped').hidden = !state.skipped.length;
  element('skipped-list').replaceChildren();
  for (const file of state.skipped) {
    const item = document.createElement('li'); item.textContent = file; element('skipped-list').append(item);
  }
});
send({ type: 'ready' });
