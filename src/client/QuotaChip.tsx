/**
 * Bottom-bar quota badge: mounted in the conversation input's right slot, it
 * renders only while the conversation's current model rides the zcode-glm
 * route — and polls only then, so other conversations never touch the quota
 * routes. Shows the 5-hour window's remaining share and reset clock; clicking
 * forces a refresh. When reset opportunities are available, a quiet sibling
 * button opens the shared chooser dialog.
 *
 * @module dsh-zcode/client/QuotaChip
 */

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import type { CSSProperties } from 'react'
import {
  fetchControlKey, fetchQuota, fetchReset, fiveHourLimit, QUOTA_POLL_MS, resetClockText, usedPercent, useReset,
  type ResetKind,
} from './quota.ts'
import { ResetDialog, type ResetOption } from './ResetDialog.tsx'
import type { DirectoryStoreLike } from './runtime.ts'
import type { ZcodeQuotaDoc, ZcodeResetDoc } from '../webui-protocol.ts'

/** Locale translator. */
type T = (key: string, params?: Record<string, string | number>) => string

/** A lucide-style rotate-cw glyph at the chip's text size. */
function RotateIcon() {
  return (
    <svg
      width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden
      stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"
    >
      <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" />
      <path d="M21 3v5h-5" />
    </svg>
  )
}

export function QuotaChip({ directory, t }: { directory: DirectoryStoreLike, t: T }) {
  const [doc, setDoc] = useState<ZcodeQuotaDoc | undefined>()
  const [failed, setFailed] = useState(false)
  const [resetDoc, setResetDoc] = useState<ZcodeResetDoc | undefined>()
  const [controlKey, setControlKey] = useState<string | undefined>()
  const [busy, setBusy] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [resetFailed, setResetFailed] = useState(false)

  // All hooks run unconditionally; the visibility decision comes after them.
  const subscribe = useCallback((listener: () => void) => directory.subscribe(listener), [directory])
  const readSnapshot = useCallback(() => directory.getSnapshot(), [directory])
  const selection = useSyncExternalStore(subscribe, readSnapshot, readSnapshot).current

  const refresh = useCallback(async (force: boolean): Promise<void> => {
    setBusy(true)
    try {
      // A transient fetch failure keeps the last good snapshot.
      const next = await fetchQuota(force)
      if (next !== undefined) {
        setDoc(next)
        setFailed(false)
      } else {
        setFailed(true)
      }
    } finally {
      setBusy(false)
    }
  }, [])

  const refreshResets = useCallback(async (): Promise<void> => {
    const next = await fetchReset()
    setResetDoc(next)
    // The key rotates per dsh process; read it alongside, cheaply.
    setControlKey(await fetchControlKey())
  }, [])

  // Polling is gated on this conversation actually riding the route; a hidden
  // chip stays quiet instead of polling in the background.
  const visible = selection?.provider === 'zcode-glm'
  useEffect(() => {
    if (!visible) return
    void refresh(false)
    void refreshResets()
    const timer = setInterval(() => {
      void refresh(false)
      void refreshResets()
    }, QUOTA_POLL_MS)
    return () => { clearInterval(timer) }
  }, [visible, refresh, refreshResets])

  const confirmReset = useCallback(async (kind: ResetKind): Promise<void> => {
    setBusy(true)
    try {
      const used = await useReset(controlKey, kind)
      setResetFailed(!(used !== undefined && used.status === 'ok' && used.used === true))
      setConfirming(false)
      await Promise.all([refresh(true), refreshResets()])
    } finally {
      setBusy(false)
    }
  }, [controlKey, refresh, refreshResets])

  // Hidden on every non-zcode conversation: the badge speaks for this route only.
  if (!visible) return null

  const limit = doc !== undefined && doc.status === 'ok' ? fiveHourLimit(doc) : undefined
  const resetAt = limit?.nextResetTime
  const remainingShare = limit !== undefined ? (() => {
    const percent = usedPercent(limit)
    return percent === undefined ? undefined : 100 - percent
  })() : undefined
  const hasData = limit !== undefined && (remainingShare !== undefined || resetAt !== undefined)
  // Wall-clock reset ("23:20") is the figure the official usage page shows;
  // the full locale datetime rides in the tooltip.
  const label = !hasData
    ? (doc === undefined && !failed ? t('loading') : t('quotaUnavailable'))
    : [
      ...(remainingShare !== undefined ? [`${Math.round(remainingShare)}%`] : []),
      ...(resetAt !== undefined ? [resetClockText(resetAt)] : []),
    ].join(' · ')
  const detail = resetAt !== undefined
    ? t('quotaChipTitle', { time: new Date(resetAt).toLocaleString() })
    : t('quotaChipTitlePlain')
  /** The one colored element: a semantic status dot, amber and red as the window drains. */
  const dot = remainingShare === undefined
    ? undefined
    : remainingShare > 40 ? 'var(--dsw-alias-state-success-primary)'
      : remainingShare > 15 ? 'var(--dsw-alias-state-warn-primary)'
        : 'var(--dsw-alias-state-error-primary)'

  /** The kinds with at least one claimable opportunity, in display order. */
  const options: ResetOption[] = resetDoc?.status === 'ok'
    ? [
      ...(resetDoc.fiveHourAvailable
        ? [{
          kind: 'FIVE_HOUR' as const,
          count: resetDoc.fiveHourAvailable,
          ...(resetDoc.fiveHourEarliestExpireAt !== undefined ? { earliestExpireAt: resetDoc.fiveHourEarliestExpireAt } : {}),
        }]
        : []),
      ...(resetDoc.weekAvailable
        ? [{
          kind: 'WEEK' as const,
          count: resetDoc.weekAvailable,
          ...(resetDoc.weekEarliestExpireAt !== undefined ? { earliestExpireAt: resetDoc.weekEarliestExpireAt } : {}),
        }]
        : []),
    ]
    : []
  /** Total claimable opportunities across kinds — the chip entry appears for either. */
  const resetsAvailable = resetDoc?.status === 'ok'
    ? (resetDoc.fiveHourAvailable ?? 0) + (resetDoc.weekAvailable ?? 0)
    : 0

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
      <button
        type="button"
        className="dsh-zcode-chip"
        title={detail}
        aria-label={detail}
        disabled={busy}
        onClick={() => { void refresh(true) }}
      >
        <span
          className="dsh-zcode-chip-dot"
          style={(dot === undefined ? {} : { '--dsh-zcode-dot': dot }) as CSSProperties}
        />
        <span className="dsh-zcode-chip-tag">GLM</span>
        <span>{label}</span>
      </button>
      {resetsAvailable > 0
        ? (
          <button
            type="button"
            className="dsh-zcode-chip"
            title={t('resetChipTitle')}
            aria-label={t('resetChipTitle')}
            // No control key yet means the write can do nothing.
            disabled={busy || controlKey === undefined}
            onClick={() => { setResetFailed(false); setConfirming(true) }}
          >
            <RotateIcon />
            <span>{t('resetButton')}</span>
          </button>
        )
        : null}
      {resetFailed
        ? <span className="dsh-zcode-chip-fail" role="status" title={t('resetFailed')}>!</span>
        : null}
      {confirming && options.length > 0
        ? (
          <ResetDialog
            t={t}
            options={options}
            busy={busy}
            onConfirm={kind => { void confirmReset(kind) }}
            onCancel={() => { setConfirming(false) }}
          />
        )
        : null}
    </span>
  )
}
