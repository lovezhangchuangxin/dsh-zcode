/**
 * The shared quota-reset confirmation dialog: dark modal over a dimmed
 * backdrop, used by both the Settings reset card and the bottom-bar badge's
 * reset button.
 *
 * @module dsh-zcode/client/ResetDialog
 */

/** Locale translator. */
type T = (key: string, params?: Record<string, string | number>) => string

export interface ResetDialogProps {
  t: T
  /** While the use call is in flight. */
  busy: boolean
  /** Detail line under the title, e.g. which opportunity expires first. */
  detail?: string
  onConfirm: () => void
  onCancel: () => void
}

const styles = {
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
  title: { margin: 0, fontSize: 15, fontWeight: 600 },
  body: { margin: 0, fontSize: 13, lineHeight: 1.6, opacity: .8 },
  actions: { display: 'flex', gap: 8, justifyContent: 'flex-end' } as const,
  primary: {
    padding: '8px 16px', borderRadius: 8, border: 'none', cursor: 'pointer',
    background: '#3b82f6', color: '#fff', fontSize: 13, fontWeight: 500,
  },
  outline: {
    padding: '8px 14px', borderRadius: 8, cursor: 'pointer', fontSize: 13,
    background: 'transparent', color: '#f4f4f5', border: '1px solid rgba(255,255,255,.25)',
  },
} as const

export function ResetDialog({ t, busy, detail, onConfirm, onCancel }: ResetDialogProps) {
  return (
    <div style={styles.overlay} role="presentation" onClick={() => { if (!busy) onCancel() }}>
      <div style={styles.dialog} role="dialog" aria-modal="true" aria-label={t('resetConfirmTitle')} onClick={event => { event.stopPropagation() }}>
        <h4 style={styles.title}>{t('resetConfirmTitle')}</h4>
        <p style={styles.body}>{t('resetConfirmBody')}</p>
        {detail === undefined ? null : <p style={styles.body}>{detail}</p>}
        <div style={styles.actions}>
          <button type="button" style={styles.outline} disabled={busy} onClick={onCancel}>
            {t('resetConfirmCancel')}
          </button>
          <button type="button" style={styles.primary} disabled={busy} onClick={onConfirm}>
            {busy ? '…' : t('resetConfirmOk')}
          </button>
        </div>
      </div>
    </div>
  )
}
