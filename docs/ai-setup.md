# Set up Ollama and models

DevPulse is local-first and self-hostable. Its AI features need a running
OpenAI-compatible server and an installed model. Git status, focus tracking and
regex secret scanning still work when the AI server is unavailable.

## 1. Install Ollama

Download the installer for your operating system from
[Ollama's official download page](https://ollama.com/download).
On Windows, run the installer, start Ollama, then open a new PowerShell terminal.

```text
ollama --version
```

If the command is missing, restart VS Code and its terminals after installation.
Ollama normally runs in the background on Windows. If it is not running, start
the Ollama app. For a manual server, run `ollama serve` in a separate terminal;
leave that terminal open. An “address already in use” message can mean the app
is already serving on port 11434.

## 2. Download a model

Start with Gemma 4 E2B, a smaller model suited to trying autocomplete:

```text
ollama pull gemma4:e2b
ollama list
ollama run gemma4:e2b
```

Send a short message to confirm it answers; type `/bye` to leave the model chat.
The download may take several minutes. Speed and memory needs depend on your
hardware. Larger models can be much slower on a CPU.

| Model | Try it for | Download command |
| --- | --- | --- |
| `gemma4:e2b` | A smaller starting point and inline suggestions | `ollama pull gemma4:e2b` |
| `gemma4:e4b` | Review and chat; DevPulse's default | `ollama pull gemma4:e4b` |
| Another model | An alternative supported by your server | `ollama pull <exact-model-tag>` |

Check the [official Gemma model tags](https://ollama.com/library/gemma4)
or [Ollama model library](https://ollama.com/library) before downloading.
Use the exact installed name shown by `ollama list`. Selecting a name in DevPulse
does not download the model. This guide never installs software automatically.

## 3. Connect DevPulse

Open **DevPulse: Open Settings** from the Command Palette or the panel's gear.

1. Set **Llm: Base Url** to `http://localhost:11434/v1` for local Ollama.
2. Set **Llm: Model** to your downloaded model, such as `gemma4:e2b`.
3. Run **DevPulse: Check AI Connection** to verify reachability and model presence.
4. Run **DevPulse: Analyze File** on a small file to try a review.

You can also use **DevPulse: Select Model (Review & Chat)**. This explicit editor
selection overrides the normal model setting; clear it to restore configuration
precedence. Process environment, then workspace `.env`, then VS Code settings
determine the normal host/model. If a settings change seems ignored, check these
overrides. CLI commands keep environment/`.env` precedence.

For a LAN or cloud OpenAI-compatible endpoint, enter its base URL including the
API prefix (often `/v1`) and its exact available model identifier. Use
**DevPulse: Set API Key** when authentication is needed; entered keys go into
VS Code secret storage. Local Ollama normally needs no API key.

## 4. Enable faster inline suggestions

Enable **Assistant › Inline: Enabled** and VS Code's **Editor › Inline Suggest:
Enabled**. Use **DevPulse: Select Autocomplete Model** to select `gemma4:e2b`,
or set **Assistant › Inline: Model** to that exact installed name. It can differ
from the review/chat model. Empty restores the effective review/chat model.

Open a code file, start a function, pause typing, and accept ghost text with Tab.
Copilot is not required. A smaller model may respond faster, but the first request
can take longer while Ollama loads it into memory.

## Troubleshooting

- **Server unreachable:** start Ollama, check the host and port, then run the
  connection check again. `http://localhost:11434/v1` is the API base, not `/api`.
- **Model missing:** run `ollama list`, download the exact tag, then select it.
- **Slow or timed-out suggestions:** try a smaller installed model, close other
  memory-heavy apps, and test it directly with `ollama run`.
- **HTTP errors from a remote server:** check its OpenAI compatibility, API prefix,
  available models and authentication requirements.

Official references: [Windows setup](https://docs.ollama.com/windows) and
[OpenAI-compatible API](https://docs.ollama.com/api/openai-compatibility).
