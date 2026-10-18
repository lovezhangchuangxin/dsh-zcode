/**
 * The ZCode settings section: sign-in state, the browser-authorization
 * attempt with its consent link, and sign-out. All state comes from the
 * plugin-owned status route (webui.ts); every action is one loopback POST
 * authorized by the control key that route hands out.
 *
 * @module dsh-zcode/client/ZcodeSection
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  isZcodeWebStatus, ZCODE_UI_CANCEL_PATH, ZCODE_UI_CONTROL_HEADER, ZCODE_UI_SIGNIN_PATH,
  ZCODE_UI_SIGNOUT_PATH, ZCODE_UI_STATUS_PATH, type ZcodeQuotaDoc, type ZcodeWebStatus,
} from '../webui-protocol.ts'
import {
  countdownText, fetchQuota, fiveHourLimit, monthlyCreditsLimit, QUOTA_POLL_MS, resetClockText, usedPercent,
} from './quota.ts'

/** Locale translator injected through the registration's locale namespace. */
type T = (key: string) => string

export interface ZcodeSectionProps {
  t: T
  /** Shell-provided: close the settings panel. */
  close?: () => void
}

/** Poll cadence: tight while an attempt runs, relaxed otherwise. */
const RUNNING_POLL_MS = 1500
const IDLE_POLL_MS = 15000

/* Neutral styling only — the panel must read acceptably in any theme the
   shell offers; borders are translucent grays and text colors inherit. */
const styles = {
  section: { display: 'flex', flexDirection: 'column', gap: 12 } as const,
  card: {
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
    padding: '14px 16px',
    border: '1px solid rgba(128,128,128,.4)',
    borderRadius: 8,
  },
  title: { margin: 0, fontSize: 15, fontWeight: 600 },
  intro: { margin: 0, fontSize: 13, opacity: .8, lineHeight: 1.5 },
  row: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' } as const,
  primary: {
    padding: '7px 14px', borderRadius: 6, border: 'none', cursor: 'pointer',
    background: '#3b82f6', color: '#fff', fontSize: 13,
  },
  outline: {
    padding: '7px 14px', borderRadius: 6, cursor: 'pointer', fontSize: 13,
    background: 'transparent', color: 'inherit', border: '1px solid rgba(128,128,128,.5)',
  },
  linkButton: {
    padding: '7px 14px', borderRadius: 6, cursor: 'pointer', fontSize: 13,
    background: 'transparent', border: '1px solid rgba(128,128,128,.5)',
    color: '#3b82f6', textDecoration: 'none',
  },
  quotaBar: { height: 6, borderRadius: 3, background: 'rgba(128,128,128,.3)', overflow: 'hidden' } as const,
  quotaBarFill: { height: '100%', borderRadius: 3, background: '#3b82f6' } as const,
  quotaRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, fontSize: 13 } as const,
  badge: {
    fontSize: 11, padding: '1px 8px', borderRadius: 999,
    border: '1px solid rgba(128,128,128,.5)', textTransform: 'uppercase', letterSpacing: '.04em',
  },
  muted: { margin: 0, fontSize: 13, opacity: .75 },
  error: { margin: 0, fontSize: 13, color: '#e5484d', wordBreak: 'break-word' },
  mono: { fontSize: 12, fontFamily: 'ui-monospace, monospace', wordBreak: 'break-all', opacity: .8 },
  factRow: { display: 'flex', gap: 8, fontSize: 13 } as const,
} as const

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
    const timer = setInterval(() => { void refresh() }, phase === 'running' ? RUNNING_POLL_MS : IDLE_POLL_MS)
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
            <h3 style={styles.title}>{t('title')}</h3>
            <p style={styles.muted}>{t('signedInAs')}</p>
            <div style={styles.factRow}>
              <span style={styles.mono}>{account.username ?? account.userId}</span>
            </div>
            <div style={styles.factRow}>
              <span style={styles.muted}>{t('userId')}:</span>
              <span style={styles.mono}>{account.userId}</span>
            </div>
            <div style={styles.factRow}>
              <span style={styles.muted}>{t('signedAt')}:</span>
              <span style={styles.muted}>{new Date(account.grantedAt).toLocaleString()}</span>
            </div>
            <div style={styles.row}>
              <button type="button" style={styles.outline} disabled={busy} onClick={signOut}>{t('signOut')}</button>
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
      {failure !== null
        ? (
          <p style={styles.error}>
            {t(failure === 'action' ? 'actionFailed' : 'loadFailed')}{' '}
            <button type="button" style={{ ...styles.outline, padding: '2px 10px' }} onClick={() => { void refresh() }}>
              {t('reload')}
            </button>
          </p>
        )
        : null}
    </div>
  )
}

