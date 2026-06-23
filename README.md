# To-Do — Telegram Mini App

A minimalist, monochrome to-do list built as a Telegram Mini App. No backend,
no notifications, no dates — just a single editable list. Built with React +
TypeScript + Vite and plain CSS.

## Interaction

- One vertical list of rows: a checkbox on the left, a borderless text field on the right. Long text wraps onto new lines and the field grows to fit.
- **Enter** inserts a new empty task right after the current row and focuses it (the new row keeps the current row's indent).
- **Backspace** on an empty row deletes it and moves the caret to the end of the previous row (the last remaining row is never deleted).
- Subtasks (one level only): on desktop, **Tab** indents a row and **Shift+Tab** outdents it; on mobile, **swipe a task right** to indent and **left** to outdent.
- Clicking the checkbox toggles done; done tasks stay in the list, shown with a line-through, and remain editable.
- The whole list is stored as one value, capped at 4096 characters (Telegram CloudStorage's per-value limit). When the cap is reached, edits that would grow it are blocked and a subtle notice appears until you delete or shorten a task.

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
