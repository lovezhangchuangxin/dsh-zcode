/**
 * The ZCode settings section: sign-in state, the 5-hour quota card with its
 * reset clock, and the quota-reset card (chooser dialog → consume the
 * selected kind). All state comes from the plugin-owned routes; every action
 * is one loopback POST authorized by the status document's control key.
 * Visuals live in styles.ts on the host design tokens.
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
  type ResetKind,
} from './quota.ts'
import { ResetDialog, type ResetOption } from './ResetDialog.tsx'

/** Locale translator. */
type T = (key: string, params?: Record<string, string | number>) => string

export interface ZcodeSectionProps {
  t: T
  /** Shell-provided: close the settings panel. */
  close?: () => void
}

export function ZcodeSection({ t }: ZcodeSectionProps) {
  const [doc, setDoc] = useState<ZcodeWebStatus | null>(null)
  /** Which operation last failed: reading state vs performing an action. */
  const [failure, setFailure] = useState<'load' | 'action' | null>(null)
  const [busy, setBusy] = useState(false)
  const [copyState, setCopyState] = useState<'copied' | 'failed' | null>(null)
  /** Bumped after a consumed reset; the quota card force-refreshes on change. */
  const [resetGeneration, setResetGeneration] = useState(0)
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
    <div className="dsh-zcode-section">
      {account !== null
        ? (
          <section className="dsh-zcode-card">
            <div className="dsh-zcode-head">
              <h3 className="dsh-zcode-title">{t('accountTitle')}</h3>
              <button type="button" className="dsh-zcode-btn dsh-zcode-btn-sm dsh-zcode-btn-ghost" disabled={busy} onClick={signOut}>
                {t('signOut')}
              </button>
            </div>
            <p className="dsh-zcode-name">{account.username ?? account.userId}</p>
            <div className="dsh-zcode-facts">
              <span>{t('userId')} <span className="dsh-zcode-mono">{account.userId}</span></span>
              <span>{t('signedAt')} {new Date(account.grantedAt).toLocaleString()}</span>
            </div>
          </section>
        )
        : attempt?.phase === 'running' || attempt?.phase === 'succeeded'
          ? (
            <section className="dsh-zcode-card">
              <h3 className="dsh-zcode-title">{t('accountTitle')}</h3>
              <p className="dsh-zcode-muted">{notice ?? t('signingIn')}</p>
              {url === undefined ? null : (
                <>
                  <p className="dsh-zcode-hint">{t('needAction')}</p>
                  <div className="dsh-zcode-row">
                    <a className="dsh-zcode-link" href={url} target="_blank" rel="noreferrer">{t('openPage')}</a>
                    <button type="button" className="dsh-zcode-btn dsh-zcode-btn-sm dsh-zcode-btn-ghost" onClick={() => { void copyLink(url) }}>
                      {copyState === null ? t('copyLink') : copyState === 'copied' ? t('copied') : t('copyFailed')}
                    </button>
                    <button type="button" className="dsh-zcode-btn dsh-zcode-btn-sm dsh-zcode-btn-outline" disabled={busy} onClick={cancel}>
                      {t('cancel')}
                    </button>
                  </div>
                </>
              )}
            </section>
          )
          : (
            <section className="dsh-zcode-card">
              <h3 className="dsh-zcode-title">{t('accountTitle')}</h3>
              <p className="dsh-zcode-muted">{t('intro')}</p>
              {terminalError === undefined ? null : <p className="dsh-zcode-error">{terminalError}</p>}
              <div className="dsh-zcode-row">
                <button
                  type="button"
                  className="dsh-zcode-btn dsh-zcode-btn-primary"
                  // No status document yet means no control key; the button
                  // must not look clickable while it can do nothing.
                  disabled={busy || doc === null}
                  onClick={signIn}
                >
                  {attempt === null ? t('signIn') : t('retry')}
                </button>
              </div>
            </section>
          )}
      {account !== null ? <QuotaCard t={t} generation={resetGeneration} /> : null}
      {account !== null
        ? <ResetCard t={t} controlKey={doc?.controlKey} onUsed={() => { setResetGeneration(generation => generation + 1) }} />
        : null}
      {failure !== null
        ? (
          <p className="dsh-zcode-error">
            {t(failure === 'action' ? 'actionFailed' : 'loadFailed')}
            {' '}
            <button type="button" className="dsh-zcode-btn dsh-zcode-btn-sm dsh-zcode-btn-ghost" onClick={() => { void refresh() }}>
              {t('reload')}
            </button>
          </p>
        )
        : null}
    </div>
  )
}