/** The Coding Plan quota card: 5-hour window, token budget, reset times. */
function QuotaCard({ t }: { t: (key: string) => string }) {
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

  const window5h = doc?.status === 'ok' ? fiveHourLimit(doc) : undefined
  const monthly = doc?.status === 'ok' ? monthlyCreditsLimit(doc) : undefined

  if (doc === undefined) {
    return (
      <div style={styles.card}>
        <div style={styles.quotaRow}><span style={styles.title}>{t('quotaTitle')}</span></div>
        <p style={styles.muted}>…</p>
      </div>
    )
  }
  if (doc.status !== 'ok') {
    return (
      <div style={styles.card}>
        <div style={styles.quotaRow}><span style={styles.title}>{t('quotaTitle')}</span></div>
        <p style={styles.error}>{doc.status === 'error' ? (doc.error ?? t('quotaUnavailable')) : t('quotaUnavailable')}</p>
      </div>
    )
  }

  const windowPercent = window5h !== undefined ? usedPercent(window5h) : undefined
  const monthlyPercent = monthly !== undefined ? usedPercent(monthly) : undefined

  return (
    <div style={styles.card}>
      <div style={styles.quotaRow}>
        <span style={styles.title}>{t('quotaTitle')}</span>
        <span style={styles.row}>
          {doc.level === undefined ? null : <span style={styles.badge}>{doc.level}</span>}
          <button type="button" style={{ ...styles.outline, padding: '2px 10px' }} disabled={busy} onClick={() => { void refresh(true) }}>
            {busy ? '…' : t('quotaRefresh')}
          </button>
        </span>
      </div>

      {window5h === undefined && monthly === undefined
        ? <p style={styles.muted}>{t('quotaUnavailable')}</p>
        : null}

      {window5h === undefined ? null : (
        <div>
          <div style={styles.quotaRow}>
            <span style={styles.muted}>{t('quotaFiveHour')}</span>
            <span style={styles.muted}>
              {windowPercent === undefined
                ? ''
                : `${t('quotaRemaining')} ${Math.max(0, 100 - windowPercent)}%`}
            </span>
          </div>
          <div style={styles.quotaBar}>
            <div style={{ ...styles.quotaBarFill, width: `${windowPercent ?? 0}%` }} />
          </div>
          <div style={styles.quotaRow}>
            <span style={styles.muted}>
              {windowPercent === undefined ? '' : `${t('quotaUsed')} ${windowPercent}%`}
            </span>
            <span style={styles.muted}>
              {window5h.nextResetTime === undefined
                ? ''
                : `${t('quotaResetsIn')} ${resetClockText(window5h.nextResetTime)}${countdownSuffix(window5h.nextResetTime)}`}
            </span>
          </div>
        </div>
      )}

      {monthly === undefined ? null : (
        <div>
          <div style={styles.quotaRow}>
            <span style={styles.muted}>{t('quotaMonthlyCredits')}</span>
            <span style={styles.muted}>
              {monthlyPercent === undefined
                ? ''
                : `${t('quotaRemaining')} ${Math.max(0, 100 - monthlyPercent)}%`}
            </span>
          </div>
          <div style={styles.quotaBar}>
            <div style={{ ...styles.quotaBarFill, width: `${monthlyPercent ?? 0}%` }} />
          </div>
          <div style={styles.quotaRow}>
            <span style={styles.muted}>
              {monthly.currentValue !== undefined && monthly.usage !== undefined && monthly.usage > 0
                ? `${t('quotaUsed')} ${monthly.currentValue} / ${monthly.usage}`
                : ''}
            </span>
            <span style={styles.muted}>
              {monthly.nextResetTime === undefined
                ? ''
                : `${t('quotaResetsIn')} ${resetClockText(monthly.nextResetTime)}`}
            </span>
          </div>
        </div>
      )}
    </div>
  )
}

/** Countdown in parentheses, for the reset line; empty when unknown or passed. */
function countdownSuffix(resetAt: number): string {
  const remaining = resetAt - Date.now()
  if (remaining <= 0 || remaining > 24 * 60 * 60_000) return ''
  return `（${countdownText(resetAt)}）`
}
