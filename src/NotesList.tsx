import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import IconButton from './IconButton'
import Icon from './Icon'
import {
  exportAllNotes,
  importAllNotes,
  APP_VERSION,
  SCHEMA_VERSION,
  type NoteMeta,
} from './storage'

const SWIPE_DELETE_PX = 120

// TODO: fill in with the real Telegram Stars invoice / donation link.
const DONATE_URL = ''

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
  limitMessage: string | null
  onOpen: (id: string) => void
  onCreate: () => void
  onDelete: (id: string) => void
  onReorder: (notes: NoteMeta[]) => void
  onHelp: () => void
  onNotesReplaced: (notes: NoteMeta[]) => void
}

export default function NotesList({
  notes,
  canCreate,
  limitMessage,
  onOpen,
  onCreate,
  onDelete,
  onReorder,
  onHelp,
  onNotesReplaced,
}: NotesListProps) {
  const [reorderMode, setReorderMode] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [aboutOpen, setAboutOpen] = useState(false)
  const [pendingImport, setPendingImport] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
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

  const closeMenu = useCallback(() => {
    setMenuOpen(false)
    setAboutOpen(false)
  }, [])

  // Telegram BackButton dismisses the menu / import confirm when open.
  const overlayOpen = menuOpen || pendingImport !== null
  const dismissOverlayRef = useRef<() => void>(() => {})
  dismissOverlayRef.current = () => {
    if (pendingImport !== null) setPendingImport(null)
    else closeMenu()
  }
  useEffect(() => {
    const wa = window.Telegram?.WebApp
    if (!overlayOpen) return
    wa?.BackButton?.show?.()
    const cb = () => dismissOverlayRef.current()
    wa?.BackButton?.onClick?.(cb)
    return () => {
      wa?.BackButton?.offClick?.(cb)
      wa?.BackButton?.hide?.()
    }
  }, [overlayOpen])

  // ---- Menu actions ------------------------------------------------------

  const onExportBackup = useCallback(async () => {
    closeMenu()
    const json = await exportAllNotes()
    try {
      const blob = new Blob([json], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'todo-notes-backup.json'
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } catch {
      // best effort
    }
  }, [closeMenu])

  const onImportClick = useCallback(() => {
    fileInputRef.current?.click()
  }, [])

  const onFileChosen = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0]
      event.target.value = ''
      if (!file) return
      file
        .text()
        .then((text) => {
          closeMenu()
          setPendingImport(text)
        })
        .catch(() => {
          // ignore unreadable file
        })
    },
    [closeMenu]
  )

  const confirmImport = useCallback(async () => {
    const text = pendingImport
    setPendingImport(null)
    if (text === null) return
    const result = await importAllNotes(text)
    if (result) onNotesReplaced(result)
  }, [pendingImport, onNotesReplaced])

  const onAddHome = useCallback(() => {
    closeMenu()
    window.Telegram?.WebApp?.addToHomeScreen?.()
  }, [closeMenu])

  const onDonate = useCallback(() => {
    closeMenu()
    if (DONATE_URL) {
      window.open(DONATE_URL, '_blank')
    } else {
      // No invoice wired yet — point to the support note in Help.
      onHelp()
    }
  }, [closeMenu, onHelp])

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
      <header className="list-head">
        <div className="head-left">
          <h1 className="title">Notes</h1>
          <span className="caption">
            {notes.length} {notes.length === 1 ? 'note' : 'notes'}
          </span>
        </div>
        <div className="head-actions">
          <IconButton
            icon="reorder"
            label="Reorder notes"
            variant="surface"
            active={reorderMode}
            pressed={reorderMode}
            onClick={() => setReorderMode((m) => !m)}
          />
          <IconButton
            icon="menu"
            label="Menu"
            variant="surface"
            pressed={menuOpen}
            onClick={() => setMenuOpen((m) => !m)}
          />
        </div>
      </header>

      <input
        ref={fileInputRef}
        type="file"
        accept="application/json,.json"
        style={{ display: 'none' }}
        onChange={onFileChosen}
      />

      {menuOpen && (
        <>
          <div className="scrim" onClick={closeMenu} />
          <div className="menu" role="menu">
            <button
              type="button"
              className="menu-row"
              onClick={() => setAboutOpen((a) => !a)}
            >
              <span className="menu-icon">
                <Icon name="info" size={20} />
              </span>
              <span className="menu-label">About</span>
            </button>
            {aboutOpen && (
              <p className="menu-about">
                To-Do Notes — a minimalist notes app for Telegram. In active
                development. App v{APP_VERSION} (schema v{SCHEMA_VERSION}). “Add
                to home screen” may not be available on every device.
              </p>
            )}
            <button type="button" className="menu-row" onClick={onDonate}>
              <span className="menu-icon">
                <Icon name="heart" size={20} />
              </span>
              <span className="menu-label">Donate</span>
            </button>
            <button
              type="button"
              className="menu-row"
              onClick={() => {
                closeMenu()
                onHelp()
              }}
            >
              <span className="menu-icon">
                <Icon name="help" size={20} />
              </span>
              <span className="menu-label">Help</span>
            </button>
            <button type="button" className="menu-row" onClick={onExportBackup}>
              <span className="menu-icon">
                <Icon name="download" size={20} />
              </span>
              <span className="menu-label">Export all notes</span>
            </button>
            <button type="button" className="menu-row" onClick={onImportClick}>
              <span className="menu-icon">
                <Icon name="upload" size={20} />
              </span>
              <span className="menu-label">Import all notes</span>
            </button>
            <button type="button" className="menu-row" onClick={onAddHome}>
              <span className="menu-icon">
                <Icon name="home" size={20} />
              </span>
              <span className="menu-label">Add to home screen</span>
            </button>
            {/* TODO: future product links / sections go here. */}
            <div className="menu-row disabled" aria-disabled="true">
              <span className="menu-icon">
                <Icon name="ellipsis" size={20} />
              </span>
              <span className="menu-label">More — coming soon</span>
            </div>
          </div>
        </>
      )}

      {pendingImport !== null && (
        <>
          <div className="scrim" onClick={() => setPendingImport(null)} />
          <div className="sheet" role="dialog" aria-label="Confirm import">
            <p className="sheet-text">
              Replace all notes with the contents of this backup file? Your
              current notes are backed up first, but this can't be undone here.
            </p>
            <div className="sheet-actions">
              <button
                type="button"
                className="btn"
                onClick={() => setPendingImport(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-danger"
                onClick={confirmImport}
              >
                Replace
              </button>
            </div>
          </div>
        </>
      )}

      <ul className={`list${reorderMode ? ' reorder' : ''}`} ref={listRef}>
        {notes.map((note) =>
          confirmingId === note.id ? (
            <li className="note confirm" key={note.id}>
              <span className="confirm-text">Delete this note?</span>
              <button
                type="button"
                className="btn"
                onClick={() => setConfirmingId(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-danger"
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
        <p className="empty">No notes yet — tap + to create one.</p>
      )}

      {limitMessage && <p className="notice">{limitMessage}</p>}

      <div className="toolbar">
        <IconButton
          icon="plus"
          label="New note"
          variant="primary"
          disabled={!canCreate}
          onClick={onCreate}
        />
      </div>
    </main>
  )
}
