import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { loadRows, saveRows, serialize, type Row } from './storage'

// Telegram CloudStorage allows at most 4096 characters per value. We store the
// whole list as one (compact) JSON string under "todos", so the binding limit
// is the serialized length of that string.
const MAX_VALUE_LENGTH = 4096

// Horizontal travel (px) a swipe must exceed to commit an indent/outdent.
const SWIPE_COMMIT_PX = 48

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

function createRow(checkbox = false, level: 0 | 1 = 0): Row {
  return { id: newId(), text: '', checkbox, done: false, level }
}

// Reset a textarea to a single line then grow it to fit its content.
function autoGrow(el: HTMLTextAreaElement): void {
  el.style.height = 'auto'
  el.style.height = `${el.scrollHeight}px`
}

// Light haptic tick on a committed indent/outdent — only inside Telegram.
function hapticLight(): void {
  window.Telegram?.WebApp?.HapticFeedback?.impactOccurred?.('light')
}

// Active swipe gesture state for a single pointer.
type Gesture = {
  pointerId: number
  rowId: string
  startX: number
  startY: number
  mode: 'pending' | 'horizontal' | 'vertical'
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
  // Map of Row id -> row wrapper element, for swipe transforms / pointer capture.
  const rowEls = useRef<Map<string, HTMLLIElement>>(new Map())
  // The in-flight swipe gesture, if any.
  const gesture = useRef<Gesture | null>(null)
  // The id of the textarea that should receive focus after the next render,
  // and whether the caret should be placed at the end.
  const pendingFocus = useRef<{ id: string; caretEnd: boolean } | null>(null)

  // Storage usage: real UTF-8 bytes of the serialized list out of the cap.
  const usedBytes = new TextEncoder().encode(serialize(rows)).length
  const lowStorage = MAX_VALUE_LENGTH - usedBytes <= 100

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

  const registerRow = useCallback(
    (id: string) => (el: HTMLLIElement | null) => {
      if (el) rowEls.current.set(id, el)
      else rowEls.current.delete(id)
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

  // Indent/outdent only flip `level`, which never grows the serialized string
  // meaningfully, so they are always allowed (even when limitReached).
  const indentRow = useCallback((id: string) => {
    const base = rowsRef.current
    const row = base.find((r) => r.id === id)
    if (!row || row.level === 1) return
    setLimitReached(false)
    setRows(base.map((r) => (r.id === id ? { ...r, level: 1 } : r)))
    hapticLight()
  }, [])

  const outdentRow = useCallback((id: string) => {
    const base = rowsRef.current
    const row = base.find((r) => r.id === id)
    if (!row || row.level === 0) return
    setLimitReached(false)
    setRows(base.map((r) => (r.id === id ? { ...r, level: 0 } : r)))
    hapticLight()
  }, [])

  // The bottom-right control: toggle the focused row between plain text and a
  // checkbox row (text and caret preserved).
  const toggleFocusedCheckbox = useCallback(() => {
    const id = focusedIdRef.current
    if (!id) return
    const base = rowsRef.current
    const row = base.find((r) => r.id === id)
    if (!row) return
    if (row.checkbox) {
      // Revert to plain text (also clears done). Shrinks — always allowed.
      setLimitReached(false)
      setRows(
        base.map((r) =>
          r.id === id ? { ...r, checkbox: false, done: false } : r
        )
      )
      inputs.current.get(id)?.focus()
      return
    }
    // Turn the checkbox on. Grows the string — respect the storage guard.
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
      // type and indent. Shift+Enter falls through to a newline.
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault()
        const next = createRow(base[index].checkbox, base[index].level)
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
        // "Caret at start" means a collapsed caret at position 0.
        const atStart = el.selectionStart === 0 && el.selectionEnd === 0
        if (!atStart) return // normal character delete — let the default happen

        // 1. Checkbox row → remove the checkbox first (keep text, caret stays
        //    at 0). Applies whether the text is empty or not.
        if (base[index].checkbox) {
          event.preventDefault()
          setLimitReached(false)
          setRows(
            base.map((row) =>
              row.id === id ? { ...row, checkbox: false, done: false } : row
            )
          )
          return
        }

        // 2. Plain empty row → delete it and move focus to the end of the
        //    previous row. The last remaining row is never deleted.
        if (el.value === '') {
          event.preventDefault()
          if (base.length <= 1) return
          if (index <= 0) return
          pendingFocus.current = { id: base[index - 1].id, caretEnd: true }
          setLimitReached(false)
          setRows(base.filter((row) => row.id !== id))
          return
        }

        // 3. Plain, non-empty row at start → let the default Backspace happen
        //    (deletes nothing at position 0).
      }
    },
    []
  )

  // Snap a row's swipe transform back to rest with a short animation.
  const resetRowTransform = useCallback((rowId: string) => {
    const el = rowEls.current.get(rowId)
    if (!el) return
    el.style.transition = 'transform 120ms ease'
    el.style.transform = 'translateX(0)'
  }, [])

  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLLIElement>, id: string) => {
      // Let the checkbox handle its own taps; never start a swipe there.
      if (event.target instanceof Element && event.target.closest('.checkbox')) {
        return
      }
      gesture.current = {
        pointerId: event.pointerId,
        rowId: id,
        startX: event.clientX,
        startY: event.clientY,
        mode: 'pending',
      }
    },
    []
  )

  const handlePointerMove = useCallback(
    (event: ReactPointerEvent<HTMLLIElement>) => {
      const g = gesture.current
      if (!g || g.pointerId !== event.pointerId) return
      const dx = event.clientX - g.startX
      const dy = event.clientY - g.startY

      // Decide the gesture axis once.
      if (g.mode === 'pending') {
        if (Math.abs(dy) > Math.abs(dx)) {
          // Vertical: hand off to native scrolling and stop tracking.
          g.mode = 'vertical'
          return
        }
        if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 8) {
          g.mode = 'horizontal'
          const el = rowEls.current.get(g.rowId)
          if (el) {
            el.style.transition = ''
            try {
              el.setPointerCapture(event.pointerId)
            } catch {
              // Capture can fail if the pointer already ended; ignore.
            }
          }
        } else {
          return
        }
      }

      if (g.mode === 'horizontal') {
        // Stop caret placement / text selection while dragging horizontally.
        event.preventDefault()
        const el = rowEls.current.get(g.rowId)
        if (el) {
          const damped = Math.max(-56, Math.min(56, dx * 0.4))
          el.style.transform = `translateX(${damped}px)`
        }
      }
    },
    []
  )

  const handlePointerUp = useCallback(
    (event: ReactPointerEvent<HTMLLIElement>) => {
      const g = gesture.current
      if (!g || g.pointerId !== event.pointerId) return
      gesture.current = null

      const el = rowEls.current.get(g.rowId)
      if (el) {
        try {
          el.releasePointerCapture(event.pointerId)
        } catch {
          // Already released; ignore.
        }
      }
      resetRowTransform(g.rowId)

      if (g.mode === 'horizontal') {
        const dx = event.clientX - g.startX
        if (dx > SWIPE_COMMIT_PX) indentRow(g.rowId)
        else if (dx < -SWIPE_COMMIT_PX) outdentRow(g.rowId)
      }
    },
    [indentRow, outdentRow, resetRowTransform]
  )

  const handlePointerCancel = useCallback(
    (event: ReactPointerEvent<HTMLLIElement>) => {
      const g = gesture.current
      if (!g || g.pointerId !== event.pointerId) return
      gesture.current = null

      const el = rowEls.current.get(g.rowId)
      if (el) {
        try {
          el.releasePointerCapture(event.pointerId)
        } catch {
          // Already released; ignore.
        }
      }
      resetRowTransform(g.rowId)
    },
    [resetRowTransform]
  )

  return (
    <main className="app">
      <ul className="list">
        {rows.map((row) => (
          <li
            className={`row${row.level === 1 ? ' sub' : ''}`}
            key={row.id}
            ref={registerRow(row.id)}
            onPointerDown={(event) => handlePointerDown(event, row.id)}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerCancel}
          >
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
        <span className={`counter${lowStorage ? ' low' : ''}`}>
          {usedBytes}/{MAX_VALUE_LENGTH} B
        </span>
        <button
          type="button"
          className="fab"
          aria-label="Toggle checkbox on current line"
          disabled={focusedId === null}
          // Keep the textarea focused (and its caret) when pressing this.
          onPointerDown={(event) => event.preventDefault()}
          onMouseDown={(event) => event.preventDefault()}
          onClick={toggleFocusedCheckbox}
        >
          ✅
        </button>
      </div>
    </main>
  )
}
