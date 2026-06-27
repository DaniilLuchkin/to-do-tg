import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import IconButton from './IconButton'
import Icon from './Icon'
import {
  loadNote,
  saveNoteContent,
  serialize,
  rowsToText,
  titleOf,
  newId,
  MAX_VALUE_BYTES,
  type Row,
} from './storage'
import { shareNote } from './share'
import { HAS_BACK_BUTTON, hapticLight, hapticMedium } from './telegram-ui'
import { useRowGestures, SWIPE_DELETE_PX } from './useRowGestures'

// Per-note byte cap.
const MAX_VALUE_LENGTH = MAX_VALUE_BYTES

// Horizontal travel (px) a swipe must exceed to commit an indent/outdent.
const SWIPE_COMMIT_PX = 48

// Cap on the in-memory undo history.
const MAX_HISTORY = 100

function serializedBytes(rows: Row[]): number {
  return new TextEncoder().encode(serialize(rows)).length
}

function tooLong(rows: Row[]): boolean {
  return serializedBytes(rows) > MAX_VALUE_LENGTH
}

function createRow(checkbox = false, level: 0 | 1 = 0): Row {
  return { id: newId(), text: '', checkbox, done: false, level }
}

// Reset a textarea to a single line then grow it to fit its content.
function autoGrow(el: HTMLTextAreaElement): void {
  el.style.height = 'auto'
  el.style.height = `${el.scrollHeight}px`
}

type EditorProps = {
  noteId: string
  onBack: () => void
  onTitleChange: (id: string, title: string) => void
}

