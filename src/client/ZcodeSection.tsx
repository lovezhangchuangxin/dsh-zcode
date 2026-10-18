/**
 * The ZCode settings section: sign-in state, the 5-hour quota card with its
 * reset clock, and the quota-reset card (confirm dialog → consume one
 * five-hour reset). All state comes from the plugin-owned routes; every
 * action is one loopback POST authorized by the status document's control
 * key.
 *
 * @module dsh-zcode/client/ZcodeSection
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  isZcodeWebStatus, ZCODE_UI_CANCEL_PATH, ZCODE_UI_CONTROL_HEADER, ZCODE_UI_SIGNIN_PATH,
  ZCODE_UI_SIGNOUT_PATH, ZCODE_UI_STATUS_PATH, type ZcodeQuotaDoc, type ZcodeWebStatus,
} from '../webui-protocol.ts'
import {
  countdownText, fetchQuota, fetchReset, fiveHourLimit, QUOTA_POLL_MS, resetClockText, usedPercent, useReset,
} from './quota.ts'

/** Locale translator. */
type T = (key: string, params?: Record<string, string | number>) => string

export interface ZcodeSectionProps {
  t: T
  /** Shell-provided: close the settings panel. */
  close?: () => void
}

/* One visual language for the section: quiet surfaces, a single blue accent,
   and traffic-light states on the usage bar. Neutral grays keep both themes
   readable; text colors inherit. */
const styles = {
  section: { display: 'flex', flexDirection: 'column', gap: 14 } as const,
  card: {
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
    padding: '16px 18px',
    border: '1px solid rgba(128,128,128,.22)',
    borderRadius: 12,
    background: 'rgba(128,128,128,.06)',
  },
  title: { margin: 0, fontSize: 14, fontWeight: 600, letterSpacing: '.01em' },
  intro: { margin: 0, fontSize: 13, opacity: .75, lineHeight: 1.6 },
  row: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' } as const,
  primary: {
    padding: '8px 16px', borderRadius: 8, border: 'none', cursor: 'pointer',
    background: '#3b82f6', color: '#fff', fontSize: 13, fontWeight: 500,
  },
  outline: {
    padding: '8px 14px', borderRadius: 8, cursor: 'pointer', fontSize: 13,
    background: 'transparent', color: 'inherit', border: '1px solid rgba(128,128,128,.45)',
  },
  ghost: {
    padding: '3px 10px', borderRadius: 6, cursor: 'pointer', fontSize: 12,
    background: 'transparent', color: 'inherit', border: '1px solid rgba(128,128,128,.35)',
  },
  linkButton: {
    padding: '8px 14px', borderRadius: 8, cursor: 'pointer', fontSize: 13, fontWeight: 500,
    background: 'transparent', border: '1px solid rgba(128,128,128,.45)',
    color: '#3b82f6', textDecoration: 'none',
  },
  muted: { margin: 0, fontSize: 12.5, opacity: .68 },
  error: { margin: 0, fontSize: 13, color: '#e5484d', wordBreak: 'break-word', lineHeight: 1.5 },
  mono: { fontSize: 12, fontFamily: 'ui-monospace, monospace', wordBreak: 'break-all', opacity: .8 },
  factRow: { display: 'flex', gap: 8, fontSize: 13, alignItems: 'baseline' } as const,
  badge: {
    fontSize: 10.5, padding: '2px 8px', borderRadius: 999,
    border: '1px solid rgba(128,128,128,.45)', textTransform: 'uppercase', letterSpacing: '.06em',
    opacity: .8,
  },
  heroRow: { display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12 } as const,
  heroValue: { fontSize: 26, fontWeight: 700, lineHeight: 1, fontVariantNumeric: 'tabular-nums' } as const,
  heroUnit: { fontSize: 13, opacity: .6, marginLeft: 2 },
  heroSide: { display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2 } as const,
  heroClock: { fontSize: 15, fontWeight: 600, fontVariantNumeric: 'tabular-nums' },
  bar: { height: 8, borderRadius: 999, background: 'rgba(128,128,128,.25)', overflow: 'hidden' } as const,
  barFill: { height: '100%', borderRadius: 999, transition: 'width .3s ease' } as const,
  metaRow: { display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 12, opacity: .65 } as const,
  resetCard: {
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
    padding: '14px 18px',
    border: '1px solid rgba(59,130,246,.35)',
    borderLeft: '3px solid #3b82f6',
    borderRadius: 12,
    background: 'rgba(59,130,246,.06)',
  },
  overlay: {
    position: 'fixed', inset: 0, zIndex: 1000,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    background: 'rgba(0,0,0,.45)', padding: 24,
  } as const,
  dialog: {
    width: 'min(380px, 92vw)',
    display: 'flex', flexDirection: 'column', gap: 14,
    padding: 20,
    borderRadius: 14,
    border: '1px solid rgba(128,128,128,.25)',
    background: '#1e1e21',
    color: '#f4f4f5',
    boxShadow: '0 20px 50px rgba(0,0,0,.35)',
  } as const,
  notice: {
    margin: 0, fontSize: 12.5, padding: '6px 10px', borderRadius: 8,
    background: 'rgba(59,130,246,.1)', color: 'inherit',
  },
} as const

