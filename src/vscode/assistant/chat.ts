import * as vscode from 'vscode';
import { randomUUID } from 'node:crypto';
import { loadEditorConfig as loadConfig } from '../configuration';
import { createLlm, LlmError } from '../../core/llm/client';
import { chatPrompt } from '../../core/llm/prompts';
import { redact } from '../../core/security/redact';
import { chatContext, insertChatReply, ChatContextError } from './context';
import { isPanelMessage, type PanelMessage, type ChatState, type ChatMessage } from '../panel/messages';

export class Chat implements vscode.Disposable {
  private state: ChatState = { messages: [], busy: false, offline: false, status: 'Ask Gemma about your code.' };
  private editor = vscode.window.activeTextEditor;
  private operation?: AbortController;
  private readonly listeners: vscode.Disposable[] = [];
  onUpdate: () => void = () => {};
  constructor(private readonly context: vscode.ExtensionContext, private readonly output: vscode.OutputChannel) {
    this.listeners.push(vscode.window.onDidChangeActiveTextEditor(editor => { if (editor?.document.uri.scheme === 'file') { this.editor = editor; } }),
      vscode.commands.registerCommand('devpulse.chatSend', (value: unknown) => isPanelMessage(value) && value.type === 'chatSend' ? this.handle(value) : undefined),
      vscode.commands.registerCommand('devpulse.chatCancel', () => this.operation?.abort()),
      vscode.commands.registerCommand('devpulse.openChat', () => this.prepare('', false)),
      ...(['explainSelection', 'fixSelection', 'writeTests'] as const).map((name, index) => vscode.commands.registerCommand(`devpulse.${name}`,
        () => this.prepare(['Explain the selected code.', 'Suggest a fix for the selected code.', 'Write tests for the selected code.'][index], true))));
  }
  getState(): ChatState { return this.state; }
  private update(patch: Partial<ChatState>): void { this.state = { ...this.state, ...patch }; this.onUpdate(); }
  private prepare(text: string, includeSelection: boolean): void {
    this.update({ draft: { id: randomUUID(), text, includeSelection }, status: 'Review context options, then send.' });
    void vscode.commands.executeCommand('devpulse.openPanel').then(undefined, () => {});
  }
  async handle(message: PanelMessage): Promise<void> {
    if (message.type === 'chatCancel') { this.operation?.abort(); return; }
    if (message.type === 'chatClear') { this.operation?.abort(); this.update({ messages: [], status: 'Conversation cleared.' }); return; }
    if (message.type === 'chatSend') { await this.send(message); return; }
    if (message.type !== 'chatCopy' && message.type !== 'chatInsert') { return; }
    const reply = this.state.messages.find(item => item.id === message.id && item.role === 'assistant' && item.complete);
    if (!reply) { return; }
    try {
      if (message.type === 'chatCopy') { await vscode.env.clipboard.writeText(reply.text); this.update({ status: 'Reply copied.' }); }
      else { this.update({ status: await insertChatReply(this.editor, reply.text) ? 'Code inserted. Review and save when ready.' : 'No insertable code. Open a workspace file and choose a complete code block.' }); }
    } catch { this.update({ status: 'Could not complete this chat action. Check the active file.' }); }
  }
  private async send(message: Extract<PanelMessage, { type: 'chatSend' }>): Promise<void> {
    if (this.operation) { return; }
    if (!vscode.workspace.isTrusted) { this.update({ status: 'Trust this workspace to use Chat.' }); return; }
    const operation = new AbortController(); this.operation = operation;
    this.update({ busy: true, offline: false, status: 'Connecting to Gemma…' });
    try {
      const context = await chatContext(this.editor, message.includeFile, message.includeSelection);
      const settings = vscode.workspace.getConfiguration('devpulse.llm', this.editor?.document.uri);
      const config = await loadConfig({ scriptDirectory: this.context.extensionPath + '/dist',
        settings: { baseUrl: settings.get<string>('baseUrl'), model: settings.get<string>('model'), modelOverride: settings.get<string>('modelOverride') },
        secretApiKey: await this.context.secrets.get('devpulse.llm.apiKey') });
      operation.signal.throwIfAborted();
      const history = this.state.messages.filter(item => item.complete).slice(-6).map(item => ({ role: item.role, content: item.text }));
      const reply: ChatMessage = { id: randomUUID(), role: 'assistant', text: '', complete: false };
      this.update({ messages: [...this.state.messages.slice(-10), { id: randomUUID(), role: 'user', text: redact(message.text), complete: true }, reply], status: 'Gemma is replying…' });
      reply.text = await createLlm(config).stream({ system: chatPrompt, user: `${redact(message.text)}${context ? `\n\nExplicit context:\n${context}` : ''}`,
        history, signal: operation.signal, onText: text => { reply.text = text; this.onUpdate(); } });
      reply.complete = true; this.update({ status: 'Reply ready.' });
    } catch (error) {
      const status = operation.signal.aborted ? 'Chat cancelled.' : error instanceof LlmError || error instanceof ChatContextError
        ? error.message : 'Could not complete chat. Check Gemma configuration.';
      this.output.appendLine(status); this.update({ status, offline: error instanceof LlmError && error.offline });
    } finally { this.operation = undefined; this.update({ busy: false }); }
  }
  dispose(): void { this.operation?.abort(); this.onUpdate = () => {}; this.listeners.forEach(item => item.dispose()); }
}
