import { useEffect, useRef } from 'react'
import IconButton from './IconButton'
import { HAS_BACK_BUTTON } from './telegram-ui'

type HelpProps = {
  onClose: () => void
}

export default function Help({ onClose }: HelpProps) {
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  // Telegram BackButton while Help is open; restore on close.
  useEffect(() => {
    const wa = window.Telegram?.WebApp
    wa?.BackButton?.show?.()
    const cb = () => onCloseRef.current()
    wa?.BackButton?.onClick?.(cb)
    return () => {
      wa?.BackButton?.offClick?.(cb)
      wa?.BackButton?.hide?.()
    }
  }, [])

  return (
    <main className="app help">
      {!HAS_BACK_BUTTON && (
        <div className="topbar">
          <div className="bar-actions">
            <IconButton icon="chevron-left" label="Close help" onClick={onClose} />
          </div>
        </div>
      )}

      <h1 className="help-title">How to use To-Do Notes</h1>

      <section className="help-section">
        <h2>Lines &amp; checkboxes</h2>
        <ul>
          <li>Type to add a line. Press Enter to start the next one.</li>
          <li>
            Tap ✅ to turn the current line into a checkbox. Tap ✅ again to turn
            it back into plain text.
          </li>
          <li>Tap a checkbox to mark it done (the text gets a line-through).</li>
        </ul>
      </section>

      <section className="help-section">
        <h2>Editing with swipes</h2>
        <ul>
          <li>Swipe a line right to indent it (make it a sub-item).</li>
          <li>Swipe a little left to outdent it.</li>
          <li>Swipe far left to delete the line.</li>
        </ul>
      </section>

      <section className="help-section">
        <h2>Moving &amp; undoing</h2>
        <ul>
          <li>
            Use the reorder handle (or reorder mode on mobile) to move lines up
            and down.
          </li>
          <li>
            ↩️ undoes your last change. On a computer you can also press
            Cmd/Ctrl+Z.
          </li>
        </ul>
      </section>

      <section className="help-section">
        <h2>Notes</h2>
        <ul>
          <li>
            You can keep multiple notes. The first line of a note becomes its
            title in the list.
          </li>
          <li>Open a note to edit it; use back to return to the list.</li>
          <li>
            Each note holds up to 4096 bytes. The counter shows how much you've
            used.
          </li>
        </ul>
      </section>

      <section className="help-section">
        <h2>Sharing</h2>
        <ul>
          <li>
            Tap the share icon in a note to send it to a Telegram chat. Small
            notes go as a link the other person can open and save here; longer
            notes are shared as plain text.
          </li>
          <li>
            Open someone's shared link and To-Do Notes offers to save it as a
            new note (up to the 50-note limit).
          </li>
        </ul>
      </section>

      <section className="help-section">
        <h2>Your data</h2>
        <ul>
          <li>
            Everything is saved to your Telegram account automatically — it
            syncs across your devices.
          </li>
          <li>
            📋 copies the whole note as plain text, so you always have a backup.
          </li>
        </ul>
      </section>

      <section className="help-section">
        <h2>Support</h2>
        <ul>
          <li>
            To-Do Notes is free. If it helps you, you can support development
            with a small tip in Telegram Stars ❤️ (see the ♡ option).
          </li>
        </ul>
      </section>
    </main>
  )
}
