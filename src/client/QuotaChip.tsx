/**
 * Bottom-bar quota badge: mounted in the conversation input's right slot, it
 * renders only while the conversation's current model rides the zcode-glm
 * route. Shows the 5-hour window's remaining share and reset clock; clicking
 * forces a refresh. When a five-hour reset opportunity is available, a small
 * reset button appears beside the badge and opens the shared confirm dialog.
 *
 * @module dsh-zcode/client/QuotaChip
 */

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import {
  fetchControlKey, fetchQuota, fetchReset, fiveHourLimit, QUOTA_POLL_MS, resetClockText, usedPercent, useReset,
} from './quota.ts'
import { ResetDialog } from './ResetDialog.tsx'
import type { DirectoryStoreLike } from './runtime.ts'
import type { ZcodeQuotaDoc, ZcodeResetDoc } from '../webui-protocol.ts'

/** Locale translator. */
type T = (key: string, params?: Record<string, string | number>) => string

export function QuotaChip({ directory, t }: { directory: DirectoryStoreLike, t: T }) {
  const [doc, setDoc] = useState<ZcodeQuotaDoc | undefined>()
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
      setDoc(await fetchQuota(force))
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

  useEffect(() => {
    void refresh(false)
    void refreshResets()
    const timer = setInterval(() => {
      void refresh(false)
      void refreshResets()
    }, QUOTA_POLL_MS)
    return () => { clearInterval(timer) }
  }, [refresh, refreshResets])

  const confirmReset = useCallback(async (): Promise<void> => {
    setBusy(true)
    try {
      const used = await useReset(controlKey)
      setResetFailed(!(used !== undefined && used.status === 'ok' && used.used === true))
      setConfirming(false)
      await Promise.all([refresh(true), refreshResets()])
    } finally {
      setBusy(false)
    }
  }, [controlKey, refresh, refreshResets])

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

  const resetsAvailable = resetDoc?.status === 'ok' ? (resetDoc.fiveHourAvailable ?? 0) : 0
  const earliestExpire = resetDoc?.fiveHourEarliestExpireAt

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
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
      {resetsAvailable > 0
        ? (
          <button
            type="button"
            title={t('resetChipTitle')}
            aria-label={t('resetChipTitle')}
            disabled={busy}
            onClick={() => { setResetFailed(false); setConfirming(true) }}
            style={{
              padding: '3px 10px', fontSize: 12, lineHeight: 1.4,
              background: 'rgba(59,130,246,.12)', color: '#3b82f6', fontWeight: 500,
              border: '1px solid rgba(59,130,246,.4)', borderRadius: 999,
              cursor: busy ? 'default' : 'pointer',
            }}
          >
            {t('resetButton')}
          </button>
        )
        : null}
      {resetFailed
        ? <span style={{ fontSize: 11, color: '#e5484d' }} title={t('resetFailed')}>!</span>
        : null}
      {confirming
        ? (
          <ResetDialog
            t={t}
            busy={busy}
            detail={earliestExpire === undefined ? undefined : t('resetExpire', { time: resetClockText(earliestExpire) })}
            onConfirm={() => { void confirmReset() }}
            onCancel={() => { setConfirming(false) }}
          />
        )
        : null}
    </span>
  )
}
