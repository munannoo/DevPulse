// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from "vscode";
import { CodeReview } from './vscode/features/codeReview';
import { PanelProvider } from './vscode/panel/PanelProvider';
import { createStatusBar, updateStatusBar } from './vscode/statusBar';

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

  const output = vscode.window.createOutputChannel('DevPulse');
  const review = new CodeReview(context, output);
  const panel = new PanelProvider(context.extensionUri, () => review.getState(), message => review.handle(message), output);
  const statusBar = createStatusBar();
  review.onUpdate = () => { panel.update(); updateStatusBar(statusBar, review.getState()); };
  context.subscriptions.push(output, review, panel, statusBar,
    vscode.window.registerWebviewViewProvider('devpulse.panel', panel),
    vscode.workspace.onDidChangeWorkspaceFolders(() => { void review.refreshBranch(); }),
  );
  // Render first; Git status loads in the background. LLM review is explicitly invoked.
  void review.refreshBranch().catch(() => output.appendLine('Initial branch check could not complete.'));
  return { getReviewState: () => review.getState() };
}

// This method is called when your extension is deactivated
export function deactivate() {}
