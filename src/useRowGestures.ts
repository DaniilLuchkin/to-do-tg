import {
  useCallback,
  useRef,
  useState,
  type MutableRefObject,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { hapticLight, beginDragLock, endDragLock } from './telegram-ui'

// Left-swipe distance (px) past which a row shows the delete cue (and, by
// convention, callers treat as a delete commit).
export const SWIPE_DELETE_PX = 120
// Direction-lock threshold and transform damping for the horizontal swipe.
const DIR_LOCK_PX = 8
const SWIPE_DAMP = 0.4
const SWIPE_CLAMP_MIN = -56

type Identified = { id: string }

type Gesture = {
  pointerId: number
  rowId: string
  startX: number
  startY: number
  mode: 'pending' | 'horizontal' | 'vertical'
}
type Drag = { pointerId: number; rowId: string; startIndex: number }

type Options<T extends Identified> = {
  // Latest list + reorder-mode flag, read live during a gesture.
  itemsRef: MutableRefObject<T[]>
  reorderModeRef: MutableRefObject<boolean>
  // Commit a reordered array (caller persists / snapshots as needed).
  onReorder: (next: T[]) => void
  // Don't begin a swipe when the pointer starts on this selector.
  swipeIgnoreSelector: string
  // Upper clamp for the swipe transform (e.g. 56 to allow a right cue, 0 not).
  swipeClampMax: number
  // Decide what a released horizontal swipe does, given the travel `dx`.
  onSwipeCommit: (id: string, dx: number) => void
}

// Shared drag-to-reorder + horizontal-swipe machinery for the editor rows and
// the notes list. Owns the row-element map, the list ref, and the drag/drop
// visual state; returns the pointer handlers and refs to wire onto the list.
export function useRowGestures<T extends Identified>(opts: Options<T>) {
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [dropLineTop, setDropLineTop] = useState<number | null>(null)

  const rowEls = useRef<Map<string, HTMLElement>>(new Map())
  const listRef = useRef<HTMLUListElement | null>(null)
  const gesture = useRef<Gesture | null>(null)
  const drag = useRef<Drag | null>(null)

  // Latest options, so the handlers below can stay referentially stable.
  const cfg = useRef(opts)
  cfg.current = opts

  const registerRow = useCallback(
    (id: string) => (el: HTMLLIElement | null) => {
      if (el) rowEls.current.set(id, el)
      else rowEls.current.delete(id)
    },
    []
  )

  const resetRowTransform = useCallback((rowId: string) => {
    const el = rowEls.current.get(rowId)
    if (!el) return
    el.style.transition = 'transform 120ms ease'
    el.style.transform = 'translateX(0)'
    el.classList.remove('will-delete')
  }, [])

  // ---- Horizontal swipe --------------------------------------------------

  const swipeDown = useCallback(
    (event: ReactPointerEvent<HTMLLIElement>, id: string) => {
      if (
        event.target instanceof Element &&
        event.target.closest(cfg.current.swipeIgnoreSelector)
      ) {
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
      if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > DIR_LOCK_PX) {
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
        const damped = Math.max(
          SWIPE_CLAMP_MIN,
          Math.min(cfg.current.swipeClampMax, dx * SWIPE_DAMP)
        )
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
        cfg.current.onSwipeCommit(g.rowId, dx)
      }
    },
    [resetRowTransform]
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
      for (const r of cfg.current.itemsRef.current) {
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
      const others = cfg.current.itemsRef.current.filter(
        (r) => r.id !== draggedId
      )
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
      const startIndex = cfg.current.itemsRef.current.findIndex(
        (r) => r.id === id
      )
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
      endDragLock()
      setDraggingId(null)
      setDropLineTop(null)

      const base = cfg.current.itemsRef.current
      const newIndex = dropIndexAmongOthers(d.rowId, event.clientY)
      if (newIndex === d.startIndex) return
      const dragged = base.find((r) => r.id === d.rowId)
      if (!dragged) return
      const arr = base.filter((r) => r.id !== d.rowId)
      arr.splice(newIndex, 0, dragged)
      cfg.current.onReorder(arr)
      hapticLight()
    },
    [dropIndexAmongOthers]
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
    endDragLock()
    setDraggingId(null)
    setDropLineTop(null)
  }, [])

  // ---- Unified per-row pointer routing -----------------------------------

  const onRowPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLLIElement>, id: string) => {
      if (cfg.current.reorderModeRef.current) {
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

  return {
    draggingId,
    dropLineTop,
    listRef,
    registerRow,
    onRowPointerDown,
    onRowPointerMove,
    onRowPointerUp,
    onRowPointerCancel,
    onHandlePointerDown,
  }
}
