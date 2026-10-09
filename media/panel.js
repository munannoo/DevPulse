// @ts-check
/** @typedef {import('../src/vscode/panel/messages').PanelMessage} PanelMessage */
/** @typedef {import('../src/vscode/panel/messages').ExtensionMessage} ExtensionMessage */
/** @type {{ postMessage(message: PanelMessage): void }} */
// @ts-ignore acquireVsCodeApi is provided by the VS Code webview host.
const vscode = acquireVsCodeApi();
const element = id => document.getElementById(id);
/** @param {PanelMessage} message */
const send = message => vscode.postMessage(message);
// Keep visual priority and keyboard reading order aligned.
element('overview').prepend(element('attention'));
element('attention').after(document.querySelector('.primary-action-wrap'));

function selectTab(tab) {
  element('overview').hidden = tab !== 'overview';
  element('code').hidden = tab !== 'code';
  element('focus').hidden = tab !== 'focus';
  element('chat').hidden = tab !== 'chat';
  document.body.classList.toggle('chat-open', tab === 'chat');
  document.body.classList.toggle('focus-open', tab === 'focus');
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
    const card = document.createElement('article'); card.className = `finding-card ${finding.severity}`;
    const title = document.createElement('strong'); title.textContent = finding.title;
    const location = document.createElement('button'); location.className = 'location-link';
    location.textContent = `${finding.file}:${finding.startLine} · ${finding.severity} · Open reviewed revision on GitHub`;
    location.addEventListener('click', () => send({ type: 'openPullFinding', index }));
    const explanation = document.createElement('p'); explanation.textContent = finding.explanation;
    card.append(title, location, explanation);
    if (finding.suggestion || finding.replacement) { const suggestion = document.createElement('pre'); suggestion.textContent = finding.replacement ?? finding.suggestion ?? ''; card.append(suggestion); }
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

  element('offline').hidden = !state.offline && !state.pullRequests?.offline;
  for (const id of ['review', 'refresh', 'analyze']) {
    element(id).disabled = busy;
  }
  element('cancel').hidden = !busy;

  // Companion hero banner status
  const companionBadge = element('companion-badge');
  const companionDesc = element('companion-desc');
  if (companionBadge && companionDesc) {
    if (state.offline || state.pullRequests?.offline) {
      companionBadge.className = 'companion-pill offline';
      companionBadge.textContent = 'Offline';
      companionDesc.textContent = 'Gemma endpoint unreachable. Local Git and secret scanning guards remain active.';
    } else if (busy) {
      companionBadge.className = 'companion-pill busy';
      companionBadge.textContent = 'Reviewing…';
      companionDesc.textContent = 'Analyzing repository changes through your local Gemma endpoint…';
    } else if (state.phase === 'complete') {
      companionBadge.className = 'companion-pill complete';
      companionBadge.textContent = state.findings.length || state.skipped.length ? 'Review Complete' : 'All Clear';
      companionDesc.textContent = state.findings.length || state.skipped.length ? state.message : 'Review complete. No issues found in reviewed changes.';
    } else {
      companionBadge.className = 'companion-pill';
      companionBadge.textContent = 'Active';
      companionDesc.textContent = 'Local-first code guard powered by Gemma. Standing by for reviews.';
    }
  }

  // Branch status formatting
  const branch = state.branch;
  element('pull').disabled = busy || !branch?.upstream || !branch.behind || Boolean(branch.ahead);
  element('pull-message').hidden = !state.welcome?.pullMessage;
  element('pull-message').textContent = state.welcome?.pullMessage ?? '';

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
  element('attention').hidden = !branch?.behind && !security && !state.attention?.length;
  element('attention-text').textContent = [
    state.pullReminder ?? (branch?.behind ? `${branch.behind} commit(s) behind upstream${branch.fresh ? '' : ' (last fetched)'}.` : ''),
    security ? `${security} security finding(s) detected in local code.` : '',
    ...(state.attention ?? []).map(item => item.text),
  ].filter(Boolean).join(' ');

  // Empty state handling
  const hasContent = state.findings.length > 0 || state.summaries.length > 0;
  element('empty').hidden = hasContent;
  const emptyMsg = element('empty').querySelector('.empty-message');
  if (emptyMsg) {
    emptyMsg.textContent = state.phase === 'complete' && state.reviewedFiles && !state.skipped.length
      ? `All clear: No findings in ${state.reviewedFiles} reviewed file(s).`
      : state.phase === 'failed' ? 'Review unavailable. Check the status above and try again.'
      : state.skipped.length ? 'Review is partial. See skipped files below.'
      : busy ? 'Review in progress. Findings will appear here.'
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

    if (finding.suggestionId) {
      const apply = document.createElement('button'); apply.textContent = 'Apply Suggestion'; apply.disabled = busy;
      apply.addEventListener('click', () => { apply.disabled = true; send({ type: 'applySuggestion', id: finding.suggestionId }); });
      card.append(apply);
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
