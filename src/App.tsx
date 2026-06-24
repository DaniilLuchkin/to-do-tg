import { useCallback, useEffect, useRef, useState } from 'react'
import Editor from './Editor'
import NotesList from './NotesList'
import Help from './Help'
import {
  initNotes,
  saveIndex,
  saveNoteContent,
  removeNoteContent,
  serializeIndex,
  bytesOf,
  newId,
  MAX_VALUE_BYTES,
  MAX_NOTES,
  type NoteMeta,
  type Row,
} from './storage'

type View = 'list' | 'editor' | 'help'

export default function App() {
  const [notes, setNotes] = useState<NoteMeta[]>([])
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState<'corrupt' | 'future' | null>(null)
  const [view, setView] = useState<View>('list')
  const [currentId, setCurrentId] = useState<string | null>(null)

  const notesRef = useRef<NoteMeta[]>(notes)
  notesRef.current = notes
  // Hydration guard: no writes until the initial load has completed cleanly.
  const hydrated = useRef(false)

  useEffect(() => {
    let active = true
    initNotes().then((res) => {
      if (!active) return
      setNotes(res.notes)
      if (res.error) {
        // Preserve-and-bail: surface an error, never write over the data.
        setError(res.error)
      } else {
        hydrated.current = true
      }
      setLoaded(true)
    })
    return () => {
      active = false
    }
  }, [])

  const atNoteCap = notes.length >= MAX_NOTES
  const idxFits =
    bytesOf(
      serializeIndex([
        ...notes,
        { id: 'zzzzz00', title: '', mtime: Date.now() },
      ])
    ) <= MAX_VALUE_BYTES
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
    <NotesList
      notes={notes}
      canCreate={canCreate}
      limitMessage={limitMessage}
      onOpen={openNote}
      onCreate={createNote}
      onDelete={deleteNote}
      onReorder={reorderNotes}
      onHelp={openHelp}
      onNotesReplaced={onNotesReplaced}
    />
  )
}