/** Progress color by consumed share: calm blue, warning amber, critical red. */
function usageColor(usedPercentValue: number): string {
  if (usedPercentValue >= 85) return '#ef4444'
  if (usedPercentValue >= 60) return '#f59e0b'
  return '#3b82f6'
}

export function ZcodeSection({ t }: ZcodeSectionProps) {
  const [doc, setDoc] = useState<ZcodeWebStatus | null>(null)
  /** Which operation last failed: reading state vs performing an action. */
  const [failure, setFailure] = useState<'load' | 'action' | null>(null)
  const [busy, setBusy] = useState(false)
  const [copyState, setCopyState] = useState<'copied' | 'failed' | null>(null)
  /** Sequence guard: a late-arriving older response must not clobber a newer doc. */
  const lastIssued = useRef(0)
  const lastApplied = useRef(0)
  const copyTimer = useRef<ReturnType<typeof setTimeout>>()

  const applyDoc = useCallback((parsed: ZcodeWebStatus, issued: number): void => {
    if (issued < lastApplied.current) return
    lastApplied.current = issued
    setDoc(parsed)
  }, [])

  const refresh = useCallback(async (): Promise<void> => {
    const issued = ++lastIssued.current
    try {
      const res = await fetch(ZCODE_UI_STATUS_PATH, { cache: 'no-store' })
      const parsed: unknown = await res.json().catch(() => null)
      if (!res.ok || !isZcodeWebStatus(parsed)) throw new Error('bad status document')
      applyDoc(parsed, issued)
      setFailure(null)
    } catch {
      setFailure('load')
    }
  }, [applyDoc])

  useEffect(() => { void refresh() }, [refresh])

  const phase = doc?.attempt?.phase
  useEffect(() => {
    const timer = setInterval(() => { void refresh() }, phase === 'running' ? 1500 : 15000)
    return () => { clearInterval(timer) }
  }, [phase, refresh])

  /** One guarded write; the answer document replaces the whole state. */
  const post = useCallback(async (path: string): Promise<void> => {
    if (doc === null) return
    setBusy(true)
    const issued = ++lastIssued.current
    try {
      const res = await fetch(path, {
        method: 'POST',
        headers: { [ZCODE_UI_CONTROL_HEADER]: doc.controlKey },
      })
      const parsed: unknown = await res.json().catch(() => null)
      if (!res.ok || !isZcodeWebStatus(parsed)) throw new Error('bad status document')
      applyDoc(parsed, issued)
      setFailure(null)
    } catch {
      setFailure('action')
    } finally {
      setBusy(false)
    }
  }, [applyDoc, doc])

  const signIn = useCallback(() => { void post(ZCODE_UI_SIGNIN_PATH) }, [post])
  const cancel = useCallback(() => { void post(ZCODE_UI_CANCEL_PATH) }, [post])
  const signOut = useCallback(() => { void post(ZCODE_UI_SIGNOUT_PATH) }, [post])

  useEffect(() => () => { if (copyTimer.current !== undefined) clearTimeout(copyTimer.current) }, [])

  const copyLink = useCallback(async (url: string): Promise<void> => {
    if (copyTimer.current !== undefined) clearTimeout(copyTimer.current)
    try {
      await navigator.clipboard.writeText(url)
      setCopyState('copied')
    } catch {
      setCopyState('failed')
      return
    }
    copyTimer.current = setTimeout(() => { setCopyState(null) }, 2000)
  }, [])

  const account = doc?.account ?? null
  const attempt = doc?.attempt ?? null
  const url = attempt?.phase === 'running' ? attempt.url : undefined
  const notice = attempt?.phase === 'running' ? (attempt.message ?? t('signingIn')) : undefined
  const terminalError = attempt?.phase === 'failed'
    ? `${t('failed')} ${attempt.error ?? ''}`.trim()
    : attempt?.phase === 'cancelled' ? t('cancelled') : undefined

  return (
    <div style={styles.section}>
      {account !== null
        ? (
          <div style={styles.card}>
            <div style={styles.heroRow}>
              <h3 style={styles.title}>{t('title')}</h3>
              <span style={styles.row}>
                <span style={styles.mono}>{account.username ?? account.userId}</span>
                <button type="button" style={styles.ghost} disabled={busy} onClick={signOut}>{t('signOut')}</button>
              </span>
            </div>
            <div style={styles.metaRow}>
              <span>{t('userId')}: <span style={styles.mono}>{account.userId}</span></span>
              <span>{t('signedAt')} {new Date(account.grantedAt).toLocaleString()}</span>
            </div>
          </div>
        )
        : attempt?.phase === 'running' || attempt?.phase === 'succeeded'
          ? (
            <div style={styles.card}>
              <h3 style={styles.title}>{t('title')}</h3>
              <p style={styles.muted}>{notice ?? t('signingIn')}</p>
              {url === undefined ? null : (
                <>
                  <p style={styles.muted}>{t('needAction')}</p>
                  <div style={styles.row}>
                    <a style={styles.linkButton} href={url} target="_blank" rel="noreferrer">{t('openPage')}</a>
                    <button type="button" style={styles.outline} onClick={() => { void copyLink(url) }}>
                      {copyState === null ? t('copyLink') : copyState === 'copied' ? t('copied') : t('copyFailed')}
                    </button>
                    <button type="button" style={styles.outline} disabled={busy} onClick={cancel}>{t('cancel')}</button>
                  </div>
                </>
              )}
            </div>
          )
          : (
            <div style={styles.card}>
              <h3 style={styles.title}>{t('title')}</h3>
              <p style={styles.intro}>{t('intro')}</p>
              {terminalError === undefined ? null : <p style={styles.error}>{terminalError}</p>}
              <div style={styles.row}>
                <button
                  type="button"
                  style={attempt === null ? styles.primary : styles.outline}
                  // No status document yet means no control key; the button
                  // must not look clickable while it can do nothing.
                  disabled={busy || doc === null}
                  onClick={signIn}
                >
                  {attempt === null ? t('signIn') : t('retry')}
                </button>
              </div>
            </div>
          )}
      {account !== null ? <QuotaCard t={t} /> : null}
      {account !== null ? <ResetCard t={t} controlKey={doc?.controlKey} /> : null}
      {failure !== null
        ? (
          <p style={styles.error}>
            {t(failure === 'action' ? 'actionFailed' : 'loadFailed')}{' '}
            <button type="button" style={styles.ghost} onClick={() => { void refresh() }}>
              {t('reload')}
            </button>
          </p>
        )
        : null}
    </div>
  )
}

