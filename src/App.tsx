import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import {
  loadRows,
  saveRows,
  serialize,
  rowsToText,
  textToRows,
  type Row,
} from './storage'

// Telegram CloudStorage allows at most 4096 bytes per value. We store the whole
// list as one (compact) JSON string under "todos", so the binding limit is the
// serialized byte length of that string.
const MAX_VALUE_LENGTH = 4096

// Horizontal travel (px) a swipe must exceed to commit an indent/outdent.
const SWIPE_COMMIT_PX = 48
// Left-swipe distance (px) beyond which release deletes the row.
const SWIPE_DELETE_PX = 120

// Cap on the in-memory undo history.
const MAX_HISTORY = 100

function serializedBytes(rows: Row[]): number {
  return new TextEncoder().encode(serialize(rows)).length
}

function tooLong(rows: Row[]): boolean {
  return serializedBytes(rows) > MAX_VALUE_LENGTH
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

// Haptic ticks — only inside Telegram.
function hapticLight(): void {
  window.Telegram?.WebApp?.HapticFeedback?.impactOccurred?.('light')
}

function hapticMedium(): void {
  window.Telegram?.WebApp?.HapticFeedback?.impactOccurred?.('medium')
}

// Active horizontal-swipe gesture state for a single pointer.
type Gesture = {
  pointerId: number
  rowId: string
  startX: number
  startY: number
  mode: 'pending' | 'horizontal' | 'vertical'
}

// Active drag-to-reorder state.
type Drag = {
  pointerId: number
  rowId: string
  startIndex: number
}

export default function App() {
  const [rows, setRows] = useState<Row[]>([])
  const [loaded, setLoaded] = useState(false)
  const [limitReached, setLimitReached] = useState(false)
  const [focusedId, setFocusedId] = useState<string | null>(null)
  const [undoCount, setUndoCount] = useState(0)
  const [reorderMode, setReorderMode] = useState(false)
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [dropLineTop, setDropLineTop] = useState<number | null>(null)
  const [panel, setPanel] = useState<'none' | 'export' | 'import'>('none')
  const [exportValue, setExportValue] = useState('')
  const [importValue, setImportValue] = useState('')
  const [importError, setImportError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  // Always-current mirrors for event handlers.
  const rowsRef = useRef<Row[]>(rows)
  rowsRef.current = rows
  const focusedIdRef = useRef<string | null>(null)
  const reorderModeRef = useRef(false)
  reorderModeRef.current = reorderMode

  const inputs = useRef<Map<string, HTMLTextAreaElement>>(new Map())
  const rowEls = useRef<Map<string, HTMLLIElement>>(new Map())
  const listRef = useRef<HTMLUListElement | null>(null)
  const exportRef = useRef<HTMLTextAreaElement | null>(null)

  const gesture = useRef<Gesture | null>(null)
  const drag = useRef<Drag | null>(null)
  const pendingFocus = useRef<{ id: string; caretEnd: boolean } | null>(null)

  // In-memory undo history (deep copies). Not persisted.
  const history = useRef<Row[][]>([])
  // The row id whose current text edit "burst" is open (coalesced undo step).
  const editBurstId = useRef<string | null>(null)

  const usedBytes = serializedBytes(rows)
  const lowStorage = MAX_VALUE_LENGTH - usedBytes <= 100

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

  // Debounced persistence (~400ms after the last change).
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

  // Pre-select the export textarea when the export panel opens.
  useEffect(() => {
    if (panel === 'export') exportRef.current?.select()
  }, [panel, exportValue])

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
    if (editBurstId.current !== null && editBurstId.current !== id) {
      editBurstId.current = null
    }
    focusedIdRef.current = id
    setFocusedId(id)
  }, [])

  const handleBlur = useCallback((id: string) => {
    if (focusedIdRef.current === id) {
      focusedIdRef.current = null
      setFocusedId(null)
    }
  }, [])

  // Editing a row's text. Coalesced into one undo step per editing burst.
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
      // First edit of a new burst: snapshot the pre-edit state.
      if (editBurstId.current !== id) {
        pushHistory()
        editBurstId.current = id
      }
      setLimitReached(false)
      setRows(candidate)
      autoGrow(event.target)
    },
    [pushHistory]
  )

  const toggleDone = useCallback(
    (id: string) => {
      const base = rowsRef.current
      const candidate = base.map((row) =>
        row.id === id ? { ...row, done: !row.done } : row
      )
      // Marking done ON adds "d":1 — gate it; un-marking shrinks and is allowed.
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
      // Indent adds "l":1 — gate it against the byte cap.
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

  // Delete a row (far left-swipe). Reversible via Undo. Never leaves zero rows.
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
        // Focus the previous row, or the new first row if this was the first.
        const focusId = index > 0 ? base[index - 1].id : base[1].id
        pendingFocus.current = { id: focusId, caretEnd: true }
        setRows(base.filter((r) => r.id !== id))
      }
      hapticMedium()
    },
    [pushHistory, closeBurst]
  )

  // Bottom-right control: toggle the focused row between plain text and a
  // checkbox row (text and caret preserved).
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

  // Cmd/Ctrl+Z → our single unified undo (suppress native textarea undo).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && (e.key === 'z' || e.key === 'Z')) {
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
        event.preventDefault()
        const next = createRow(base[index].checkbox, base[index].level)
        const candidate = base.slice()
        candidate.splice(index + 1, 0, next)
        if (tooLong(candidate)) {
          setLimitReached(true)
          return
        }
        pushHistory()
        closeBurst()
        setLimitReached(false)
        setRows(candidate)
        pendingFocus.current = { id: next.id, caretEnd: false }
        return
      }

      if (event.key === 'Backspace') {
        const el = event.currentTarget
        const atStart = el.selectionStart === 0 && el.selectionEnd === 0
        if (!atStart) return

        // 1. Checkbox row → remove the checkbox first (keep text).
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

        // 2. Plain empty row → delete it and focus the previous row.
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

        // 3. Plain, non-empty row at start → default Backspace (no-op).
      }
    },
    [pushHistory, closeBurst]
  )

  // ---- Horizontal swipe (indent / outdent) -------------------------------

  const resetRowTransform = useCallback((rowId: string) => {
    const el = rowEls.current.get(rowId)
    if (!el) return
    el.style.transition = 'transform 120ms ease'
    el.style.transform = 'translateX(0)'
    el.classList.remove('will-delete')
  }, [])

  const swipeDown = useCallback(
    (event: ReactPointerEvent<HTMLLIElement>, id: string) => {
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

  const swipeMove = useCallback((event: ReactPointerEvent<HTMLLIElement>) => {
    const g = gesture.current
    if (!g || g.pointerId !== event.pointerId) return
    const dx = event.clientX - g.startX
    const dy = event.clientY - g.startY

    if (g.mode === 'pending') {
      if (Math.abs(dy) > Math.abs(dx)) {
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
            // ignore
          }
        }
      } else {
        return
      }
    }

    if (g.mode === 'horizontal') {
      event.preventDefault()
      const el = rowEls.current.get(g.rowId)
      if (el) {
        const damped = Math.max(-56, Math.min(56, dx * 0.4))
        el.style.transform = `translateX(${damped}px)`
        // Past the delete threshold: cue that release will delete.
        if (dx < -SWIPE_DELETE_PX) el.classList.add('will-delete')
        else el.classList.remove('will-delete')
      }
    }
  }, [])

  const swipeUp = useCallback(
    (event: ReactPointerEvent<HTMLLIElement>) => {
      const g = gesture.current
      if (!g || g.pointerId !== event.pointerId) return
      gesture.current = null
      const el = rowEls.current.get(g.rowId)
      if (el) {
        try {
          el.releasePointerCapture(event.pointerId)
        } catch {
          // ignore
        }
      }
      resetRowTransform(g.rowId)
      if (g.mode === 'horizontal') {
        const dx = event.clientX - g.startX
        if (dx > SWIPE_COMMIT_PX) indentRow(g.rowId)
        else if (dx < -SWIPE_DELETE_PX) deleteRow(g.rowId)
        else if (dx < -SWIPE_COMMIT_PX) outdentRow(g.rowId)
      }
    },
    [indentRow, outdentRow, deleteRow, resetRowTransform]
  )

  const swipeCancel = useCallback(
    (event: ReactPointerEvent<HTMLLIElement>) => {
      const g = gesture.current
      if (!g || g.pointerId !== event.pointerId) return
      gesture.current = null
      const el = rowEls.current.get(g.rowId)
      if (el) {
        try {
          el.releasePointerCapture(event.pointerId)
        } catch {
          // ignore
        }
      }
      resetRowTransform(g.rowId)
    },
    [resetRowTransform]
  )

  // ---- Drag to reorder ----------------------------------------------------

  // Insertion index among the OTHER rows (those != draggedId), by clientY.
  const dropIndexAmongOthers = useCallback(
    (draggedId: string, clientY: number) => {
      let idx = 0
      for (const r of rowsRef.current) {
        if (r.id === draggedId) continue
        const el = rowEls.current.get(r.id)
        if (!el) continue
        const rect = el.getBoundingClientRect()
        if (clientY > rect.top + rect.height / 2) idx++
      }
      return idx
    },
    []
  )

  const updateDropLine = useCallback(
    (draggedId: string, clientY: number) => {
      const others = rowsRef.current.filter((r) => r.id !== draggedId)
      const listEl = listRef.current
      if (others.length === 0 || !listEl) {
        setDropLineTop(null)
        return
      }
      const idx = dropIndexAmongOthers(draggedId, clientY)
      const listTop = listEl.getBoundingClientRect().top
      let top: number
      if (idx < others.length) {
        const el = rowEls.current.get(others[idx].id)
        top = el ? el.getBoundingClientRect().top - listTop : 0
      } else {
        const el = rowEls.current.get(others[others.length - 1].id)
        top = el ? el.getBoundingClientRect().bottom - listTop : 0
      }
      setDropLineTop(top)
    },
    [dropIndexAmongOthers]
  )

  const startDrag = useCallback(
    (event: ReactPointerEvent<HTMLElement>, id: string) => {
      const startIndex = rowsRef.current.findIndex((r) => r.id === id)
      if (startIndex === -1) return
      drag.current = { pointerId: event.pointerId, rowId: id, startIndex }
      const el = rowEls.current.get(id)
      try {
        el?.setPointerCapture(event.pointerId)
      } catch {
        // ignore
      }
      setDraggingId(id)
      updateDropLine(id, event.clientY)
    },
    [updateDropLine]
  )

  const finishDrag = useCallback(
    (event: ReactPointerEvent<HTMLLIElement>) => {
      const d = drag.current
      if (!d) return
      drag.current = null
      const el = rowEls.current.get(d.rowId)
      try {
        el?.releasePointerCapture(event.pointerId)
      } catch {
        // ignore
      }
      setDraggingId(null)
      setDropLineTop(null)

      const base = rowsRef.current
      const newIndex = dropIndexAmongOthers(d.rowId, event.clientY)
      if (newIndex === d.startIndex) return // unchanged
      const dragged = base.find((r) => r.id === d.rowId)
      if (!dragged) return
      pushHistory()
      closeBurst()
      const arr = base.filter((r) => r.id !== d.rowId)
      arr.splice(newIndex, 0, dragged)
      setRows(arr)
      hapticLight()
    },
    [dropIndexAmongOthers, pushHistory, closeBurst]
  )

  const cancelDrag = useCallback((event: ReactPointerEvent<HTMLLIElement>) => {
    const d = drag.current
    drag.current = null
    if (d) {
      const el = rowEls.current.get(d.rowId)
      try {
        el?.releasePointerCapture(event.pointerId)
      } catch {
        // ignore
      }
    }
    setDraggingId(null)
    setDropLineTop(null)
  }, [])

  // ---- Unified row pointer handlers (route to drag or swipe) --------------

  const onRowPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLLIElement>, id: string) => {
      if (reorderModeRef.current) {
        startDrag(event, id)
        return
      }
      swipeDown(event, id)
    },
    [startDrag, swipeDown]
  )

  const onRowPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLLIElement>) => {
      const d = drag.current
      if (d && d.pointerId === event.pointerId) {
        event.preventDefault()
        updateDropLine(d.rowId, event.clientY)
        return
      }
      swipeMove(event)
    },
    [updateDropLine, swipeMove]
  )

  const onRowPointerUp = useCallback(
    (event: ReactPointerEvent<HTMLLIElement>) => {
      const d = drag.current
      if (d && d.pointerId === event.pointerId) {
        finishDrag(event)
        return
      }
      swipeUp(event)
    },
    [finishDrag, swipeUp]
  )

  const onRowPointerCancel = useCallback(
    (event: ReactPointerEvent<HTMLLIElement>) => {
      const d = drag.current
      if (d && d.pointerId === event.pointerId) {
        cancelDrag(event)
        return
      }
      swipeCancel(event)
    },
    [cancelDrag, swipeCancel]
  )

  // Handle (desktop hover) — start a drag regardless of reorder mode.
  const onHandlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLElement>, id: string) => {
      event.stopPropagation()
      startDrag(event, id)
    },
    [startDrag]
  )

  // ---- Export / Import ----------------------------------------------------

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

  const openImport = useCallback(() => {
    setImportValue('')
    setImportError(null)
    setPanel('import')
  }, [])

  const doImport = useCallback(() => {
    const parsed = textToRows(importValue, newId)
    const next = parsed.length > 0 ? parsed : [createRow()]
    const bytes = serializedBytes(next)
    if (bytes > MAX_VALUE_LENGTH) {
      setImportError(`Too large: ${bytes}/${MAX_VALUE_LENGTH} B. Trim and try again.`)
      return
    }
    pushHistory()
    closeBurst()
    setLimitReached(false)
    setRows(next)
    setPanel('none')
  }, [importValue, pushHistory, closeBurst])

  const closePanel = useCallback(() => {
    setPanel('none')
    setImportError(null)
  }, [])

  const noFocusMouseDown = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      event.preventDefault()
    },
    []
  )

  return (
    <main className="app">
      <ul className={`list${reorderMode ? ' reorder' : ''}`} ref={listRef}>
        {rows.map((row) => (
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
                {row.done ? '✓' : ''}
              </button>
            )}
            <textarea
              key="text"
              ref={registerInput(row.id)}
              className={`text${row.checkbox && row.done ? ' done' : ''}`}
              rows={1}
              value={row.text}
              readOnly={reorderMode}
              onChange={(event) => handleChange(row.id, event)}
              onKeyDown={(event) => handleKeyDown(event, row.id)}
              onFocus={() => handleFocus(row.id)}
              onBlur={() => handleBlur(row.id)}
            />
          </li>
        ))}
        {draggingId !== null && dropLineTop !== null && (
          <div className="drop-line" style={{ top: dropLineTop }} />
        )}
      </ul>

      {limitReached && (
        <p className="notice">Storage full — delete or shorten a line.</p>
      )}

      {panel === 'import' && (
        <div className="panel" role="dialog" aria-label="Import list">
          <textarea
            className="panel-text"
            autoFocus
            value={importValue}
            onChange={(event) => setImportValue(event.target.value)}
          />
          {importError && <p className="notice">{importError}</p>}
          <div className="panel-actions">
            <button type="button" className="tool-btn" onClick={closePanel}>
              Cancel
            </button>
            <button type="button" className="tool-btn" onClick={doImport}>
              Import
            </button>
          </div>
        </div>
      )}

      {panel === 'export' && (
        <div className="panel" role="dialog" aria-label="Export list">
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
        <div className="tools">
          <button
            type="button"
            className="tool-btn"
            aria-label="Undo"
            disabled={undoCount === 0}
            onPointerDown={noFocusMouseDown}
            onClick={undo}
          >
            ↶
          </button>
          <button
            type="button"
            className="tool-btn"
            aria-label="Export list as text"
            onClick={onExport}
          >
            Export
          </button>
          <button
            type="button"
            className="tool-btn"
            aria-label="Import list from text"
            onClick={openImport}
          >
            Import
          </button>
          <button
            type="button"
            className={`tool-btn${reorderMode ? ' active' : ''}`}
            aria-label="Toggle reorder mode"
            aria-pressed={reorderMode}
            onClick={() => setReorderMode((m) => !m)}
          >
            ⠿
          </button>
          <span className={`counter${lowStorage ? ' low' : ''}`}>
            {usedBytes}/{MAX_VALUE_LENGTH} B
          </span>
        </div>
        <button
          type="button"
          className="fab"
          aria-label="Toggle checkbox on current line"
          disabled={focusedId === null}
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
