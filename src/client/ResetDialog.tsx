/**
 * The shared quota-reset dialog, portaled to document.body — the docked
 * composer contains fixed-position children, so an in-place overlay would
 * clip. Geometry and material follow the host Modal primitive (mask blur +
 * panel radius + prominent elevation); the shell's module loader serves
 * react-dom beside react, with an inline fallback if it ever does not.
 *
 * The dialog lists every available reset kind as a selectable row (the use
 * API takes only the kind; within it the server consumes the
 * soonest-expiring opportunity, which the row's meta line presents). The
 * confirm button consumes the selection — one deliberate choice, one click.
 *
 * Lifecycle notes: the options refresh under an open dialog (the 60s poll),
 * so the selection is normalized at render time; focus lands on the safe
 * action once and returns to the opener on close; Esc is handled in the
 * capture phase so the host's own Esc handling (e.g. closing the settings
 * panel) stays quiet, and Tab stays inside the dialog while it is open.
 *
 * @module dsh-zcode/client/ResetDialog
 */

import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { resetClockText, type ResetKind } from './quota.ts'

/** Locale translator. */
type T = (key: string, params?: Record<string, string | number>) => string

/** One reset kind as the dialog presents it. */
export interface ResetOption {
  kind: ResetKind
  count: number
  /** When this kind's soonest-expiring opportunity lapses, epoch ms. */
  earliestExpireAt?: number
}

export interface ResetDialogProps {
  t: T
  /** Reset kinds with at least one claimable opportunity, in display order. */
  options: readonly ResetOption[]
  /** While the use call is in flight. */
  busy: boolean
  onConfirm: (kind: ResetKind) => void
  onCancel: () => void
}

/** The module-table require this bundle's factory receives. */
declare const require: (spec: string) => unknown

type PortalFn = (children: ReactNode, container: Element) => ReactNode

/** Resolve react-dom's createPortal once; undefined falls back to inline rendering. */
const createPortal: PortalFn | undefined = (() => {
  try {
    const fn = (require('react-dom') as { createPortal?: unknown } | undefined)?.createPortal
    return typeof fn === 'function' ? (fn as PortalFn) : undefined
  } catch {
    return undefined
  }
})()

export function ResetDialog({ t, options, busy, onConfirm, onCancel }: ResetDialogProps) {
  const [selected, setSelected] = useState<ResetKind>(options[0]?.kind ?? 'FIVE_HOUR')
  // The selected kind can vanish under the open dialog (a poll sees it
  // consumed elsewhere); fall back to the first kind at render time.
  const current = options.some(option => option.kind === selected)
    ? selected
    : options[0]?.kind ?? 'FIVE_HOUR'

  const cancelRef = useRef<HTMLButtonElement>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  // Latest-value refs keep the keydown effect mount-stable against the
  // parents' inline callbacks refreshing on every poll.
  const busyRef = useRef(busy)
  const onCancelRef = useRef(onCancel)
  busyRef.current = busy
  onCancelRef.current = onCancel

  // Focus the safe action once, and hand focus back to the opener on close.
  useEffect(() => {
    const opener = document.activeElement
    cancelRef.current?.focus()
    return () => {
      if (opener instanceof HTMLElement && document.contains(opener)) opener.focus()
    }
  }, [])

  // Esc withdraws and Tab stays inside the dialog; capture phase so the
  // host's own Esc handling does not fire through this dialog.
  useEffect(() => {
    const focusables = (): HTMLElement[] => {
      const dialog = dialogRef.current
      if (dialog === null) return []
      return [...dialog.querySelectorAll<HTMLElement>('button:not(:disabled), [href], input, select, textarea')]
    }
    const onKey = (event: KeyboardEvent): void => {
      if (event.defaultPrevented) return
      if (event.key === 'Escape') {
        if (busyRef.current) return
        event.preventDefault()
        event.stopPropagation()
        onCancelRef.current()
        return
      }
      if (event.key !== 'Tab') return
      const dialog = dialogRef.current
      if (dialog === null) return
      const items = focusables()
      if (items.length === 0) return
      const first = items[0]!
      const last = items.at(-1)!
      const active = document.activeElement
      const inside = active instanceof Node && dialog.contains(active)
      if (!event.shiftKey && (active === last || !inside)) {
        event.preventDefault()
        first.focus()
      } else if (event.shiftKey && (active === first || !inside)) {
        event.preventDefault()
        last.focus()
      }
    }
    document.addEventListener('keydown', onKey, { capture: true })
    return () => { document.removeEventListener('keydown', onKey, { capture: true }) }
  }, [])

  const dialog = (
    <div
      className="dsh-zcode-overlay"
      role="presentation"
      onClick={() => { if (!busy) onCancel() }}
    >
      <div className="dsh-zcode-mask" aria-hidden />
      <div
        ref={dialogRef}
        className="dsh-zcode-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={t('resetConfirmTitle')}
        onClick={event => { event.stopPropagation() }}
      >
        <h4 className="dsh-zcode-dialog-title">{t('resetConfirmTitle')}</h4>
        <p className="dsh-zcode-dialog-body">{t('resetConfirmBody')}</p>
        <div className="dsh-zcode-options" role="radiogroup" aria-label={t('resetPickLabel')}>
          {options.map(option => {
            const active = option.kind === current
            return (
              <button
                key={option.kind}
                type="button"
                role="radio"
                aria-checked={active}
                className={`dsh-zcode-option${active ? ' dsh-zcode-option-active' : ''}`}
                disabled={busy}
                onClick={() => { setSelected(option.kind) }}
              >
                <span className="dsh-zcode-option-name">
                  <span className="dsh-zcode-option-dot" aria-hidden />
                  {option.kind === 'WEEK' ? t('resetWeekName') : t('resetFiveHourName')}
                </span>
                <span className="dsh-zcode-option-meta">
                  {t('resetCount', { count: option.count })}
                  {option.earliestExpireAt === undefined
                    ? ''
                    : ` · ${t('resetExpireAt', { time: resetClockText(option.earliestExpireAt) })}`}
                </span>
              </button>
            )
          })}
        </div>
        <div className="dsh-zcode-dialog-actions">
          <button ref={cancelRef} type="button" className="dsh-zcode-btn dsh-zcode-btn-sm dsh-zcode-btn-outline" disabled={busy} onClick={onCancel}>
            {t('resetConfirmCancel')}
          </button>
          <button
            type="button"
            className="dsh-zcode-btn dsh-zcode-btn-sm dsh-zcode-btn-primary"
            disabled={busy}
            onClick={() => { onConfirm(current) }}
          >
            {busy ? t('busy') : t('resetConfirmOk')}
          </button>
        </div>
      </div>
    </div>
  )
  return createPortal === undefined ? dialog : createPortal(dialog, document.body)
}
