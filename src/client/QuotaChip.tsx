/**
 * Bottom-bar quota badge: mounted in the conversation input's right slot, it
 * renders only while the conversation's current model rides the zcode-glm
 * route. Shows the 5-hour window's remaining share and reset countdown;
 * clicking forces a refresh.
 *
 * @module dsh-zcode/client/QuotaChip
 */

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import { fetchQuota, fiveHourLimit, QUOTA_POLL_MS, resetClockText, usedPercent } from './quota.ts'
import type { DirectoryStoreLike } from './runtime.ts'
import type { ZcodeQuotaDoc } from '../webui-protocol.ts'

/** Locale translator. */
type T = (key: string) => string

export function QuotaChip({ directory, t }: { directory: DirectoryStoreLike, t: T }) {
  const [doc, setDoc] = useState<ZcodeQuotaDoc | undefined>()
  const [busy, setBusy] = useState(false)

  // All hooks run unconditionally; the visibility decision comes after them.
  const subscribe = useCallback((listener: () => void) => directory.subscribe(listener), [directory])
  const readSnapshot = useCallback(() => directory.getSnapshot(), [directory])
  const selection = useSyncExternalStore(subscribe, readSnapshot, readSnapshot).current

  const refresh = useCallback(async (force: boolean): Promise<void> => {
    setBusy(true)
    try {
      setDoc(await fetchQuota(force))
    } finally {
      setBusy(false)
    }
  }, [])

  useEffect(() => {
    void refresh(false)
    const timer = setInterval(() => { void refresh(false) }, QUOTA_POLL_MS)
    return () => { clearInterval(timer) }
  }, [refresh])

  // Hidden on every non-zcode conversation: the badge speaks for this route only.
  if (selection == null || selection.provider !== 'zcode-glm') return null

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
    ? (doc === undefined ? '…' : t('quotaUnavailable'))
    : [
      ...(remainingShare !== undefined ? [`${remainingShare}%`] : []),
      ...(resetAt !== undefined ? [resetClockText(resetAt)] : []),
    ].join(' · ')
  const detail = resetAt !== undefined
    ? t('quotaChipTitle').replace('{time}', () => new Date(resetAt).toLocaleString())
    : t('quotaChipTitlePlain')
  /** Traffic-light dot: calm while plenty remains, amber and red as it drains. */
  const dot = remainingShare === undefined
    ? 'rgba(128,128,128,.6)'
    : remainingShare > 40 ? '#22c55e' : remainingShare > 15 ? '#f59e0b' : '#ef4444'

  return (
    <button
      type="button"
      title={detail}
      aria-label={detail}
      disabled={busy}
      onClick={() => { void refresh(true) }}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 6,
        padding: '3px 10px', fontSize: 12, lineHeight: 1.4,
        background: 'rgba(128,128,128,.08)', color: 'inherit', opacity: busy ? 0.5 : 0.9,
        border: '1px solid rgba(128,128,128,.3)', borderRadius: 999,
        cursor: busy ? 'default' : 'pointer', fontVariantNumeric: 'tabular-nums',
      }}
    >
      <span aria-hidden style={{ width: 7, height: 7, borderRadius: '50%', background: dot, flex: '0 0 auto' }} />
      <span aria-hidden style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.03em' }}>GLM</span>
      <span>{label}</span>
    </button>
  )
}