/** The 5-hour quota card: remaining share as the hero figure, reset clock beside it. */
function QuotaCard({ t }: { t: T }) {
  const [doc, setDoc] = useState<ZcodeQuotaDoc | undefined>()
  const [busy, setBusy] = useState(false)

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

  const limit = doc?.status === 'ok' ? fiveHourLimit(doc) : undefined
  const percent = limit !== undefined ? usedPercent(limit) : undefined
  const remaining = percent === undefined ? undefined : Math.max(0, 100 - percent)
  const resetAt = limit?.nextResetTime

  if (doc === undefined) {
    return (
      <div style={styles.card}>
        <div style={styles.metaRow}><span style={styles.title}>{t('quotaTitle')}</span></div>
        <p style={styles.muted}>…</p>
      </div>
    )
  }
  if (doc.status !== 'ok' || limit === undefined || percent === undefined || remaining === undefined) {
    return (
      <div style={styles.card}>
        <span style={styles.title}>{t('quotaTitle')}</span>
        <p style={styles.error}>{doc.status === 'error' ? (doc.error ?? t('quotaUnavailable')) : t('quotaUnavailable')}</p>
      </div>
    )
  }

  return (
    <div style={styles.card}>
      <div style={styles.heroRow}>
        <div style={styles.row}>
          <span style={styles.title}>{t('quotaFiveHour')}</span>
          {doc.level === undefined ? null : <span style={styles.badge}>{doc.level}</span>}
        </div>
        <button type="button" style={styles.ghost} disabled={busy} onClick={() => { void refresh(true) }}>
          {busy ? '…' : t('quotaRefresh')}
        </button>
      </div>

      <div style={styles.heroRow}>
        <div style={styles.row}>
          <span style={{ ...styles.heroValue, color: usageColor(percent) }}>{remaining}</span>
          <span style={styles.heroUnit}>%</span>
        </div>
        <div style={styles.heroSide}>
          <span style={styles.muted}>{t('quotaResetsIn')}</span>
          <span style={styles.heroClock}>{resetAt === undefined ? '—' : resetClockText(resetAt)}</span>
        </div>
      </div>

      <div style={styles.bar}>
        <div style={{ ...styles.barFill, width: `${percent}%`, background: usageColor(percent) }} />
      </div>

      <div style={styles.metaRow}>
        <span>{t('quotaUsed')} {percent}%</span>
        <span>
          {resetAt === undefined ? '' : `${t('quotaRemainingTime')} ${countdownText(resetAt)}`}
        </span>
      </div>
    </div>
  )
}

