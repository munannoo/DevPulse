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
  document.body.classList.toggle('chat-open', tab === 'chat');
  document.body.classList.toggle('focus-open', tab === 'focus');
  element('overview').hidden = tab !== 'overview';
  element('code').hidden = tab !== 'code';
  element('focus').hidden = tab !== 'focus';
  element('chat').hidden = tab !== 'chat';
  document.querySelectorAll('[data-tab]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.tab === tab)));
}
document.querySelectorAll('[data-tab]').forEach(button => button.addEventListener('click', () => selectTab(button.dataset.tab)));
element('review').addEventListener('click', () => { selectTab('code'); send({ type: 'reviewChanges' }); });
element('analyze').addEventListener('click', () => { selectTab('code'); send({ type: 'analyzeFile' }); });
element('refresh').addEventListener('click', () => send({ type: 'refreshBranch' }));
element('cancel').addEventListener('click', () => send({ type: 'cancelReview' }));
element('resume').addEventListener('click', () => send({ type: 'resumeWork' }));
element('pull').addEventListener('click', () => send({ type: 'pullAndSync' }));
element('chat-form').addEventListener('submit', event => {
  event.preventDefault();
  const text = element('chat-question').value.trim(); if (!text || element('chat-send').disabled) { return; }
  send({ type: 'chatSend', text, includeFile: element('chat-file').checked, includeSelection: element('chat-selection').checked });
  element('chat-send').disabled = true;
});
element('chat-stop').addEventListener('click', () => send({ type: 'chatCancel' }));
element('chat-clear').addEventListener('click', () => send({ type: 'chatClear' }));

/** @param {MessageEvent<ExtensionMessage>} event */
window.addEventListener('message', event => {
  if (event.data?.type !== 'state') { return; }
  const state = event.data.state;
  renderChat(state, send);
  const focus = state.focus;
  element('focus-time').textContent = `${Math.floor((focus?.milliseconds ?? 0) / 60000)} minutes today`;
  element('focus-switches').textContent = `${focus?.switches ?? 0} context switches`;
  element('focus-state').textContent = focus?.inFlow ? '✦ In Flow' : focus?.active ? 'Active' : 'Paused';
  element('focus-shield').textContent = focus?.shield ? 'Flow Shield delays DevPulse reminders during Flow.' : 'Flow Shield is off.';
  element('welcome-summary').textContent = state.welcome?.summary ?? 'Loading welcome…';
  element('welcome-summary').classList.toggle('loading', Boolean(state.welcome?.loading));
  element('left-off').hidden = !state.leftOff;
  element('left-off-summary').textContent = state.leftOff?.summary ?? '';
  element('resume').textContent = state.leftOff ? `Resume ${state.leftOff.file}:${state.leftOff.line}` : 'Resume editing';
  const busy = state.phase === 'checking' || state.phase === 'reviewing' || Boolean(state.welcome?.pulling);
  element('message').textContent = state.message;
  element('message').classList.toggle('loading', busy);
  element('offline').hidden = !state.offline;
  for (const id of ['review', 'refresh', 'analyze']) { element(id).disabled = busy; }
  element('cancel').hidden = state.phase !== 'checking' && state.phase !== 'reviewing';
  const branch = state.branch;
  element('pull').disabled = busy || !branch?.upstream || !branch.behind || Boolean(branch.ahead);
  element('pull-message').hidden = !state.welcome?.pullMessage;
  element('pull-message').textContent = state.welcome?.pullMessage ?? '';
  element('branch').textContent = branch
    ? `${branch.branch}${branch.upstream ? ` · ↓${branch.behind ?? '?'} behind · ↑${branch.ahead ?? '?'} ahead · ${branch.upstream}` : ' · no upstream'}`
    : 'Open a Git repository to check branch status.';
  element('branch-note').textContent = branch?.note ?? (branch?.fresh ? 'Fetched upstream status.' : '');
  const security = state.findings.filter(finding => finding.severity === 'security').length;
  element('attention').hidden = !branch?.behind && !security;
  element('attention-text').textContent = [
    state.pullReminder ?? (branch?.behind ? `${branch.behind} commit(s) behind upstream${branch.fresh ? '' : ' (last fetched)'}.` : ''),
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
    if (finding.suggestion || finding.replacement) {
      const details = document.createElement('details');
      const label = document.createElement('summary'); label.textContent = 'Suggestion';
      const suggestion = document.createElement('pre'); suggestion.textContent = finding.replacement ?? finding.suggestion ?? '';
      details.append(label, suggestion); card.append(details);
    }
    if (finding.suggestionId) {
      const apply = document.createElement('button'); apply.textContent = 'Apply Suggestion'; apply.disabled = busy;
      apply.addEventListener('click', () => { apply.disabled = true; send({ type: 'applySuggestion', id: finding.suggestionId }); });
      card.append(apply);
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
