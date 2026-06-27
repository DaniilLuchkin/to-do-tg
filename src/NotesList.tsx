import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
} from 'react'
import IconButton from './IconButton'
import Icon from './Icon'
import Feedback from './Feedback'
import PasteShared from './PasteShared'
import Sheet from './Sheet'
import { useRowGestures, SWIPE_DELETE_PX } from './useRowGestures'
import {
  exportAllNotes,
  importAllNotes,
  APP_VERSION,
  SCHEMA_VERSION,
  MAX_NOTES,
  type NoteMeta,
  type Row,
} from './storage'

type NotesListProps = {
  notes: NoteMeta[]
  canCreate: boolean
  limitMessage: string | null
  onOpen: (id: string) => void
  onCreate: () => void
  onDelete: (id: string) => void
  onReorder: (notes: NoteMeta[]) => void
  onHelp: () => void
  onDonate: () => void
  onReceiveShared: (rows: Row[]) => void
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
  onDonate,
  onReceiveShared,
  onNotesReplaced,
}: NotesListProps) {
  const [reorderMode, setReorderMode] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [aboutOpen, setAboutOpen] = useState(false)
  const [feedbackOpen, setFeedbackOpen] = useState(false)
  const [pasteOpen, setPasteOpen] = useState(false)
  const [pendingImport, setPendingImport] = useState<string | null>(null)
  const [importNotice, setImportNotice] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [confirmingId, setConfirmingId] = useState<string | null>(null)

  const notesRef = useRef<NoteMeta[]>(notes)
  notesRef.current = notes
  const reorderModeRef = useRef(false)
  reorderModeRef.current = reorderMode

  // Drag-to-reorder + swipe-left-to-delete (shared with the editor rows).
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
  } = useRowGestures<NoteMeta>({
    itemsRef: notesRef,
    reorderModeRef,
    onReorder,
    swipeIgnoreSelector: '.handle',
    swipeClampMax: 0,
    onSwipeCommit: (id, dx) => {
      if (dx < -SWIPE_DELETE_PX) setConfirmingId(id)
    },
  })

  const closeMenu = useCallback(() => {
    setMenuOpen(false)
    setAboutOpen(false)
  }, [])

  // Telegram BackButton dismisses the dropdown menu while it's open. (Sheets —
  // import confirm, feedback, paste — manage their own BackButton.)
  useEffect(() => {
    if (!menuOpen) return
    const wa = window.Telegram?.WebApp
    wa?.BackButton?.show?.()
    const cb = () => closeMenu()
    wa?.BackButton?.onClick?.(cb)
    return () => {
      wa?.BackButton?.offClick?.(cb)
      wa?.BackButton?.hide?.()
    }
  }, [menuOpen, closeMenu])

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
    setImportNotice(null)
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
    if (result.ok) {
      setImportNotice(null)
      onNotesReplaced(result.notes)
    } else if (result.reason === 'limit') {
      setImportNotice(`Note limit reached (${MAX_NOTES})`)
    }
  }, [pendingImport, onNotesReplaced])

  const onAddHome = useCallback(() => {
    closeMenu()
    window.Telegram?.WebApp?.addToHomeScreen?.()
  }, [closeMenu])

  const openDonate = useCallback(() => {
    closeMenu()
    onDonate()
  }, [closeMenu, onDonate])

  const openFeedback = useCallback(() => {
    closeMenu()
    setFeedbackOpen(true)
  }, [closeMenu])

  const openPaste = useCallback(() => {
    closeMenu()
    setPasteOpen(true)
  }, [closeMenu])

  const onPasteReceived = useCallback(
    (rows: Row[]) => {
      setPasteOpen(false)
      onReceiveShared(rows)
    },
    [onReceiveShared]
  )

  // Vertical swipes stay globally locked (Wallet-style); reorder never undoes
  // the lock, so toggling reorder mode just reasserts the disabled state.
  useEffect(() => {
    window.Telegram?.WebApp?.disableVerticalSwipes?.()
  }, [reorderMode])

  // Keep the lock (and clear any touch-action) if this screen unmounts
  // mid-interaction — never leave vertical swipes re-enabled.
  useEffect(() => {
    return () => {
      window.Telegram?.WebApp?.disableVerticalSwipes?.()
      document.body.style.touchAction = ''
    }
  }, [])

  return (
    <main className="app">
      <header className="list-head">
        <div className="head-left">
          <h1 className="title">Notes</h1>
          <span className="caption">
            {notes.length}/{MAX_NOTES}
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
            <button type="button" className="menu-row" onClick={openDonate}>
              <span className="menu-icon">
                <Icon name="heart" size={20} />
              </span>
              <span className="menu-label">Donate</span>
            </button>
            <button type="button" className="menu-row" onClick={openFeedback}>
              <span className="menu-icon">
                <Icon name="message" size={20} />
              </span>
              <span className="menu-label">Send feedback</span>
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
            <button type="button" className="menu-row" onClick={openPaste}>
              <span className="menu-icon">
                <Icon name="clipboard" size={20} />
              </span>
              <span className="menu-label">Paste shared note</span>
            </button>
            <button type="button" className="menu-row" onClick={onAddHome}>
              <span className="menu-icon">
                <Icon name="home" size={20} />
              </span>
              <span className="menu-label">Add to home screen</span>
            </button>
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
        <Sheet
          onClose={() => setPendingImport(null)}
          ariaLabel="Confirm import"
        >
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
        </Sheet>
      )}

      {feedbackOpen && <Feedback onClose={() => setFeedbackOpen(false)} />}

      {pasteOpen && (
        <PasteShared
          onClose={() => setPasteOpen(false)}
          onReceived={onPasteReceived}
        />
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
              {reorderMode && (
                <IconButton
                  icon="close"
                  label="Delete note"
                  size={20}
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={() => setConfirmingId(note.id)}
                />
              )}
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

      {importNotice && <p className="notice">{importNotice}</p>}

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
