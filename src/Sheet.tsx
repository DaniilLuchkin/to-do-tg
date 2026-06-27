import { useEffect, useRef, type ReactNode } from 'react'

type SheetProps = {
  onClose: () => void
  ariaLabel: string
  children: ReactNode
}

// A bottom sheet over a full-screen scrim. Tapping the scrim or Telegram's
// BackButton closes it; the BackButton is shown while the sheet is mounted.
export default function Sheet({ onClose, ariaLabel, children }: SheetProps) {
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useEffect(() => {
    const wa = window.Telegram?.WebApp
    wa?.BackButton?.show?.()
    const cb = () => onCloseRef.current()
    wa?.BackButton?.onClick?.(cb)
    return () => {
      wa?.BackButton?.offClick?.(cb)
      wa?.BackButton?.hide?.()
    }
  }, [])

  return (
    <>
      <div className="scrim" onClick={onClose} />
      <div className="sheet" role="dialog" aria-label={ariaLabel}>
        {children}
      </div>
    </>
  )
}
