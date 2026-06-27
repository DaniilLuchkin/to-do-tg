import { useCallback, useState } from 'react'
import Sheet from './Sheet'
import { parseSharedNote } from './share'
import type { Row } from './storage'

type PasteSharedProps = {
  onClose: () => void
  onReceived: (rows: Row[]) => void
}

// Pull the base64url payload out of a pasted share link (…?startapp=PAYLOAD),
// or accept a bare payload string.
function extractPayload(input: string): string | null {
  const text = input.trim()
  if (!text) return null
  const fromLink = text.match(/[?&]startapp=([A-Za-z0-9_-]+)/)
  if (fromLink) return fromLink[1]
  if (/^[A-Za-z0-9_-]+$/.test(text)) return text
  return null
}

export default function PasteShared({ onClose, onReceived }: PasteSharedProps) {
  const [value, setValue] = useState('')
  const [error, setError] = useState(false)

  const submit = useCallback(() => {
    const payload = extractPayload(value)
    const rows = payload ? parseSharedNote(payload) : null
    if (!rows) {
      setError(true)
      return
    }
    onReceived(rows)
  }, [value, onReceived])

  return (
    <Sheet onClose={onClose} ariaLabel="Paste shared note">
      <p className="sheet-title">Paste shared note</p>
      <p className="sheet-text">
        Paste a To-Do Notes share link (or its code) to add it as a new note.
      </p>
      <textarea
        className="paste-input"
        rows={3}
        placeholder="https://t.me/…?startapp=…"
        value={value}
        onChange={(e) => {
          setValue(e.target.value)
          if (error) setError(false)
        }}
      />
      {error && <p className="notice">Couldn't read a shared note from that.</p>}
      <div className="sheet-actions">
        <button type="button" className="btn" onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          className="btn btn-primary"
          disabled={value.trim() === ''}
          onClick={submit}
        >
          Add note
        </button>
      </div>
    </Sheet>
  )
}
