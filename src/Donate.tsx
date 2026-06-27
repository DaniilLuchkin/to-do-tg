import { useCallback, useEffect, useRef, useState } from 'react'
import Icon from './Icon'
import IconButton from './IconButton'
import { CONFIG, type DonateStarTier } from './config'

// Rely on Telegram's BackButton when present; only render an in-app back in
// the browser fallback.
const HAS_BACK_BUTTON = !!window.Telegram?.WebApp?.BackButton

type DonateProps = {
  onClose: () => void
}

function startTier(tier: DonateStarTier, onPaid: () => void): void {
  const wa = window.Telegram?.WebApp
  if (wa?.openInvoice) {
    wa.openInvoice(tier.link, (status) => {
      if (status === 'paid') onPaid()
      // "failed" / "cancelled" / "pending" → no nag.
    })
  } else if (wa?.openTelegramLink) {
    wa.openTelegramLink(tier.link)
  } else {
    window.open(tier.link, '_blank')
  }
}

export default function Donate({ onClose }: DonateProps) {
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

  const showToast = useCallback((text: string) => {
    setToast(text)
    window.clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() => setToast(null), 1800)
  }, [])

  const copyAddress = useCallback(
    (address: string, ticker: string) => {
      const clip = navigator.clipboard
      if (clip && typeof clip.writeText === 'function') {
        clip.writeText(address).then(
          () => showToast(`Copied ${ticker} address`),
          () => {
            // selection fallback — the address stays selectable on screen
          }
        )
      }
    },
    [showToast]
  )

  const tiers = CONFIG.donateStars.filter((t) => t.link !== '')
  const coins = CONFIG.crypto.filter((c) => c.address !== '')

  return (
    <main className="app donate">
      {!HAS_BACK_BUTTON && (
        <div className="topbar">
          <div className="bar-actions">
            <IconButton
              icon="chevron-left"
              label="Back"
              onClick={onClose}
            />
          </div>
        </div>
      )}

      <h1 className="title donate-title">Donate</h1>

      <p className="donate-intro">
        <span className="donate-heart" aria-hidden="true">
          <Icon name="heart" size={18} />
        </span>
        To-Do Notes is free and open source. If it helps you, you can support
        development — thank you ❤️
      </p>

      {tiers.length > 0 && (
        <section className="donate-section">
          <h2 className="donate-h2">Support with Telegram Stars</h2>
          <div className="star-tiers">
            {tiers.map((tier) => (
              <button
                key={tier.label}
                type="button"
                className="btn star-tier"
                onClick={() => startTier(tier, () => showToast('Thank you ❤️'))}
              >
                <span className="star-tier-label">{tier.label}</span>
                <span className="star-tier-amount">
                  {tier.stars}
                  <Icon name="star" size={15} />
                </span>
              </button>
            ))}
          </div>
        </section>
      )}

      {coins.length > 0 && (
        <section className="donate-section">
          <h2 className="donate-h2">
            {tiers.length > 0 ? 'Or with crypto' : 'Support with crypto'}
          </h2>
          <ul className="crypto-list">
            {coins.map((coin) => (
              <li className="crypto-row" key={`${coin.ticker}-${coin.name}`}>
                <div className="crypto-head">
                  <span className="crypto-name">{coin.name}</span>
                  <span className="crypto-ticker">{coin.ticker}</span>
                </div>
                <div className="crypto-addr-row">
                  <code className="crypto-addr">{coin.address}</code>
                  <IconButton
                    icon="copy"
                    label={`Copy ${coin.ticker} address`}
                    size={20}
                    onClick={() => copyAddress(coin.address, coin.ticker)}
                  />
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {toast && <div className="toast">{toast}</div>}
    </main>
  )
}
