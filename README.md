# DevPulse
a coding assistant that reads new changes to github commits, analyses PRs, and more.

## Development scaffold

Generated using the official `yo code` TypeScript/esbuild template and extended
with the folder structure from `AGENTS.md`. Feature modules are placeholders;
Gemma integration, the sidebar, and Git hooks are not implemented yet.

```powershell
npm install
npm run build
node dist/cli.js --help
```

Open this folder in VS Code and press F5. In the Extension Development Host,
run **DevPulse: Hello World** from the Command Palette. Install the recommended
esbuild problem matcher extension if VS Code prompts for it.

```text
.vscode/                 Debug launch configuration and build tasks
src/
  extension.ts           VS Code activation entry point
  core/                  Shared logic; no vscode imports
    llm/                 Configuration, client, prompts, schemas, queue, cache
    git/                 Repository status and diff parsing
    security/            Secret scanning, redaction, and fixes
    review/              Shared findings engine
  vscode/
    panel/               Webview provider and message protocol
    features/            Welcome, left-off, reminders, reviews, focus, bridge
    assistant/           Inline completion and chat
    statusBar.ts         Status bar integration
  cli/index.ts           Standalone CLI entry point
  test/                  Generated extension test starter
media/                   Frontend HTML/CSS/JS, mascot, and gutter icons
test-repo/               Reserved for sample repository acceptance checks
esbuild.mjs              Builds dist/extension.js and dist/cli.js
```

`npm run watch` rebuilds bundles and watches TypeScript types. `npm run build`
runs type checking, linting, and a production build. Copy `.env.example` to
`.env` when implementing the LLM client; the scaffold does not load it yet.
