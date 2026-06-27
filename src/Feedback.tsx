import { useCallback, useEffect, useRef, useState } from 'react'
import Icon from './Icon'
import IconButton from './IconButton'
import { CONFIG } from './config'

type FeedbackProps = {
  onClose: () => void
}

function openTelegram(url: string): void {
  const wa = window.Telegram?.WebApp
  if (wa?.openTelegramLink) wa.openTelegramLink(url)
  else window.open(url, '_blank')
}

export default function Feedback({ onClose }: FeedbackProps) {
  const [toast, setToast] = useState<string | null>(null)
  const toastTimer = useRef<number | undefined>(undefined)

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

  useEffect(() => {
    return () => window.clearTimeout(toastTimer.current)
  }, [])

  const copyEmail = useCallback(() => {
    const clip = navigator.clipboard
    if (clip && typeof clip.writeText === 'function') {
      clip.writeText(CONFIG.feedbackEmail).then(
        () => {
          setToast('Copied email')
          window.clearTimeout(toastTimer.current)
          toastTimer.current = window.setTimeout(() => setToast(null), 1800)
        },
        () => {
          // email text stays selectable on screen as a fallback
        }
      )
    }
  }, [])

  const tg = CONFIG.feedbackTelegram
  const email = CONFIG.feedbackEmail
  const mailto = `mailto:${email}?subject=${encodeURIComponent('To-Do Notes feedback')}`

  return (
    <>
      <div className="scrim" onClick={onClose} />
      <div className="sheet" role="dialog" aria-label="Send feedback">
        <p className="sheet-title">Send feedback</p>
        <p className="sheet-text">
          Found a bug or have an idea? I'd love to hear it.
        </p>

        <div className="feedback-actions">
          {tg !== '' && (
            <button
              type="button"
              className="btn btn-primary feedback-btn"
              onClick={() => openTelegram(tg)}
            >
              <Icon name="message" size={18} />
              Message on Telegram
            </button>
          )}

          {email !== '' && (
            <a className="btn feedback-btn" href={mailto}>
              <Icon name="mail" size={18} />
              Email
            </a>
          )}
        </div>

        {email !== '' && (
          <div className="feedback-email-row">
            <code className="feedback-email">{email}</code>
            <IconButton
              icon="copy"
              label="Copy email address"
              size={20}
              onClick={copyEmail}
            />
          </div>
        )}

        <div className="sheet-actions">
          <button type="button" className="btn" onClick={onClose}>
            Close
          </button>
        </div>
      </div>

      {toast && <div className="toast">{toast}</div>}
    </>
  )
}
