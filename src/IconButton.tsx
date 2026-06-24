import type { PointerEvent as ReactPointerEvent } from 'react'
import Icon, { type IconName } from './Icon'

type IconButtonProps = {
  icon: IconName
  label: string
  onClick?: () => void
  onPointerDown?: (event: ReactPointerEvent<HTMLButtonElement>) => void
  disabled?: boolean
  active?: boolean
  pressed?: boolean
  variant?: 'ghost' | 'surface' | 'primary'
  size?: number
}

// One consistent icon button: ≥44px hit area, mono icon, optional surface fill.
export default function IconButton({
  icon,
  label,
  onClick,
  onPointerDown,
  disabled = false,
  active = false,
  pressed,
  variant = 'ghost',
  size = 22,
}: IconButtonProps) {
  return (
    <button
      type="button"
      className={`iconbtn ${variant}${active ? ' active' : ''}`}
      aria-label={label}
      aria-pressed={pressed}
      disabled={disabled}
      onPointerDown={onPointerDown}
      onClick={onClick}
    >
      <Icon name={icon} size={size} />
    </button>
  )
}