export default function Editor({ noteId, onBack, onTitleChange }: EditorProps) {
  const [rows, setRows] = useState<Row[]>([])
  const [loaded, setLoaded] = useState(false)
  const [limitReached, setLimitReached] = useState(false)
  const [focusedId, setFocusedId] = useState<string | null>(null)
  const [undoCount, setUndoCount] = useState(0)
  const [reorderMode, setReorderMode] = useState(false)
  const [panel, setPanel] = useState<'none' | 'export'>('none')
  const [exportValue, setExportValue] = useState('')
  const [copied, setCopied] = useState(false)

  const rowsRef = useRef<Row[]>(rows)
  rowsRef.current = rows
  const focusedIdRef = useRef<string | null>(null)
  const reorderModeRef = useRef(false)
  reorderModeRef.current = reorderMode

  const inputs = useRef<Map<string, HTMLTextAreaElement>>(new Map())
  const exportRef = useRef<HTMLTextAreaElement | null>(null)
  const pendingFocus = useRef<{ id: string; caretEnd: boolean } | null>(null)

  // In-memory undo history (deep copies) — per note; resets on remount.
  const history = useRef<Row[][]>([])
  const editBurstId = useRef<string | null>(null)

  // Stable refs to parent callbacks for the mount/unmount lifecycle.
  const onBackRef = useRef(onBack)
  onBackRef.current = onBack
  const onTitleChangeRef = useRef(onTitleChange)
  onTitleChangeRef.current = onTitleChange

  // Per-note hydration guard: never persist before the note has loaded, so a
  // transient empty editor can't overwrite stored content.
  const loadedRef = useRef(false)
  loadedRef.current = loaded

  const usedBytes = useMemo(() => serializedBytes(rows), [rows])
  const lowStorage = MAX_VALUE_LENGTH - usedBytes <= 100

  // The note is "empty" (single blank row) → show the writing hint on row 0.
  const showWriteHint = rows.length === 1 && rows[0]?.text === ''

  // Keep the focused row visible above the bottom button / keyboard.
  const keepRowVisible = useCallback((id: string) => {
    inputs.current.get(id)?.scrollIntoView({ block: 'nearest' })
  }, [])

  // Persist the current note immediately and refresh its cached title.
  const flushNow = useCallback(() => {
    if (!loadedRef.current) return
    void saveNoteContent(noteId, rowsRef.current)
    onTitleChangeRef.current(noteId, titleOf(rowsRef.current))
  }, [noteId])
  const flushNowRef = useRef(flushNow)
  flushNowRef.current = flushNow

  const handleBack = useCallback(() => {
    flushNow()
    onBackRef.current()
  }, [flushNow])
  const handleBackRef = useRef(handleBack)
  handleBackRef.current = handleBack

  const pushHistory = useCallback(() => {
    const snap = rowsRef.current.map((r) => ({ ...r }))
    const h = history.current
    h.push(snap)
    if (h.length > MAX_HISTORY) h.shift()
    setUndoCount(h.length)
  }, [])

  const closeBurst = useCallback(() => {
    editBurstId.current = null
  }, [])

  // Load this note's content on mount (or when the note id changes).
  useEffect(() => {
    let active = true
    loadNote(noteId).then((stored) => {
      if (!active) return
      const next = stored.length > 0 ? stored : [createRow()]
      setRows(next)
      setLoaded(true)
      // Attempt to focus the first row (raises the keyboard on desktop; may
      // not on mobile — the "Tap here to write" hint is the fallback there).
      pendingFocus.current = { id: next[0].id, caretEnd: true }
    })
    return () => {
      active = false
    }
  }, [noteId])

  // Debounced persistence (~400ms after the last change).
  useEffect(() => {
    if (!loaded) return
    const handle = window.setTimeout(() => {
      void saveNoteContent(noteId, rows)
      onTitleChangeRef.current(noteId, titleOf(rows))
    }, 400)
    return () => window.clearTimeout(handle)
  }, [rows, loaded, noteId])

  // Telegram BackButton while the editor is open; flush + restore on leave.
  useEffect(() => {
    const wa = window.Telegram?.WebApp
    wa?.BackButton?.show?.()
    const cb = () => handleBackRef.current()
    wa?.BackButton?.onClick?.(cb)
    return () => {
      wa?.BackButton?.offClick?.(cb)
      wa?.BackButton?.hide?.()
      // Keep vertical swipes locked (Wallet-style) even after a reorder; persist.
      window.Telegram?.WebApp?.disableVerticalSwipes?.()
      document.body.style.touchAction = ''
      flushNowRef.current()
    }
  }, [])

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
    } else {
      // Used by Enter-split: put the caret at the start of the new row.
      el.setSelectionRange(0, 0)
    }
    el.scrollIntoView({ block: 'nearest' })
  }, [rows])

  useEffect(() => {
    inputs.current.forEach((el) => autoGrow(el))
  }, [rows, limitReached])

  useEffect(() => {
    if (panel === 'export') exportRef.current?.select()
  }, [panel, exportValue])

  // Vertical swipes stay globally locked (Wallet-style); reorder never undoes
  // the lock, so toggling reorder mode just reasserts the disabled state.
  useEffect(() => {
    window.Telegram?.WebApp?.disableVerticalSwipes?.()
  }, [reorderMode])

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

  const handleFocus = useCallback(
    (id: string) => {
      if (editBurstId.current !== null && editBurstId.current !== id) {
        editBurstId.current = null
      }
      focusedIdRef.current = id
      setFocusedId(id)
      keepRowVisible(id)
    },
    [keepRowVisible]
  )

  const handleBlur = useCallback((id: string) => {
    if (focusedIdRef.current === id) {
      focusedIdRef.current = null
      setFocusedId(null)
    }
  }, [])

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
      if (editBurstId.current !== id) {
        pushHistory()
        editBurstId.current = id
      }
      setLimitReached(false)
      setRows(candidate)
      autoGrow(event.target)
      // Following the caret as the line wraps to a new visual line.
      event.target.scrollIntoView({ block: 'nearest' })
    },
    [pushHistory]
  )

  const toggleDone = useCallback(
    (id: string) => {
      const base = rowsRef.current
      const candidate = base.map((row) =>
        row.id === id ? { ...row, done: !row.done } : row
      )
      if (tooLong(candidate)) {
        setLimitReached(true)
        return
      }
      pushHistory()
      closeBurst()
      setLimitReached(false)
      setRows(candidate)
    },
    [pushHistory, closeBurst]
  )

  const indentRow = useCallback(
    (id: string) => {
      const base = rowsRef.current
      const row = base.find((r) => r.id === id)
      if (!row || row.level === 1) return
      const candidate = base.map((r) =>
        r.id === id ? { ...r, level: 1 as const } : r
      )
      if (tooLong(candidate)) {
        setLimitReached(true)
        return
      }
      pushHistory()
      closeBurst()
      setLimitReached(false)
      setRows(candidate)
      hapticLight()
    },
    [pushHistory, closeBurst]
  )

  const outdentRow = useCallback(
    (id: string) => {
      const base = rowsRef.current
      const row = base.find((r) => r.id === id)
      if (!row || row.level === 0) return
      pushHistory()
      closeBurst()
      setLimitReached(false)
      setRows(base.map((r) => (r.id === id ? { ...r, level: 0 } : r)))
      hapticLight()
    },
    [pushHistory, closeBurst]
  )

  const deleteRow = useCallback(
    (id: string) => {
      const base = rowsRef.current
      const index = base.findIndex((r) => r.id === id)
      if (index === -1) return
      pushHistory()
      closeBurst()
      setLimitReached(false)
      if (base.length <= 1) {
        const fresh = createRow()
        pendingFocus.current = { id: fresh.id, caretEnd: true }
        setRows([fresh])
      } else {
        const focusId = index > 0 ? base[index - 1].id : base[1].id
        pendingFocus.current = { id: focusId, caretEnd: true }
        setRows(base.filter((r) => r.id !== id))
      }
      hapticMedium()
    },
    [pushHistory, closeBurst]
  )

  const toggleFocusedCheckbox = useCallback(() => {
    const id = focusedIdRef.current
    if (!id) return
    const base = rowsRef.current
    const row = base.find((r) => r.id === id)
    if (!row) return
    if (row.checkbox) {
      pushHistory()
      closeBurst()
      setLimitReached(false)
      setRows(
        base.map((r) =>
          r.id === id ? { ...r, checkbox: false, done: false } : r
        )
      )
      inputs.current.get(id)?.focus()
      return
    }
    const candidate = base.map((r) =>
      r.id === id ? { ...r, checkbox: true } : r
    )
    if (tooLong(candidate)) {
      setLimitReached(true)
      return
    }
    pushHistory()
    closeBurst()
    setLimitReached(false)
    setRows(candidate)
    inputs.current.get(id)?.focus()
  }, [pushHistory, closeBurst])

  const undo = useCallback(() => {
    const h = history.current
    if (h.length === 0) return
    const snap = h.pop()
    if (!snap) return
    setUndoCount(h.length)
    closeBurst()
    setLimitReached(false)
    setRows(snap)
    const fid = focusedIdRef.current
    if (fid && snap.some((r) => r.id === fid)) {
      pendingFocus.current = { id: fid, caretEnd: true }
    }
  }, [closeBurst])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (
        (e.metaKey || e.ctrlKey) &&
        !e.shiftKey &&
        (e.key === 'z' || e.key === 'Z')
      ) {
        e.preventDefault()
        undo()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [undo])

  const handleKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLTextAreaElement>, id: string) => {
      const base = rowsRef.current
      const index = base.findIndex((row) => row.id === id)
      if (index === -1) return

      if (event.key === 'Enter' && !event.shiftKey) {
        // Split the current row at the caret: text before stays, text after
        // (any selection is dropped) moves to a new row of the same type/level.
        event.preventDefault()
        const el = event.currentTarget
        const start = el.selectionStart
        const end = el.selectionEnd
        const cur = base[index]
        const before = cur.text.slice(0, start)
        const after = cur.text.slice(end)
        const next = createRow(cur.checkbox, cur.level)
        next.text = after
        const candidate = base.slice()
        candidate[index] = { ...cur, text: before }
        candidate.splice(index + 1, 0, next)
        if (tooLong(candidate)) {
          setLimitReached(true)
          return
        }
        pushHistory()
        closeBurst()
        setLimitReached(false)
        setRows(candidate)
        // caretEnd:false → focus the new row with the caret at position 0.
        pendingFocus.current = { id: next.id, caretEnd: false }
        return
      }

      if (event.key === 'Backspace') {
        const el = event.currentTarget
        const atStart = el.selectionStart === 0 && el.selectionEnd === 0
        if (!atStart) return

        if (base[index].checkbox) {
          event.preventDefault()
          pushHistory()
          closeBurst()
          setLimitReached(false)
          setRows(
            base.map((row) =>
              row.id === id ? { ...row, checkbox: false, done: false } : row
            )
          )
          return
        }

        if (el.value === '') {
          event.preventDefault()
          if (base.length <= 1) return
          if (index <= 0) return
          pushHistory()
          closeBurst()
          pendingFocus.current = { id: base[index - 1].id, caretEnd: true }
          setLimitReached(false)
          setRows(base.filter((row) => row.id !== id))
          return
        }
      }
    },
    [pushHistory, closeBurst]
  )

  // Drag-to-reorder + swipe (right = indent, short-left = outdent,
  // far-left = delete), shared with the notes list.
  const {
    draggingId,
    dropLineTop,
    listRef,
    registerRow,
    onRowPointerDown,
    onRowPointerMove,
    onRowPointerUp,
    onRowPointerCancel,
    onHandlePointerDown,
  } = useRowGestures<Row>({
    itemsRef: rowsRef,
    reorderModeRef,
    onReorder: (arr) => {
      pushHistory()
      closeBurst()
      setRows(arr)
    },
    swipeIgnoreSelector: '.checkbox',
    swipeClampMax: 56,
    onSwipeCommit: (id, dx) => {
      if (dx > SWIPE_COMMIT_PX) indentRow(id)
      else if (dx < -SWIPE_DELETE_PX) deleteRow(id)
      else if (dx < -SWIPE_COMMIT_PX) outdentRow(id)
    },
  })
  // ---- Export ------------------------------------------------------------

  const showCopied = useCallback(() => {
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1500)
  }, [])

  const onExport = useCallback(() => {
    const text = rowsToText(rowsRef.current)
    const clip = navigator.clipboard
    if (clip && typeof clip.writeText === 'function') {
      clip.writeText(text).then(showCopied, () => {
        setExportValue(text)
        setPanel('export')
      })
    } else {
      setExportValue(text)
      setPanel('export')
    }
  }, [showCopied])

  const closePanel = useCallback(() => {
    setPanel('none')
  }, [])

  // Share the note: a deep link when it's small enough, else its plain text.
  const onShare = useCallback(() => {
    shareNote(rowsRef.current)
  }, [])

  const noFocusMouseDown = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      event.preventDefault()
    },
    []
  )

  return (
    <main className="app editor">
      <div className="topbar">
        <div className="bar-actions">
          {!HAS_BACK_BUTTON && (
            <IconButton
              icon="chevron-left"
              label="Back"
              onPointerDown={noFocusMouseDown}
              onClick={handleBack}
            />
          )}
          <IconButton
            icon="undo"
            label="Undo"
            disabled={undoCount === 0}
            onPointerDown={noFocusMouseDown}
            onClick={undo}
          />
          <IconButton
            icon="reorder"
            label="Reorder rows"
            active={reorderMode}
            pressed={reorderMode}
            onPointerDown={noFocusMouseDown}
            onClick={() => setReorderMode((m) => !m)}
          />
          <IconButton
            icon="copy"
            label="Copy note as text"
            onPointerDown={noFocusMouseDown}
            onClick={onExport}
          />
          <IconButton
            icon="share"
            label="Share note"
            onPointerDown={noFocusMouseDown}
            onClick={onShare}
          />
        </div>
        <span className={`caption counter${lowStorage ? ' low' : ''}`}>
          {usedBytes}/{MAX_VALUE_LENGTH} B
        </span>
      </div>

      <ul className={`list${reorderMode ? ' reorder' : ''}`} ref={listRef}>
        {rows.map((row, index) => (
          <li
            className={`row${row.level === 1 ? ' sub' : ''}${
              draggingId === row.id ? ' dragging' : ''
            }`}
            key={row.id}
            ref={registerRow(row.id)}
            onPointerDown={(event) => onRowPointerDown(event, row.id)}
            onPointerMove={onRowPointerMove}
            onPointerUp={onRowPointerUp}
            onPointerCancel={onRowPointerCancel}
          >
            <span
              className="handle"
              aria-hidden="true"
              onPointerDown={(event) => onHandlePointerDown(event, row.id)}
            >
              ⠿
            </span>
            <span className="delete-hint" aria-hidden="true">
              ✕
            </span>
            {row.checkbox && (
              <button
                key="checkbox"
                type="button"
                className={`checkbox${row.done ? ' checked' : ''}`}
                aria-pressed={row.done}
                aria-label={row.done ? 'Mark as not done' : 'Mark as done'}
                onClick={() => toggleDone(row.id)}
              >
                {row.done && <Icon name="tick" size={14} />}
              </button>
            )}
            <textarea
              key="text"
              ref={registerInput(row.id)}
              className={`text${row.checkbox && row.done ? ' done' : ''}`}
              rows={1}
              value={row.text}
              readOnly={reorderMode}
              placeholder={
                index === 0 && showWriteHint ? 'Tap here to write' : undefined
              }
              onChange={(event) => handleChange(row.id, event)}
              onKeyDown={(event) => handleKeyDown(event, row.id)}
              onFocus={() => handleFocus(row.id)}
              onBlur={() => handleBlur(row.id)}
            />
            {reorderMode && (
              <IconButton
                icon="close"
                label="Delete line"
                size={20}
                onPointerDown={(event) => event.stopPropagation()}
                onClick={() => deleteRow(row.id)}
              />
            )}
          </li>
        ))}
        {draggingId !== null && dropLineTop !== null && (
          <div className="drop-line" style={{ top: dropLineTop }} />
        )}
      </ul>

      {limitReached && (
        <p className="notice">Storage full — delete or shorten a line.</p>
      )}

      {panel === 'export' && (
        <div className="panel" role="dialog" aria-label="Export note">
          <textarea
            className="panel-text"
            ref={exportRef}
            readOnly
            value={exportValue}
          />
          <div className="panel-actions">
            <button type="button" className="tool-btn" onClick={closePanel}>
              Close
            </button>
          </div>
        </div>
      )}

      {copied && <div className="toast">Copied</div>}

      <div className="toolbar">
        <button
          type="button"
          className="fab-primary"
          aria-label="Toggle checkbox on current line"
          disabled={focusedId === null}
          onPointerDown={(event) => event.preventDefault()}
          onMouseDown={(event) => event.preventDefault()}
          onClick={toggleFocusedCheckbox}
        >
          <Icon name="check" size={22} />
        </button>
      </div>
    </main>
  )
}
