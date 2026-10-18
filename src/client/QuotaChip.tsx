/**
 * Bottom-bar quota badge: mounted in the conversation input's right slot, it
 * renders only while the conversation's current model rides the zcode-glm
 * route. Shows the 5-hour window's remaining share and reset countdown;
 * clicking forces a refresh.
 *
 * @module dsh-zcode/client/QuotaChip
 */

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import { countdownText, fetchQuota, fiveHourLimit, QUOTA_POLL_MS, usedPercent } from './quota.ts'
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
  const label = !hasData
    ? (doc === undefined ? '…' : t('quotaUnavailable'))
    : [
      ...(remainingShare !== undefined ? [`${remainingShare}%`] : []),
      ...(resetAt !== undefined ? [countdownText(resetAt)] : []),
    ].join(' · ')
  const detail = resetAt !== undefined
    ? t('quotaChipTitle').replace('{time}', () => new Date(resetAt).toLocaleString())
    : t('quotaChipTitlePlain')

  return (
    <button
      type="button"
      title={detail}
      aria-label={detail}
      disabled={busy}
      onClick={() => { void refresh(true) }}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 6,
        padding: '2px 8px', fontSize: 12, lineHeight: 1.4,
        background: 'transparent', color: 'inherit', opacity: busy ? 0.5 : 0.8,
        border: '1px solid rgba(128,128,128,.35)', borderRadius: 999,
        cursor: busy ? 'default' : 'pointer', fontVariantNumeric: 'tabular-nums',
      }}
    >
      <span aria-hidden style={{ fontSize: 11, fontWeight: 600, letterSpacing: '.02em' }}>GLM</span>
      <span>{label}</span>
    </button>
  )
}
