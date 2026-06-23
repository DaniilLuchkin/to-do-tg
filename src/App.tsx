import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
} from 'react'
import { loadRows, saveRows, serialize, type Row } from './storage'

// Telegram CloudStorage allows at most 4096 characters per value. We store the
// whole list as one (compact) JSON string under "todos", so the binding limit
// is the serialized length of that string.
const MAX_VALUE_LENGTH = 4096

function tooLong(rows: Row[]): boolean {
  return serialize(rows).length > MAX_VALUE_LENGTH
}

// Short, collision-resistant ids to keep the saved JSON small. A truncated
// base36 timestamp plus a per-session counter suffix (~7 chars).
let idCounter = 0
function newId(): string {
  const time = Date.now().toString(36).slice(-5)
  const seq = (idCounter++ % 1296).toString(36).padStart(2, '0')
  return time + seq
}

function createRow(checkbox = false): Row {
  return { id: newId(), text: '', checkbox, done: false }
}

// Reset a textarea to a single line then grow it to fit its content.
function autoGrow(el: HTMLTextAreaElement): void {
  el.style.height = 'auto'
  el.style.height = `${el.scrollHeight}px`
}

export default function App() {
  const [rows, setRows] = useState<Row[]>([])
  const [loaded, setLoaded] = useState(false)
  const [limitReached, setLimitReached] = useState(false)
  const [focusedId, setFocusedId] = useState<string | null>(null)

  // Always-current mirrors, so event handlers can read the latest committed
  // state synchronously when computing candidate next states.
  const rowsRef = useRef<Row[]>(rows)
  rowsRef.current = rows
  const focusedIdRef = useRef<string | null>(null)

  // Map of Row id -> textarea element, so we can move focus imperatively.
  const inputs = useRef<Map<string, HTMLTextAreaElement>>(new Map())
  // The id of the textarea that should receive focus after the next render,
  // and whether the caret should be placed at the end.
  const pendingFocus = useRef<{ id: string; caretEnd: boolean } | null>(null)

  // Initial load. Always guarantee at least one row to type into.
  useEffect(() => {
    let active = true
    loadRows().then((stored) => {
      if (!active) return
      setRows(stored.length > 0 ? stored : [createRow()])
      setLoaded(true)
    })
    return () => {
      active = false
    }
  }, [])

  // Debounced persistence (~400ms after the last change). The over-limit guard
  // lives at edit time, so this write can never exceed MAX_VALUE_LENGTH.
  useEffect(() => {
    if (!loaded) return
    const handle = window.setTimeout(() => {
      void saveRows(rows)
    }, 400)
    return () => window.clearTimeout(handle)
  }, [rows, loaded])

  // Apply any pending focus request once the DOM reflects the new list.
  useEffect(() => {
    const target = pendingFocus.current
    if (!target) return
    pendingFocus.current = null
    const el = inputs.current.get(target.id)
    if (!el) return
    el.focus()
    if (target.caretEnd) {
      const end = el.value.length
      el.setSelectionRange(end, end)
    }
  }, [rows])

  // Keep every textarea sized to its content after any state change.
  useEffect(() => {
    inputs.current.forEach((el) => autoGrow(el))
  }, [rows, limitReached])

  const registerInput = useCallback(
    (id: string) => (el: HTMLTextAreaElement | null) => {
      if (el) {
        inputs.current.set(id, el)
        autoGrow(el)
      } else {
        inputs.current.delete(id)
      }
    },
    []
  )

  const handleFocus = useCallback((id: string) => {
    focusedIdRef.current = id
    setFocusedId(id)
  }, [])

  const handleBlur = useCallback((id: string) => {
    if (focusedIdRef.current === id) {
      focusedIdRef.current = null
      setFocusedId(null)
    }
  }, [])

  // Editing a row's text. Growing past the limit is rejected: the textarea is
  // reverted in place and the notice is shown. Anything else is applied.
  const handleChange = useCallback(
    (id: string, event: ChangeEvent<HTMLTextAreaElement>) => {
      const value = event.target.value
      const base = rowsRef.current
      const candidate = base.map((row) =>
        row.id === id ? { ...row, text: value } : row
      )
      if (tooLong(candidate)) {
        const current = base.find((row) => row.id === id)
        event.target.value = current ? current.text : ''
        autoGrow(event.target)
        setLimitReached(true)
        return
      }
      setLimitReached(false)
      setRows(candidate)
      autoGrow(event.target)
    },
    []
  )

  // Clicking the checkbox toggles done (checkbox rows only). Always allowed so
  // the user can keep managing the list even near the cap.
  const toggleDone = useCallback((id: string) => {
    setLimitReached(false)
    setRows((prev) =>
      prev.map((row) =>
        row.id === id ? { ...row, done: !row.done } : row
      )
    )
  }, [])

  // The bottom control: give the currently focused row a checkbox (text and
  // caret preserved). Only ever turns the checkbox on.
  const addCheckboxToFocused = useCallback(() => {
    const id = focusedIdRef.current
    if (!id) return
    const base = rowsRef.current
    const row = base.find((r) => r.id === id)
    if (!row || row.checkbox) return
    const candidate = base.map((r) =>
      r.id === id ? { ...r, checkbox: true } : r
    )
    if (tooLong(candidate)) {
      setLimitReached(true)
      return
    }
    setLimitReached(false)
    setRows(candidate)
    inputs.current.get(id)?.focus()
  }, [])

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>, id: string) => {
      const base = rowsRef.current
      const index = base.findIndex((row) => row.id === id)
      if (index === -1) return

      // Enter (without Shift) inserts a new row after this one, inheriting its
      // type. Shift+Enter falls through to a newline (gated via handleChange).
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault()
        const next = createRow(base[index].checkbox)
        const candidate = base.slice()
        candidate.splice(index + 1, 0, next)
        if (tooLong(candidate)) {
          setLimitReached(true)
          return
        }
        setLimitReached(false)
        setRows(candidate)
        pendingFocus.current = { id: next.id, caretEnd: false }
        return
      }

      if (event.key === 'Backspace') {
        const el = event.currentTarget

        // Empty row → delete it entirely and focus the previous row. The last
        // remaining row is never deleted.
        if (el.value === '') {
          event.preventDefault()
          if (base.length <= 1) return
          if (index <= 0) return
          pendingFocus.current = { id: base[index - 1].id, caretEnd: true }
          setLimitReached(false)
          setRows(base.filter((row) => row.id !== id))
          return
        }

        // Caret at the very start of a non-empty checkbox row → remove the
        // checkbox (keep the text), per "delete the checkbox like text".
        const atStart = el.selectionStart === 0 && el.selectionEnd === 0
        if (atStart && base[index].checkbox) {
          event.preventDefault()
          setLimitReached(false)
          setRows(
            base.map((row) =>
              row.id === id ? { ...row, checkbox: false, done: false } : row
            )
          )
          return
        }
        // Otherwise: a normal character delete — let the default happen.
      }
    },
    []
  )

  return (
    <main className="app">
      <ul className="list">
        {rows.map((row) => (
          <li className="row" key={row.id}>
            {row.checkbox && (
              <button
                key="checkbox"
                type="button"
                className={`checkbox${row.done ? ' checked' : ''}`}
                aria-pressed={row.done}
                aria-label={row.done ? 'Mark as not done' : 'Mark as done'}
                onClick={() => toggleDone(row.id)}
              >
                {row.done ? '✓' : ''}
              </button>
            )}
            <textarea
              key="text"
              ref={registerInput(row.id)}
              className={`text${row.checkbox && row.done ? ' done' : ''}`}
              rows={1}
              value={row.text}
              placeholder="New task"
              onChange={(event) => handleChange(row.id, event)}
              onKeyDown={(event) => handleKeyDown(event, row.id)}
              onFocus={() => handleFocus(row.id)}
              onBlur={() => handleBlur(row.id)}
            />
          </li>
        ))}
      </ul>

      {limitReached && (
        <p className="notice">
          Storage limit reached — delete or shorten a task to continue.
        </p>
      )}

      <div className="toolbar">
        <button
          type="button"
          className="add-checkbox"
          aria-label="Give the current line a checkbox"
          disabled={focusedId === null}
          // Keep the textarea focused (and its caret) when pressing this.
          onPointerDown={(event) => event.preventDefault()}
          onMouseDown={(event) => event.preventDefault()}
          onClick={addCheckboxToFocused}
        >
          ☑ checkbox
        </button>
      </div>
    </main>
  )
}
