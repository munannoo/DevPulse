// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from "vscode";
import { CodeReview } from './vscode/features/codeReview';
import { PanelProvider } from './vscode/panel/PanelProvider';
import { createStatusBar, updateStatusBar } from './vscode/statusBar';
import { registerPrecommit } from './vscode/features/precommitBridge';
import { LeftOff } from './vscode/features/leftOff';
import { PullReminder, pullReminder } from './vscode/features/reminder';
import { Welcome } from './vscode/features/welcome';
import { Focus } from './vscode/features/focus';
import { Chat } from './vscode/assistant/chat';
import { PullRequests } from './vscode/features/prReview';
import { registerInlineCompletion } from './vscode/assistant/inlineCompletion';
import { registerModelPicker } from './vscode/assistant/modelPicker';
import { writeFile } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
  // Use the console to output diagnostic information (console.log) and errors (console.error)
  // This line of codee will only be executed once when your extension is activated
  console.log('Congratulations, your extension "devpulse" is now active!');

  // The command has been defined in the package.json file
  // Now provide the implementation of the command with registerCommand
  // The commandId parameter must match the command field in package.json
  const disposable = vscode.commands.registerCommand(
    "devpulse.helloWorld",
    () => {
      // The code you place here will be executed every time your command is executed
      // Display a message box to the user
      vscode.window.showInformationMessage("Hello World from Gemma DevPulse!");
    },
  );

  context.subscriptions.push(disposable);
  registerPrecommit(context);

  const output = vscode.window.createOutputChannel('DevPulse');
  const review = new CodeReview(context, output);
  const focus = new Focus(context, output);
  const chat = new Chat(context, output);
  const leftOff = new LeftOff(context, output);
  const reminder = new PullReminder(() => review.refreshBranch(), output, () => {
    const state = focus.getState(); return state.shield && state.inFlow;
  });
  const welcome = new Welcome(context, output);
  const getState = () => ({ ...review.getState(), leftOff: leftOff.getState(), pullReminder: pullReminder(review.getState().branch),
    pullRequests: pullRequests.getState(), welcome: welcome.getState(), focus: focus.getState(), chat: chat.getState(),
    offline: review.getState().offline || welcome.getState().offline || chat.getState().offline || Boolean(pullRequests.getState().offline) });
  const pull = async () => {
    const state = review.getState();
    if (state.phase === 'checking' || state.phase === 'reviewing' || !state.branch) { return; }
    await welcome.pull(state.branch, async () => {
      const deadline = Date.now() + 20_000;
      while (review.getState().phase === 'checking' && Date.now() < deadline) {
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      await review.refreshBranch();
      return review.getState().phase === 'idle' ? review.getState().branch : undefined;
    });
  };
  const pullRequests = new PullRequests(context, output);
  const reportReady = async () => {
    if (context.extensionMode !== vscode.ExtensionMode.Development) { return; }
    const readyFile = process.env.DEVPULSE_DEV_HOST_READY_FILE;
    if (!readyFile) { return; }
    const profiles = resolve(context.extensionPath, '.vscode-test', 'dev-hosts');
    const target = relative(profiles, resolve(readyFile));
    if (target.startsWith(`..${sep}`) || target === '..' || isAbsolute(target) || !target.endsWith(`${sep}devpulse-ready.json`)) { return; }
    await writeFile(readyFile, JSON.stringify({ extensionPath: context.extensionPath, panelVisible: true }), 'utf8');
  };
  const panel = new PanelProvider(context.extensionUri, getState, message => message.type === 'resumeWork' ? leftOff.resume()
    : message.type === 'pullAndSync' ? pull() : message.type.startsWith('chat') ? chat.handle(message) : message.type === "connectGitHub" || message.type === "refreshPullRequests" || message.type === "reviewPullRequest" || message.type === "cancelPullReview" || message.type === "openPullFinding" ? pullRequests.handle(message) : review.handle(message), output, reportReady);
  const statusBar = createStatusBar();
  review.onUpdate = () => {
    panel.update(); updateStatusBar(statusBar, getState());
    if (review.getState().phase === 'idle') {
      const branch = review.getState().branch;
      reminder.observe(branch);
      if (branch) { void welcome.visit(branch).catch(() => output.appendLine('Could not prepare the welcome summary.')); }
    }
  };
  pullRequests.onUpdate = () => panel.update();
  leftOff.onUpdate = () => panel.update();
  welcome.onUpdate = () => panel.update();
  focus.onUpdate = () => { panel.update(); updateStatusBar(statusBar, getState()); reminder.flush(); };
  chat.onUpdate = () => panel.update();
  let lastBranch: string | undefined;
  const updateReview = review.onUpdate;
  review.onUpdate = () => {
    updateReview();
    const branch = review.getState().branch?.branch;
    if (branch !== lastBranch) { lastBranch = branch; leftOff.schedule(); focus.observeBranch(branch); }
  };
  context.subscriptions.push(output, review, pullRequests, ...pullRequests.registerCommands(), leftOff, reminder, welcome, focus, chat, panel, statusBar,
    vscode.window.registerWebviewViewProvider('devpulse.panel', panel),
    vscode.commands.registerCommand('devpulse.openPanel', () => vscode.commands.executeCommand('devpulse.panel.focus')),
    vscode.commands.registerCommand('devpulse.pullAndSync', pull),
    vscode.commands.registerCommand('devpulse.toggleInlineCompletion', async () => {
      const config = vscode.workspace.getConfiguration('devpulse.assistant.inline');
      const current = config.get<boolean>('enabled', true);
      await config.update('enabled', !current, vscode.ConfigurationTarget.Global);
      vscode.window.showInformationMessage(`DevPulse Inline Autocomplete ${!current ? 'enabled' : 'disabled'}.`);
    }),
    registerInlineCompletion(context, output),
    registerModelPicker(context, output),
    vscode.workspace.onDidChangeWorkspaceFolders(() => { void review.refreshBranch(); }),
  );
  // Render first; Git status loads in the background. LLM review is explicitly invoked.
  void review.refreshBranch().catch(() => output.appendLine('Initial branch check could not complete.'));
  void leftOff.restore().catch(() => output.appendLine('Could not restore editing context.'));
  void pullRequests.refresh().catch(() => output.appendLine('Initial requested PR check could not complete.'));
  if (context.extensionMode === vscode.ExtensionMode.Development) {
    void vscode.commands.executeCommand('devpulse.openPanel').then(undefined, () => output.appendLine('Open DevPulse with the Open Panel command.'));
  }
  return { getReviewState: getState, isPanelVisible: () => panel.isVisible() };
}

// This method is called when your extension is deactivated
export function deactivate() {}
