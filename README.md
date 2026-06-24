# To-Do — Telegram Mini App

A minimalist, monochrome to-do list built as a Telegram Mini App. No backend,
no notifications, no dates — just a single editable list. Built with React +
TypeScript + Vite and plain CSS.

## Interaction

- One vertical list of borderless text lines. Long text wraps onto new lines and each field grows to fit.
- Lines are **plain text by default** — no checkbox, just a note.
- Press the **✅ button** in the bottom-right corner to toggle the currently focused line between plain text and a checkbox (keeping your text); turning the checkbox off also clears its done state.
- Clicking a checkbox toggles done; done lines stay in the list, shown with a line-through, and remain editable.
- **Subtasks (one level):** swipe a line **right to indent** and **left to outdent** on mobile (drag with the mouse on desktop). Indented lines are shifted right; both plain and checkbox lines can be indented.
- **Enter** inserts a new line right after the current one and focuses it; the new line keeps the same type and indent (plain stays plain, checkbox stays checkbox).
- **Backspace at the start of a line:** on a checkbox line it removes the checkbox (keeping the text); on an empty plain line it deletes the line and moves the caret to the end of the previous line (the last remaining line is never deleted). So Backspace on an empty checkbox line removes the checkbox first, then a second Backspace deletes the line.
- **Undo:** press **Cmd/Ctrl+Z** or the **↶** button in the bottom bar to undo the last change (create, delete, checkbox/indent change, reorder, or import). Text edits undo a burst at a time. History is in-memory only and resets on reload.
- **Export / Import:** **Export** copies the whole list to the clipboard as plain text (`- [ ] task`, `- [x] done`, two leading spaces for an indented line; if the clipboard is unavailable, a panel shows the text to copy manually). **Import** opens a panel where you paste plain text in the same format; importing **replaces** the entire list (a backup-restore), and is reversible with Undo. An import that would exceed 4096 bytes is rejected.
- **Reorder:** on desktop, hover a line and drag its **⠿** handle. On mobile, tap the **⠿** button in the bottom bar to enter reorder mode (handles appear, editing pauses), then drag lines; tap it again to exit. Each line keeps its own indent.
- The whole list is stored as one compact value, capped at 4096 bytes (Telegram CloudStorage's per-value limit). A small **`used/4096 B` counter** in the bottom bar shows the UTF-8 bytes used; when the cap is reached, edits that would grow it are blocked and a subtle notice appears until you delete or shorten a line.

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
