import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import type { NoteMeta } from './storage'

const SWIPE_DELETE_PX = 120

function hapticLight(): void {
  window.Telegram?.WebApp?.HapticFeedback?.impactOccurred?.('light')
}

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
  noteId: string
  startX: number
  startY: number
  mode: 'pending' | 'horizontal' | 'vertical'
}

type Drag = { pointerId: number; noteId: string; startIndex: number }

type NotesListProps = {
  notes: NoteMeta[]
  canCreate: boolean
  onOpen: (id: string) => void
  onCreate: () => void
  onDelete: (id: string) => void
  onReorder: (notes: NoteMeta[]) => void
}

export default function NotesList({
  notes,
  canCreate,
  onOpen,
  onCreate,
  onDelete,
  onReorder,
}: NotesListProps) {
  const [reorderMode, setReorderMode] = useState(false)
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [dropLineTop, setDropLineTop] = useState<number | null>(null)
  const [confirmingId, setConfirmingId] = useState<string | null>(null)

  const notesRef = useRef<NoteMeta[]>(notes)
  notesRef.current = notes
  const reorderModeRef = useRef(false)
  reorderModeRef.current = reorderMode

  const rowEls = useRef<Map<string, HTMLLIElement>>(new Map())
  const listRef = useRef<HTMLUListElement | null>(null)
  const gesture = useRef<Gesture | null>(null)
  const drag = useRef<Drag | null>(null)

  // Reorder mode keeps Telegram vertical swipes disabled for the whole mode.
  useEffect(() => {
    if (reorderMode) window.Telegram?.WebApp?.disableVerticalSwipes?.()
    else window.Telegram?.WebApp?.enableVerticalSwipes?.()
  }, [reorderMode])

  // Restore swipes/scroll if this screen unmounts mid-interaction.
  useEffect(() => {
    return () => {
      window.Telegram?.WebApp?.enableVerticalSwipes?.()
      document.body.style.touchAction = ''
    }
  }, [])

  const registerRow = useCallback(
    (id: string) => (el: HTMLLIElement | null) => {
      if (el) rowEls.current.set(id, el)
      else rowEls.current.delete(id)
    },
    []
  )

  const resetTransform = useCallback((id: string) => {
    const el = rowEls.current.get(id)
    if (!el) return
    el.style.transition = 'transform 120ms ease'
    el.style.transform = 'translateX(0)'
    el.classList.remove('will-delete')
  }, [])

  // ---- Reorder drag ------------------------------------------------------

  const dropIndexAmongOthers = useCallback(
    (draggedId: string, clientY: number) => {
      let idx = 0
      for (const n of notesRef.current) {
        if (n.id === draggedId) continue
        const el = rowEls.current.get(n.id)
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
      const others = notesRef.current.filter((n) => n.id !== draggedId)
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
      const startIndex = notesRef.current.findIndex((n) => n.id === id)
      if (startIndex === -1) return
      drag.current = { pointerId: event.pointerId, noteId: id, startIndex }
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
      const el = rowEls.current.get(d.noteId)
      try {
        el?.releasePointerCapture(event.pointerId)
      } catch {
        // ignore
      }
      endDragLock(reorderModeRef.current)
      setDraggingId(null)
      setDropLineTop(null)

      const base = notesRef.current
      const newIndex = dropIndexAmongOthers(d.noteId, event.clientY)
      if (newIndex === d.startIndex) return
      const dragged = base.find((n) => n.id === d.noteId)
      if (!dragged) return
      const arr = base.filter((n) => n.id !== d.noteId)
      arr.splice(newIndex, 0, dragged)
      onReorder(arr)
      hapticLight()
    },
    [dropIndexAmongOthers, onReorder]
  )

  const cancelDrag = useCallback((event: ReactPointerEvent<HTMLLIElement>) => {
    const d = drag.current
    drag.current = null
    if (d) {
      const el = rowEls.current.get(d.noteId)
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

  // ---- Swipe-to-delete (normal mode) -------------------------------------

  const swipeDown = useCallback(
    (event: ReactPointerEvent<HTMLLIElement>, id: string) => {
      if (event.target instanceof Element && event.target.closest('.handle')) {
        return
      }
      gesture.current = {
        pointerId: event.pointerId,
        noteId: id,
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
        const el = rowEls.current.get(g.noteId)
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
      const el = rowEls.current.get(g.noteId)
      if (el) {
        const damped = Math.max(-56, Math.min(0, dx * 0.4))
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
      const el = rowEls.current.get(g.noteId)
      if (el) {
        try {
          el.releasePointerCapture(event.pointerId)
        } catch {
          // ignore
        }
      }
      resetTransform(g.noteId)
      if (g.mode === 'horizontal') {
        const dx = event.clientX - g.startX
        if (dx < -SWIPE_DELETE_PX) setConfirmingId(g.noteId)
      }
    },
    [resetTransform]
  )

  const swipeCancel = useCallback(
    (event: ReactPointerEvent<HTMLLIElement>) => {
      const g = gesture.current
      if (!g || g.pointerId !== event.pointerId) return
      gesture.current = null
      const el = rowEls.current.get(g.noteId)
      if (el) {
        try {
          el.releasePointerCapture(event.pointerId)
        } catch {
          // ignore
        }
      }
      resetTransform(g.noteId)
    },
    [resetTransform]
  )

  // ---- Unified routing ----------------------------------------------------

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
        updateDropLine(d.noteId, event.clientY)
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

  return (
    <main className="app">
      <h1 className="notes-head">Notes</h1>

      <ul className={`list${reorderMode ? ' reorder' : ''}`} ref={listRef}>
        {notes.map((note) =>
          confirmingId === note.id ? (
            <li className="note confirm" key={note.id}>
              <span className="confirm-text">Delete this note?</span>
              <button
                type="button"
                className="tool-btn"
                onClick={() => setConfirmingId(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="tool-btn"
                onClick={() => {
                  onDelete(note.id)
                  setConfirmingId(null)
                }}
              >
                Delete
              </button>
            </li>
          ) : (
            <li
              className={`note${draggingId === note.id ? ' dragging' : ''}`}
              key={note.id}
              ref={registerRow(note.id)}
              onPointerDown={(event) => onRowPointerDown(event, note.id)}
              onPointerMove={onRowPointerMove}
              onPointerUp={onRowPointerUp}
              onPointerCancel={onRowPointerCancel}
            >
              <span
                className="handle"
                aria-hidden="true"
                onPointerDown={(event) => onHandlePointerDown(event, note.id)}
              >
                ⠿
              </span>
              <span className="delete-hint" aria-hidden="true">
                ✕
              </span>
              <button
                type="button"
                className="note-title"
                onClick={() => {
                  if (!reorderModeRef.current) onOpen(note.id)
                }}
              >
                {note.title.trim() ? (
                  note.title
                ) : (
                  <span className="muted">New note</span>
                )}
              </button>
            </li>
          )
        )}
        {draggingId !== null && dropLineTop !== null && (
          <div className="drop-line" style={{ top: dropLineTop }} />
        )}
      </ul>

      {notes.length === 0 && (
        <p className="empty">No notes yet — tap ➕ to create one.</p>
      )}

      {!canCreate && <p className="notice">Note limit reached.</p>}

      <div className="toolbar">
        <span className="counter">
          {notes.length} {notes.length === 1 ? 'note' : 'notes'}
        </span>
        <div className="cluster">
          <button
            type="button"
            className={`act${reorderMode ? ' active' : ''}`}
            aria-label="Reorder notes"
            aria-pressed={reorderMode}
            onClick={() => setReorderMode((m) => !m)}
          >
            ↕️
          </button>
          <button
            type="button"
            className="act"
            aria-label="New note"
            disabled={!canCreate}
            onClick={onCreate}
          >
            ➕
          </button>
        </div>
      </div>
    </main>
  )
}
