# To-Do — Telegram Mini App

A minimalist notes app built as a Telegram Mini App. No backend, no
notifications, no dates — multiple notes, each an editable checklist. Built
with React + TypeScript + Vite and plain CSS.

The UI is theme-driven: colors come from Telegram's `themeParams` (with
light/dark fallbacks), and a **single accent** color is used only for the
create button, the checkbox toggle/fill, links, and the drag insertion line.
All controls use a consistent set of **monochrome line icons** (inline SVG,
`stroke=currentColor`) via one reusable icon-button component; emoji appear
only in body/help prose.

On startup the app **expands to full height and locks vertical-swipe-to-collapse
(Wallet-style)**, so swiping app content never minimizes it — minimize by pulling
the native Telegram header. (No-ops in a plain browser / on older clients.)

## Notes list

- The home screen is a list of **notes**; each note's title is the text of its **first line** (Apple Notes style). An empty first line shows a muted **"New note"** label.
- **Tap** a note to open it; the **plus** button (bottom-right, the one filled accent control) creates a new note and opens it.
- The header shows the **Notes** title with an **N notes** count, and a right-hand cluster with the **reorder** and **menu** buttons. The menu is a detached dropdown (a `--surface` panel below the menu button, with a full-screen scrim that taps or the Telegram back button to close). Its rows — each with a leading mono icon — are **About** (app/schema version), **Donate** (heart), **Help**, **Export all notes** / **Import all notes** (download/upload a JSON backup — import replaces everything, with a confirm and an automatic pre-import backup), **Add to home screen** (best-effort; not available on every device), and a disabled **More — coming soon** placeholder.
- **Reorder notes:** on desktop, hover a note and drag its **⠿** handle; on mobile, tap the **reorder** button in the header to enter reorder mode, then drag.
- **Delete a note:** swipe it **far left**, then confirm (**Cancel / Delete**).
- You can keep up to **50 notes**; at the cap, **"Note limit reached (50)."** appears and ➕ is disabled.
- **Your data is protected.** Storage is a versioned index (`idx`, schema-versioned) plus one content value per note (`n_<id>`). On launch the app loads before it ever writes (so an empty initial state can't overwrite real data), runs explicit migrations for older schemas after copying everything to `bak_*` backup keys, refuses to overwrite real data with an empty/unrecognized value, and shows a non-destructive error rather than wiping data it can't parse. The old single list is migrated to the first note on first launch.

## Editor (one note)

- A fixed **top action bar** holds the action icons on the left — **undo**, **reorder rows**, **copy** — and the per-note **`used/4096 B` counter** (right-aligned, in the hint color). An in-app **back** chevron only appears in the browser fallback; inside Telegram the native back button is used instead. The **checkbox-toggle** button (an accent square with a check icon) is the only control at the **bottom-right** (next to the keyboard). Text never slides under either bar, and the caret stays visible as a line wraps or on Enter.
- When you open an empty note, the first line shows a faint **"Tap here to write"** hint (tapping it focuses the line and raises the keyboard); it disappears as soon as you type.
- One vertical list of borderless text lines. Long text wraps onto new lines and each field grows to fit.
- Lines are **plain text by default** — no checkbox, just a note. The back chevron (or the Telegram back button) returns to the notes list, saving the note.
- The **checkbox-toggle** button toggles the currently focused line between plain text and a checkbox (keeping your text); turning the checkbox off also clears its done state.
- Clicking a checkbox toggles done; done lines stay in the list, shown with a line-through, and remain editable.
- **Subtasks (one level):** swipe a line **right to indent** and **left a short distance to outdent** (drag with the mouse on desktop). Swipe **left far to delete** the line (the row fades with an ✕ cue; Undo restores it). Indented lines are shifted right; both plain and checkbox lines can be indented.
- **Enter** inserts a new line right after the current one and focuses it; the new line keeps the same type and indent (plain stays plain, checkbox stays checkbox).
- **Backspace at the start of a line:** on a checkbox line it removes the checkbox (keeping the text); on an empty plain line it deletes the line and moves the caret to the end of the previous line (the last remaining line is never deleted). So Backspace on an empty checkbox line removes the checkbox first, then a second Backspace deletes the line.
- **Undo** (or **Cmd/Ctrl+Z**) reverts the last change (create, delete, checkbox/indent change, or reorder). Text edits undo a burst at a time. Undo history is **per note**, in-memory only, and clears when you leave the note.
- **Copy:** copies the current note to the clipboard as plain text (`- [ ] task`, `- [x] done`, two leading spaces for an indented line; if the clipboard is blocked, a panel shows the text to copy manually) — a simple backup you can paste anywhere.
- **Reorder rows:** on desktop, hover a line and drag its **⠿** handle; on mobile, tap the **reorder** button to enter reorder mode (handles appear, editing pauses), then drag lines; tap again to exit. Each line keeps its own indent. Dragging suspends Telegram's vertical swipe-to-minimize, so the app won't collapse while you reorder.
- Each note is stored as one compact value, capped at **4096 bytes** (Telegram CloudStorage's per-value limit). The **`used/4096 B` counter** shows the UTF-8 bytes used (and emphasizes when nearly full). **Typing stops at the limit:** once full, keystrokes/pastes and other growing edits are blocked and a **"Storage full — delete or shorten a line."** notice appears; deleting or shortening always works so you can recover.

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