/** The 5-hour quota card: remaining share as the hero figure, reset clock beside it. */
function QuotaCard({ t, generation }: { t: T, generation: number }) {
  const [doc, setDoc] = useState<ZcodeQuotaDoc | undefined>()
  const [failed, setFailed] = useState(false)
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(async (force: boolean): Promise<void> => {
    setBusy(true)
    try {
      // A transient fetch failure keeps the last good snapshot instead of
      // collapsing back to the loading state.
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

  useEffect(() => {
    void refresh(false)
    const timer = setInterval(() => { void refresh(false) }, QUOTA_POLL_MS)
    return () => { clearInterval(timer) }
  }, [refresh])

  // A consumed reset invalidates the host cache; read the fresh window now.
  useEffect(() => {
    if (generation > 0) void refresh(true)
  }, [generation, refresh])

  const limit = doc?.status === 'ok' ? fiveHourLimit(doc) : undefined
  const percent = limit !== undefined ? usedPercent(limit) : undefined
  const remaining = percent === undefined ? undefined : Math.max(0, 100 - percent)
  const resetAt = limit?.nextResetTime

  if (doc === undefined) {
    return (
      <section className="dsh-zcode-card">
        <div className="dsh-zcode-head">
          <h3 className="dsh-zcode-title">{t('quotaTitle')}</h3>
          <button type="button" className="dsh-zcode-btn dsh-zcode-btn-sm dsh-zcode-btn-ghost" disabled={busy} onClick={() => { void refresh(true) }}>
            {busy ? t('busy') : t('quotaRefresh')}
          </button>
        </div>
        <p className={failed ? 'dsh-zcode-error' : 'dsh-zcode-loading'}>
          {failed ? t('quotaUnavailable') : t('loading')}
        </p>
      </section>
    )
  }
  if (doc.status !== 'ok' || limit === undefined || percent === undefined || remaining === undefined) {
    return (
      <section className="dsh-zcode-card">
        <div className="dsh-zcode-head"><h3 className="dsh-zcode-title">{t('quotaTitle')}</h3></div>
        <p className="dsh-zcode-error">{doc.status === 'error' ? (doc.error ?? t('quotaUnavailable')) : t('quotaUnavailable')}</p>
      </section>
    )
  }

  // The fill carries the drain state; the hero figure stays primary-colored.
  const state = percent >= 85 ? 'error' : percent >= 60 ? 'warn' : undefined

  return (
    <section className="dsh-zcode-card">
      <div className="dsh-zcode-head">
        <div className="dsh-zcode-title-row">
          <h3 className="dsh-zcode-title">{t('quotaTitle')}</h3>
          {doc.level === undefined ? null : <span className="dsh-zcode-tag">{doc.level}</span>}
        </div>
        <button type="button" className="dsh-zcode-btn dsh-zcode-btn-sm dsh-zcode-btn-ghost" disabled={busy} onClick={() => { void refresh(true) }}>
          {busy ? t('busy') : t('quotaRefresh')}
        </button>
      </div>

      <div className="dsh-zcode-hero">
        <div className="dsh-zcode-hero-value">
          <span>{remaining}</span>
          <span className="dsh-zcode-hero-unit">%</span>
        </div>
        <div className="dsh-zcode-hero-side">
          <span className="dsh-zcode-hint">{t('quotaResetsIn')}</span>
          <span className="dsh-zcode-hero-clock">{resetAt === undefined ? '—' : resetClockText(resetAt)}</span>
        </div>
      </div>

      <div className="dsh-zcode-bar">
        <div
          className="dsh-zcode-bar-fill"
          style={{ width: `${percent}%` }}
          {...(state === undefined ? {} : { 'data-state': state })}
        />
      </div>

      <div className="dsh-zcode-meta">
        <span>{t('quotaUsed')} {percent}%</span>
        <span>{resetAt === undefined ? '' : `${t('quotaRemainingTime')} ${countdownText(resetAt)}`}</span>
      </div>
    </section>
  )
}

/**
 * The quota-reset card: shows claimable resets and opens the chooser dialog
 * (every available kind as a selectable row) before consuming one.
 */
function ResetCard({ t, controlKey, onUsed }: { t: T, controlKey: string | undefined, onUsed: () => void }) {
  const [doc, setDoc] = useState<import('../webui-protocol.ts').ZcodeResetDoc | undefined>()
  const [failed, setFailed] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  /** 'done' shows the success notice; 'failed' the failure text from the use result. */
  const [result, setResult] = useState<'done' | 'failed' | null>(null)
  const [resultError, setResultError] = useState<string | undefined>()

  const refresh = useCallback(async (): Promise<void> => {
    // A transient fetch failure keeps the last good snapshot.
    const next = await fetchReset()
    if (next !== undefined) {
      setDoc(next)
      setFailed(false)
    } else {
      setFailed(true)
    }
  }, [])

  useEffect(() => {
    void refresh()
    const timer = setInterval(() => { void refresh() }, QUOTA_POLL_MS)
    return () => { clearInterval(timer) }
  }, [refresh])

  /** Total claimable opportunities across kinds, for the header count. */
  const available = doc?.status === 'ok'
    ? (doc.fiveHourAvailable ?? 0) + (doc.weekAvailable ?? 0)
    : 0

  /** The kinds with at least one claimable opportunity, in display order. */
  const options: ResetOption[] = doc?.status === 'ok'
    ? [
      ...(doc.fiveHourAvailable
        ? [{
          kind: 'FIVE_HOUR' as const,
          count: doc.fiveHourAvailable,
          ...(doc.fiveHourEarliestExpireAt !== undefined ? { earliestExpireAt: doc.fiveHourEarliestExpireAt } : {}),
        }]
        : []),
      ...(doc.weekAvailable
        ? [{
          kind: 'WEEK' as const,
          count: doc.weekAvailable,
          ...(doc.weekEarliestExpireAt !== undefined ? { earliestExpireAt: doc.weekEarliestExpireAt } : {}),
        }]
        : []),
    ]
    : []

  const confirm = useCallback(async (kind: ResetKind): Promise<void> => {
    setBusy(true)
    try {
      const used = await useReset(controlKey, kind)
      if (used !== undefined && used.status === 'ok' && used.used === true) {
        setResult('done')
        setResultError(undefined)
        onUsed()
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
  }, [controlKey, onUsed, refresh])

  return (
    <section className="dsh-zcode-card">
      <div className="dsh-zcode-head">
        <h3 className="dsh-zcode-title">{t('resetTitle')}</h3>
        {doc !== undefined && doc.status === 'ok' && available > 0
          ? <span className="dsh-zcode-hint">{t('resetCount', { count: available })}</span>
          : null}
      </div>

      {doc === undefined
        ? <p className={failed ? 'dsh-zcode-error' : 'dsh-zcode-loading'}>
          {failed ? t('resetUnavailable') : t('loading')}
        </p>
        : doc.status !== 'ok'
          ? <p className="dsh-zcode-error">{doc.status === 'error' ? (doc.error ?? t('resetUnavailable')) : t('resetUnavailable')}</p>
          : options.length === 0
            ? <p className="dsh-zcode-hint">{t('resetNone')}</p>
            : (
              <>
                <p className="dsh-zcode-hint">{t('resetHint')}</p>
                <div className="dsh-zcode-row">
                  <button
                    type="button"
                    className="dsh-zcode-btn dsh-zcode-btn-outline"
                    // No control key yet means the write can do nothing; the
                    // button must not look clickable while it cannot act.
                    disabled={busy || controlKey === undefined}
                    onClick={() => { setResult(null); setConfirming(true) }}
                  >
                    {t('resetButton')}
                  </button>
                </div>
              </>
              )}

      {result === 'done'
        ? <p className="dsh-zcode-notice" role="status">{t('resetDone')}</p>
        : result === 'failed'
          ? (
            <p className="dsh-zcode-error" role="status">
              {t('resetFailed')}{resultError === undefined ? null : ` — ${resultError}`}
            </p>
          )
          : null}

      {confirming && options.length > 0
        ? (
          <ResetDialog
            t={t}
            options={options}
            busy={busy}
            onConfirm={kind => { void confirm(kind) }}
            onCancel={() => { setConfirming(false) }}
          />
        )
        : null}
    </section>
  )
}