/**
 * The quota-reset card: shows claimable five-hour resets, with a confirm
 * dialog before consuming one (the official client's reset card flow).
 */
function ResetCard({ t, controlKey }: { t: T, controlKey: string | undefined }) {
  const [doc, setDoc] = useState<import('../webui-protocol.ts').ZcodeResetDoc | undefined>()
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  /** 'done' shows the success notice; 'failed' the failure text from the use result. */
  const [result, setResult] = useState<'done' | 'failed' | null>(null)
  const [resultError, setResultError] = useState<string | undefined>()

  const refresh = useCallback(async (): Promise<void> => {
    setDoc(await fetchReset())
  }, [])

  useEffect(() => {
    void refresh()
    const timer = setInterval(() => { void refresh() }, QUOTA_POLL_MS)
    return () => { clearInterval(timer) }
  }, [refresh])

  const available = doc?.status === 'ok' ? (doc.fiveHourAvailable ?? 0) : 0
  const expireAt = doc?.fiveHourEarliestExpireAt

  const confirm = useCallback(async (): Promise<void> => {
    setBusy(true)
    try {
      const used = await useReset(controlKey)
      if (used !== undefined && used.status === 'ok' && used.used === true) {
        setResult('done')
        setResultError(undefined)
      } else {
        setResult('failed')
        setResultError(used?.status === 'error' ? used.error : undefined)
      }
      setConfirming(false)
      // Fresh window, fresh availability.
      await refresh()
    } finally {
      setBusy(false)
    }
  }, [controlKey, refresh])

  return (
    <div style={styles.resetCard}>
      <div style={styles.metaRow}>
        <span style={styles.title}>{t('resetTitle')}</span>
        {doc !== undefined && doc.status === 'ok' && available > 0
          ? <span style={styles.muted}>{t('resetCount', { count: available })}</span>
          : null}
      </div>

      {doc === undefined
        ? <p style={styles.muted}>…</p>
        : doc.status !== 'ok'
          ? <p style={styles.error}>{doc.status === 'error' ? (doc.error ?? t('resetUnavailable')) : t('resetUnavailable')}</p>
          : available === 0
            ? <p style={styles.muted}>{t('resetNone')}</p>
            : (
              <>
                <p style={styles.muted}>
                  {t('resetHint')}
                  {expireAt === undefined ? '' : ` ${t('resetExpire', { time: resetClockText(expireAt) })}`}
                </p>
                <div style={styles.row}>
                  <button type="button" style={styles.primary} disabled={busy} onClick={() => { setResult(null); setConfirming(true) }}>
                    {t('resetButton')}
                  </button>
                </div>
              </>
              )}

      {result === 'done'
        ? <p style={styles.notice}>{t('resetDone')}</p>
        : result === 'failed'
          ? <p style={styles.error}>{t('resetFailed')}{resultError === undefined ? '' : `：${resultError}`}</p>
          : null}

      {confirming
        ? (
          <div style={styles.overlay} role="presentation" onClick={() => { if (!busy) setConfirming(false) }}>
            <div style={styles.dialog} role="dialog" aria-modal="true" aria-label={t('resetConfirmTitle')} onClick={event => { event.stopPropagation() }}>
              <h4 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>{t('resetConfirmTitle')}</h4>
              <p style={{ margin: 0, fontSize: 13, lineHeight: 1.6, opacity: .8 }}>{t('resetConfirmBody')}</p>
              <div style={{ ...styles.row, justifyContent: 'flex-end' }}>
                <button type="button" style={{ ...styles.outline, color: '#f4f4f5', borderColor: 'rgba(255,255,255,.25)' }} disabled={busy} onClick={() => { setConfirming(false) }}>
                  {t('resetConfirmCancel')}
                </button>
                <button type="button" style={styles.primary} disabled={busy} onClick={() => { void confirm() }}>
                  {busy ? '…' : t('resetConfirmOk')}
                </button>
              </div>
            </div>
          </div>
        )
        : null}
    </div>
  )
}
