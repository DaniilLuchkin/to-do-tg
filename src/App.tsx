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
  type NoteMeta,
  type Row,
} from './storage'

type View = 'list' | 'editor' | 'help'

export default function App() {
  const [notes, setNotes] = useState<NoteMeta[]>([])
  const [loaded, setLoaded] = useState(false)
  const [view, setView] = useState<View>('list')
  const [currentId, setCurrentId] = useState<string | null>(null)

  const notesRef = useRef<NoteMeta[]>(notes)
  notesRef.current = notes

  // Startup: migrate the old single list (if any) + reconcile, then render.
  useEffect(() => {
    let active = true
    initNotes().then((index) => {
      if (!active) return
      setNotes(index)
      setLoaded(true)
    })
    return () => {
      active = false
    }
  }, [])

  // Would adding one more note keep the index under the byte cap?
  const canCreate =
    bytesOf(
      serializeIndex([
        ...notes,
        { id: 'zzzzz00', title: '', mtime: Date.now() },
      ])
    ) <= MAX_VALUE_BYTES

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

  // Editor reports the note's first-line title; refresh the index cache.
  const onTitleChange = useCallback((id: string, title: string) => {
    const cur = notesRef.current
    const entry = cur.find((n) => n.id === id)
    if (!entry || entry.title === title) return
    const next = cur.map((n) =>
      n.id === id ? { ...n, title, mtime: Date.now() } : n
    )
    setNotes(next)
    void saveIndex(next)
  }, [])

  // Create: write content FIRST, then add to the index and save it LAST.
  const createNote = useCallback(async () => {
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

  // Delete: remove from the index and save it FIRST, then drop the content.
  const deleteNote = useCallback(async (id: string) => {
    const next = notesRef.current.filter((n) => n.id !== id)
    setNotes(next)
    await saveIndex(next)
    await removeNoteContent(id)
  }, [])

  const reorderNotes = useCallback((next: NoteMeta[]) => {
    setNotes(next)
    void saveIndex(next)
  }, [])

  if (!loaded) return <main className="app" />

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
      onOpen={openNote}
      onCreate={createNote}
      onDelete={deleteNote}
      onReorder={reorderNotes}
      onHelp={openHelp}
    />
  )
}
