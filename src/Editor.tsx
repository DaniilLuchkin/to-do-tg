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
  loadNote,
  saveNoteContent,
  serialize,
  rowsToText,
  titleOf,
  newId,
  MAX_VALUE_BYTES,
  type Row,
} from './storage'

// Per-note byte cap.
const MAX_VALUE_LENGTH = MAX_VALUE_BYTES

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

// Suspend Telegram's vertical swipe-to-minimize during a drag (guarded).
function beginDragLock(): void {
  window.Telegram?.WebApp?.disableVerticalSwipes?.()
  document.body.style.touchAction = 'none'
}

function endDragLock(reorderActive: boolean): void {
  document.body.style.touchAction = ''
  if (!reorderActive) window.Telegram?.WebApp?.enableVerticalSwipes?.()
}

type Gesture = {
  pointerId: number
  rowId: string
  startX: number
  startY: number
  mode: 'pending' | 'horizontal' | 'vertical'
}

type Drag = {
  pointerId: number
  rowId: string
  startIndex: number
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
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [dropLineTop, setDropLineTop] = useState<number | null>(null)
  const [panel, setPanel] = useState<'none' | 'export'>('none')
  const [exportValue, setExportValue] = useState('')
  const [copied, setCopied] = useState(false)

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

  const usedBytes = serializedBytes(rows)
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
      // Re-enable swipes in case we left mid-reorder, and persist.
      window.Telegram?.WebApp?.enableVerticalSwipes?.()
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
    }
    el.scrollIntoView({ block: 'nearest' })
  }, [rows])

  useEffect(() => {
    inputs.current.forEach((el) => autoGrow(el))
  }, [rows, limitReached])

  useEffect(() => {
    if (panel === 'export') exportRef.current?.select()
  }, [panel, exportValue])

  useEffect(() => {
    if (reorderMode) window.Telegram?.WebApp?.disableVerticalSwipes?.()
    else window.Telegram?.WebApp?.enableVerticalSwipes?.()
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

  const registerRow = useCallback(
    (id: string) => (el: HTMLLIElement | null) => {
      if (el) rowEls.current.set(id, el)
      else rowEls.current.delete(id)
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

  // ---- Horizontal swipe (indent / outdent / delete) ----------------------

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

  // ---- Drag to reorder ---------------------------------------------------

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
      beginDragLock()
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
      endDragLock(reorderModeRef.current)
      setDraggingId(null)
      setDropLineTop(null)

      const base = rowsRef.current
      const newIndex = dropIndexAmongOthers(d.rowId, event.clientY)
      if (newIndex === d.startIndex) return
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
    endDragLock(reorderModeRef.current)
    setDraggingId(null)
    setDropLineTop(null)
  }, [])

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

  const onHandlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLElement>, id: string) => {
      event.stopPropagation()
      startDrag(event, id)
    },
    [startDrag]
  )

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

  const noFocusMouseDown = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      event.preventDefault()
    },
    []
  )

  return (
    <main className="app editor">
      <div className="topbar">
        <button
          type="button"
          className="nav-btn"
          aria-label="Back"
          onPointerDown={noFocusMouseDown}
          onClick={handleBack}
        >
          ←
        </button>
        <button
          type="button"
          className="nav-btn"
          aria-label="Undo"
          disabled={undoCount === 0}
          onPointerDown={noFocusMouseDown}
          onClick={undo}
        >
          ↩️
        </button>
        <button
          type="button"
          className={`nav-btn${reorderMode ? ' active' : ''}`}
          aria-label="Reorder"
          aria-pressed={reorderMode}
          onPointerDown={noFocusMouseDown}
          onClick={() => setReorderMode((m) => !m)}
        >
          ↕️
        </button>
        <button
          type="button"
          className="nav-btn"
          aria-label="Copy note as text"
          onPointerDown={noFocusMouseDown}
          onClick={onExport}
        >
          📋
        </button>
        <span className={`counter${lowStorage ? ' low' : ''}`}>
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
              placeholder={
                index === 0 && showWriteHint ? 'Tap here to write' : undefined
              }
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
          className="act"
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
