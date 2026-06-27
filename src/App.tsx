import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Editor from './Editor'
import NotesList from './NotesList'
import Help from './Help'
import Donate from './Donate'
import Sheet from './Sheet'
import {
  initNotes,
  saveIndex,
  saveNoteContent,
  removeNoteContent,
  serializeIndex,
  bytesOf,
  newId,
  titleOf,
  MAX_VALUE_BYTES,
  MAX_NOTES,
  type NoteMeta,
  type Row,
} from './storage'
import { parseSharedNote, readStartParam } from './share'

type View = 'list' | 'editor' | 'help' | 'donate'

export default function App() {
  const [notes, setNotes] = useState<NoteMeta[]>([])
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState<'corrupt' | 'future' | null>(null)
  const [view, setView] = useState<View>('list')
  const [currentId, setCurrentId] = useState<string | null>(null)
  // A note opened via a share link, awaiting the user's "save" confirmation.
  const [incoming, setIncoming] = useState<Row[] | null>(null)

  const notesRef = useRef<NoteMeta[]>(notes)
  notesRef.current = notes
  // Hydration guard: no writes until the initial load has completed cleanly.
  const hydrated = useRef(false)

  useEffect(() => {
    let active = true
    void (async () => {
      // 1) Load notes from storage in its OWN try/catch. ONLY a genuine
      //    storage read failure may surface the "Couldn't read your notes"
      //    screen — never share-link parsing.
      try {
        const res = await initNotes()
        if (!active) return
        setNotes(res.notes)
        if (res.error) {
          // Preserve-and-bail: surface an error, never write over the data.
          setError(res.error)
          setLoaded(true)
          return
        }
        hydrated.current = true
        setLoaded(true)
      } catch {
        if (active) {
          setError('corrupt')
          setLoaded(true)
        }
        return
      }

      // 2) SEPARATELY, after successful hydration, handle an incoming shared
      //    note. Fully isolated: any failure here is ignored and the user
      //    just lands on their normal list — it never sets the error state.
      if (!active) return
      try {
        const param = readStartParam()
        if (param) {
          const rows = parseSharedNote(param)
          if (rows) setIncoming(rows)
        }
      } catch {
        // Bad/garbled share param — proceed to the normal notes list.
      }
    })()
    return () => {
      active = false
    }
  }, [])

  const atNoteCap = notes.length >= MAX_NOTES
  // Whether one more index entry would still fit CloudStorage's per-value cap.
  // Recomputed only when the notes change, not on every render.
  const idxFits = useMemo(
    () =>
      bytesOf(
        serializeIndex([
          ...notes,
          { id: 'zzzzz00', title: '', mtime: Date.now() },
        ])
      ) <= MAX_VALUE_BYTES,
    [notes]
  )
  const canCreate = !atNoteCap && idxFits
  const limitMessage = atNoteCap
    ? `Note limit reached (${MAX_NOTES}).`
    : !idxFits
      ? 'Note limit reached.'
      : null

  const openNote = useCallback((id: string) => {
    setCurrentId(id)
    setView('editor')
  }, [])

  const backToList = useCallback(() => {
    setView('list')
    setCurrentId(null)
  }, [])

  const openHelp = useCallback(() => setView('help'), [])
  const closeHelp = useCallback(() => setView('list'), [])
  const openDonate = useCallback(() => setView('donate'), [])
  const closeDonate = useCallback(() => setView('list'), [])

  // A note received via the "Paste shared note" menu → reuse the save prompt.
  const onReceiveShared = useCallback((rows: Row[]) => setIncoming(rows), [])

  const onTitleChange = useCallback((id: string, title: string) => {
    if (!hydrated.current) return
    const cur = notesRef.current
    const entry = cur.find((n) => n.id === id)
    if (!entry || entry.title === title) return
    const next = cur.map((n) =>
      n.id === id ? { ...n, title, mtime: Date.now() } : n
    )
    setNotes(next)
    void saveIndex(next)
  }, [])

  // Create: content FIRST, then index LAST. Capped at MAX_NOTES.
  const createNote = useCallback(async () => {
    if (!hydrated.current) return
    if (notesRef.current.length >= MAX_NOTES) return
    const id = newId()
    const rows: Row[] = [
      { id: newId(), text: '', checkbox: false, done: false, level: 0 },
    ]
    const next: NoteMeta[] = [
      ...notesRef.current,
      { id, title: '', mtime: Date.now() },
    ]
    if (bytesOf(serializeIndex(next)) > MAX_VALUE_BYTES) return
    await saveNoteContent(id, rows)
    setNotes(next)
    await saveIndex(next)
    setCurrentId(id)
    setView('editor')
  }, [])

  // Delete: index FIRST (allow empty — explicit user delete), then content.
  const deleteNote = useCallback(async (id: string) => {
    if (!hydrated.current) return
    const next = notesRef.current.filter((n) => n.id !== id)
    setNotes(next)
    await saveIndex(next, true)
    await removeNoteContent(id)
  }, [])

  const reorderNotes = useCallback((next: NoteMeta[]) => {
    if (!hydrated.current) return
    setNotes(next)
    void saveIndex(next)
  }, [])

  const dismissShared = useCallback(() => setIncoming(null), [])

  // Save a shared note as a new note (fresh ids), respecting the 50-note cap.
  const saveShared = useCallback(async () => {
    if (!hydrated.current) return
    const rows = incoming
    if (!rows) return
    if (notesRef.current.length >= MAX_NOTES) return
    const id = newId()
    const fresh: Row[] = rows.map((r) => ({ ...r, id: newId() }))
    const next: NoteMeta[] = [
      ...notesRef.current,
      { id, title: titleOf(fresh), mtime: Date.now() },
    ]
    if (bytesOf(serializeIndex(next)) > MAX_VALUE_BYTES) return
    await saveNoteContent(id, fresh)
    setNotes(next)
    await saveIndex(next)
    setIncoming(null)
    setCurrentId(id)
    setView('editor')
  }, [incoming])

  // After a whole-app backup import (storage already written).
  const onNotesReplaced = useCallback((next: NoteMeta[]) => {
    setNotes(next)
    hydrated.current = true
    setError(null)
  }, [])

  if (!loaded) return <main className="app" />

  if (error) {
    return (
      <main className="app">
        <h1 className="notes-head">Couldn't read your notes</h1>
        <p className="notice">
          {error === 'future'
            ? 'These notes were saved by a newer version of the app. Your data is preserved — please update To-Do Notes to open them.'
            : 'Your saved notes could not be read. Your data has been preserved and left untouched. Please reload, or restore from a backup file.'}
        </p>
      </main>
    )
  }

  if (view === 'help') {
    return <Help onClose={closeHelp} />
  }

  if (view === 'donate') {
    return <Donate onClose={closeDonate} />
  }

  if (view === 'editor' && currentId) {
    return (
      <Editor
        key={currentId}
        noteId={currentId}
        onBack={backToList}
        onTitleChange={onTitleChange}
      />
    )
  }

  return (
    <>
      <NotesList
        notes={notes}
        canCreate={canCreate}
        limitMessage={limitMessage}
        onOpen={openNote}
        onCreate={createNote}
        onDelete={deleteNote}
        onReorder={reorderNotes}
        onHelp={openHelp}
        onDonate={openDonate}
        onReceiveShared={onReceiveShared}
        onNotesReplaced={onNotesReplaced}
      />

      {incoming && (
        <Sheet onClose={dismissShared} ariaLabel="Save shared note">
          <p className="sheet-text">
            {atNoteCap
              ? `Someone shared a note with you, but you're at the ${MAX_NOTES}-note limit. Delete a note to make room, then reopen the link.`
              : 'Someone shared a note with you. Save it to your notes?'}
          </p>
          <div className="sheet-actions">
            <button type="button" className="btn" onClick={dismissShared}>
              Dismiss
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={atNoteCap}
              onClick={saveShared}
            >
              Save
            </button>
          </div>
        </Sheet>
      )}
    </>
  )
}
