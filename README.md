# To-Do — Telegram Mini App

A minimalist, monochrome to-do list built as a Telegram Mini App. No backend,
no notifications, no dates — just a single editable list. Built with React +
TypeScript + Vite and plain CSS.

## Interaction

- One vertical list of borderless text lines. Long text wraps onto new lines and each field grows to fit.
- Lines are **plain text by default** — no checkbox, just a note.
- Press the **☑ checkbox** control at the bottom to give the currently focused line a checkbox. It keeps your text and only ever turns the checkbox on.
- **Backspace at the very start** of a checkbox line removes the checkbox again (keeping the text) — delete the checkbox like you'd delete a character.
- Clicking a checkbox toggles done; done lines stay in the list, shown with a line-through, and remain editable.
- **Enter** inserts a new line right after the current one and focuses it; the new line keeps the same type (plain stays plain, checkbox stays checkbox).
- **Backspace on an empty line** deletes it and moves the caret to the end of the previous line (the last remaining line is never deleted).
- The whole list is stored as one compact value, capped at 4096 characters (Telegram CloudStorage's per-value limit). When the cap is reached, edits that would grow it are blocked and a subtle notice appears until you delete or shorten a line.

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
