import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import type { ChatState, PanelMessage } from '../../vscode/panel/messages';

class Element {
  children: Element[] = []; textContent = ''; dataset: Record<string, string> = {};
  value = ''; checked = false; disabled = false; hidden = false;
  handlers: Record<string, () => void> = {};
  constructor(readonly tag: string) {}
  append(...children: Element[]): void { this.children.push(...children); }
  replaceChildren(): void { this.children = []; }
  addEventListener(name: string, callback: () => void): void { this.handlers[name] = callback; }
}
test('Chat Markdown keeps HTML and command links literal, and actions send only reply IDs', async () => {
  const elements = new Map<string, Element>();
  const element = (id: string) => { if (!elements.has(id)) { elements.set(id, new Element('div')); } return elements.get(id)!; };
  const source = await readFile(resolve('media/chat.js'), 'utf8');
  const renderer = runInNewContext(source + '\n({markdown: renderChatMarkdown, chat: renderChat})', {
    element, selectTab: () => {}, document: { createElement: (tag: string) => new Element(tag),
      createTextNode: (text: string) => Object.assign(new Element('text'), { textContent: text }) },
  }) as { markdown(target: Element, text: string): void; chat(state: { chat: ChatState }, send: (message: PanelMessage) => void): void };
  const target = new Element('div');
  renderer.markdown(target, '# Header\n**Bold** and `code`\n<img src=x onerror=alert(1)>\n[Run](command:evil)\n```ts\nconst value = 1;\n```');
  const flatten = (node: Element): Element[] => [node, ...node.children.flatMap(flatten)];
  const nodes = flatten(target);
  assert.ok(!nodes.some(node => ['img', 'script', 'a'].includes(node.tag)));
  assert.ok(nodes.some(node => node.tag === 'pre' && node.textContent.includes('const value')));
  const sent: PanelMessage[] = [];
  renderer.chat({ chat: { busy: false, offline: false, status: 'Ready', messages: [{ id: 'reply-id', role: 'assistant',
    text: '```ts\nexport {};\n```', complete: true }] } }, message => sent.push(message));
  const buttons = flatten(element('chat-messages')).filter(node => node.tag === 'button');
  buttons.forEach(button => button.handlers.click());
  assert.deepEqual(JSON.parse(JSON.stringify(sent)), [{ type: 'chatCopy', id: 'reply-id' }, { type: 'chatInsert', id: 'reply-id' }]);
  const chat: ChatState = { busy: false, offline: false, status: 'Ready', messages: [] };
  element('chat-question').value = 'Retry this question';
  renderer.chat({ chat: { ...chat, busy: true } }, () => {});
  renderer.chat({ chat: { ...chat, status: 'Chat cancelled.' } }, () => {});
  assert.equal(element('chat-question').value, 'Retry this question');
  renderer.chat({ chat: { ...chat, busy: true } }, () => {});
  renderer.chat({ chat: { ...chat, status: 'Reply ready.' } }, () => {});
  assert.equal(element('chat-question').value, '');
});
