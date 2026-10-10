// Model Markdown is rendered using DOM text nodes; HTML and executable links stay literal.
function renderChatMarkdown(target, text) {
  target.replaceChildren();
  const inline = (node, value) => {
    for (const part of value.split(/(`[^`]+`|\*\*[^*]+\*\*)/g)) {
      if (part.startsWith('`') && part.endsWith('`')) {
        const code = document.createElement('code'); code.textContent = part.slice(1, -1); node.append(code);
      } else if (part.startsWith('**') && part.endsWith('**')) {
        const bold = document.createElement('strong'); bold.textContent = part.slice(2, -2); node.append(bold);
      } else { node.append(document.createTextNode(part)); }
    }
  };
  let code, lines = [];
  for (const line of text.split('\n')) {
    if (line.startsWith('```')) {
      if (code) { code.textContent = lines.join('\n'); target.append(code); code = undefined; lines = []; }
      else { code = document.createElement('pre'); }
    } else if (code) { lines.push(line); }
    else if (line.trim()) {
      const heading = /^(#{1,3})\s+(.*)/.exec(line);
      const node = document.createElement(heading ? `h${heading[1].length + 2}` : 'p');
      inline(node, heading ? heading[2] : line); target.append(node);
    }
  }
  if (code) { code.textContent = lines.join('\n'); target.append(code); }
}

let lastChatDraft;
let lastChatBusy = false;
function renderChat(state, send) {
  const chat = state.chat;
  if (!chat) { return; }
  if (chat.draft && chat.draft.id !== lastChatDraft) {
    lastChatDraft = chat.draft.id; selectTab('chat');
    element('chat-question').value = chat.draft.text;
    element('chat-selection').checked = chat.draft.includeSelection;
    element('chat-file').checked = false;
  }
  element('chat-status').textContent = chat.status;
  if (lastChatBusy && !chat.busy && chat.status === 'Reply ready.') { element('chat-question').value = ''; }
  lastChatBusy = chat.busy;
  for (const id of ['chat-question', 'chat-file', 'chat-selection']) { element(id).disabled = chat.busy; }
  element('chat-send').disabled = chat.busy;
  element('chat-stop').hidden = !chat.busy;
  element('chat-clear').disabled = chat.busy;
  const messages = element('chat-messages');
  const atBottom = messages.scrollHeight - messages.scrollTop - messages.clientHeight < 40;
  // Focus tracking refreshes panel state periodically; avoid disrupting chat controls.
  const signature = JSON.stringify(chat.messages);
  if (messages.dataset.signature === signature) { return; }
  messages.dataset.signature = signature; messages.replaceChildren();
  if (!chat.messages.length) {
    const starter = document.createElement('div'); starter.className = 'chat-starter';
    const title = document.createElement('h3'); title.className = 'chat-starter-title'; title.textContent = 'Ask Gemma About Your Code';
    const desc = document.createElement('p'); desc.className = 'chat-starter-desc'; desc.textContent = 'Explore architecture, find edge cases, or choose a prompt to start:';
    const chips = document.createElement('div'); chips.className = 'chat-chips';
    const prompts = [
      { label: '💡 Explain this file', prompt: 'Explain how this file works and summarize its key responsibilities.' },
      { label: '🔍 Find potential bugs', prompt: 'Analyze this code for subtle edge cases, potential bugs, or unhandled errors.' },
      { label: '🧪 Write unit tests', prompt: 'Write unit tests for the functions in this file covering normal and edge cases.' },
    ];
    for (const item of prompts) {
      const chip = document.createElement('button'); chip.type = 'button'; chip.className = 'chat-chip'; chip.textContent = item.label;
      chip.addEventListener('click', () => {
        const input = element('chat-question');
        if (input) {
          input.value = item.prompt;
          const fileCheck = element('chat-file'); if (fileCheck) { fileCheck.checked = true; }
          if (typeof input.focus === 'function') { input.focus(); }
        }
      });
      chips.append(chip);
    }
    starter.append(title, desc, chips); messages.append(starter);
  }
  for (const message of chat.messages) {
    const card = document.createElement('article'); card.className = 'chat-message';
    const label = document.createElement('strong'); label.textContent = message.role === 'user' ? 'You' : 'Gemma';
    const body = document.createElement('div'); renderChatMarkdown(body, message.text); card.append(label, body);
    if (message.role === 'assistant' && message.complete) {
      const copy = document.createElement('button'); copy.textContent = 'Copy';
      copy.addEventListener('click', () => send({ type: 'chatCopy', id: message.id })); card.append(copy);
      if (/```[^\n]*\n[\s\S]*?```/.test(message.text)) {
        const insert = document.createElement('button'); insert.textContent = 'Insert at cursor';
        insert.addEventListener('click', () => send({ type: 'chatInsert', id: message.id })); card.append(insert);
      }
    }
    messages.append(card);
  }
  if (atBottom) { messages.scrollTop = messages.scrollHeight; }
}
