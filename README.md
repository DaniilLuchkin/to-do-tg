# To-Do — Telegram Mini App

A minimalist, monochrome to-do list built as a Telegram Mini App. No backend,
no notifications, no dates — just a single editable list. Built with React +
TypeScript + Vite and plain CSS.

## Interaction

- One vertical list of borderless text lines. Long text wraps onto new lines and each field grows to fit.
- Lines are **plain text by default** — no checkbox, just a note.
- A fixed **bottom-right cluster** of emoji buttons holds all actions, left→right: **↩️** undo, **📋** copy, **↕️** reorder, **✅** checkbox. The **`used/4096 B` counter** sits just above it.
- **✅** toggles the currently focused line between plain text and a checkbox (keeping your text); turning the checkbox off also clears its done state.
- Clicking a checkbox toggles done; done lines stay in the list, shown with a line-through, and remain editable.
- **Subtasks (one level):** swipe a line **right to indent** and **left a short distance to outdent** (drag with the mouse on desktop). Swipe **left far to delete** the line (the row fades with an ✕ cue; Undo restores it). Indented lines are shifted right; both plain and checkbox lines can be indented.
- **Enter** inserts a new line right after the current one and focuses it; the new line keeps the same type and indent (plain stays plain, checkbox stays checkbox).
- **Backspace at the start of a line:** on a checkbox line it removes the checkbox (keeping the text); on an empty plain line it deletes the line and moves the caret to the end of the previous line (the last remaining line is never deleted). So Backspace on an empty checkbox line removes the checkbox first, then a second Backspace deletes the line.
- **↩️ Undo** (or **Cmd/Ctrl+Z**) reverts the last change (create, delete, checkbox/indent change, or reorder). Text edits undo a burst at a time. History is in-memory only and resets on reload.
- **📋 Copy:** copies the whole list to the clipboard as plain text (`- [ ] task`, `- [x] done`, two leading spaces for an indented line; if the clipboard is blocked, a panel shows the text to copy manually) — a simple backup you can paste anywhere.
- **↕️ Reorder:** on desktop, hover a line and drag its **⠿** handle. On mobile, tap **↕️** to enter reorder mode (handles appear, editing pauses), then drag lines; tap again to exit. Each line keeps its own indent. Dragging suspends Telegram's vertical swipe-to-minimize, so the app won't collapse while you reorder.
- The whole list is stored as one compact value, capped at 4096 bytes (Telegram CloudStorage's per-value limit). The **`used/4096 B` counter** shows the UTF-8 bytes used. **Typing stops at the limit:** once full, keystrokes/pastes and other growing edits are blocked and a **"Storage full — delete or shorten a line."** notice appears; deleting or shortening always works so you can recover.

## Develop & build

```bash
npm install
npm run dev      # runs in a normal browser using the localStorage fallback
npm run build    # type-checks and builds to ./dist
npm run preview  # serves the production build locally
```

`npm run dev` works in any browser: when Telegram's `CloudStorage` is not
available, the app falls back to `localStorage`, so it is fully runnable and
previewable outside Telegram.

## Using it as a real Telegram Mini App

Run `npm run build` and host the contents of `./dist` over **HTTPS**. Open
[@BotFather](https://t.me/BotFather), and set that URL as your bot's Mini App
URL (via the bot's menu button or `/newapp`). Open the Mini App from the bot to
launch it. Real per-user persistence via `CloudStorage` only works inside
Telegram — in a plain browser the app uses `localStorage` instead.
