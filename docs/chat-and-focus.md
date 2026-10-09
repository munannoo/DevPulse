# Chat and Focus

Reload the Extension Development Host after building, then open DevPulse.

## Chat

Choose the Chat tab and send a question. File and selection context are opt-in;
private environment/key files are excluded and detected secrets are redacted.
Use a selection for files larger than 24,000 characters. Selection context is
limited to 12,000 characters. Chat uses the configured self-hosted Gemma model.

Explain Selection, Fix Selection and Write Tests prepare a question with selection
context enabled. Check the options and click Send. Stop cancels the current reply;
Clear removes the in-memory conversation. Chat history is not persisted.

Replies stream with safe Markdown formatting. Complete lines are buffered before
redaction so partial credentials do not reach the panel. Copy copies the reply;
Insert at cursor inserts a complete fenced code block into the active workspace
file. It supports Undo and leaves saving/staging to you. Redacted placeholders
cannot be inserted. A truncated or cancelled reply has no insertion controls.

## Focus

Focus runs passively from editor and debug activity. It pauses after two idle
minutes or when the window loses focus. The Focus tab shows today's active minutes
and context switches. Daily totals persist in VS Code storage, retaining seven days.

The In Flow badge appears after 30 continuous active minutes. Change
`devpulse.focus.flowMinutes` to adjust the threshold. `devpulse.focus.shield` delays
DevPulse's automatic pull-reminder toasts until Flow ends; panel reminders remain
visible. Other extensions and applications are unaffected. Focus needs no LLM.
