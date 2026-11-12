/**
 * The plugin's browser-half stylesheet, injected as one `<style>` tag and
 * removed on unload. Everything rides the host design tokens
 * (`--dsw-alias-*`, `--dsw-radius-*`) so both color schemes work with no
 * theme branching, and hover/active/focus states exist like on native
 * controls — states inline styles cannot carry.
 *
 * @module dsh-zcode/client/styles
 */

/**
 * Install the stylesheet into `document.head`.
 * @returns the disposer removing the tag.
 */
export function installStyles(): () => void {
  const tag = document.createElement('style')
  tag.dataset.plugin = 'dsh-zcode'
  tag.textContent = CSS
  document.head.append(tag)
  return () => { tag.remove() }
}

const CSS = `
/* Controls inherit the page font; per-class size/weight below then win. */
.dsh-zcode-btn,
.dsh-zcode-chip,
.dsh-zcode-option,
.dsh-zcode-link {
  font: inherit;
}

/* ---- settings section -------------------------------------------------- */

.dsh-zcode-section {
  display: flex;
  flex-direction: column;
  gap: 12px;
  max-width: 720px;
  color: var(--dsw-alias-label-primary);
}

/* One settings card: the Models page's material (fill + 0.5px stroke + xl). */
.dsh-zcode-card {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 16px;
  border: 0.5px solid var(--dsw-alias-settings-card-stroke);
  border-radius: var(--dsw-radius-xl);
  background: var(--dsw-alias-settings-card-fill);
}

.dsh-zcode-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-height: 28px;
}

.dsh-zcode-title {
  margin: 0;
  font-size: 14px;
  line-height: 22px;
  font-weight: 500;
}

.dsh-zcode-title-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

/* Quiet tier/plan tag: 11px text inside a hairline, never a colored pill. */
.dsh-zcode-tag {
  font-size: 11px;
  line-height: 16px;
  padding: 1px 6px;
  border-radius: var(--dsw-radius-xs);
  color: var(--dsw-alias-label-secondary);
  box-shadow: inset 0 0 0 var(--dsh-hairline-width, 0.5px) var(--dsw-alias-border-l3);
}

.dsh-zcode-name {
  margin: 0;
  font-size: 14px;
  line-height: 22px;
  font-weight: 500;
  word-break: break-all;
}

.dsh-zcode-facts {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 12px;
  font-size: 12px;
  line-height: 18px;
  color: var(--dsw-alias-label-tertiary);
}

.dsh-zcode-mono {
  font-family: var(--dsw-font-family-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
  font-variant-numeric: tabular-nums;
  word-break: break-all;
}

.dsh-zcode-muted {
  margin: 0;
  font-size: 13px;
  line-height: 20px;
  color: var(--dsw-alias-label-secondary);
}

.dsh-zcode-hint {
  margin: 0;
  font-size: 13px;
  line-height: 20px;
  color: var(--dsw-alias-label-tertiary);
}

.dsh-zcode-error {
  margin: 0;
  font-size: 13px;
  line-height: 20px;
  word-break: break-word;
  color: var(--dsw-alias-state-error-primary);
}

.dsh-zcode-notice {
  margin: 0;
  font-size: 13px;
  line-height: 20px;
  color: var(--dsw-alias-state-success-primary);
}

.dsh-zcode-loading {
  margin: 0;
  font-size: 13px;
  line-height: 20px;
  color: var(--dsw-alias-label-tertiary);
}

/* ---- quota hero figure -------------------------------------------------- */

.dsh-zcode-hero {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 12px;
}

.dsh-zcode-hero-value {
  display: flex;
  align-items: baseline;
  gap: 2px;
  font-size: 28px;
  line-height: 1;
  font-weight: 500;
  font-variant-numeric: tabular-nums;
}

.dsh-zcode-hero-unit {
  font-size: 14px;
  line-height: 1;
  color: var(--dsw-alias-label-tertiary);
}

.dsh-zcode-hero-side {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 2px;
}

.dsh-zcode-hero-clock {
  font-size: 14px;
  line-height: 20px;
  font-weight: 500;
  font-variant-numeric: tabular-nums;
}

.dsh-zcode-bar {
  height: 6px;
  border-radius: 3px;
  corner-shape: round;
  background: var(--dsw-alias-interactive-bg-hover);
  overflow: hidden;
}

.dsh-zcode-bar-fill {
  height: 100%;
  border-radius: 3px;
  corner-shape: round;
  background: var(--dsw-alias-state-business-primary);
  transition: width 0.3s var(--ds-ease-in-out, cubic-bezier(0.22, 1, 0.36, 1));
}

.dsh-zcode-bar-fill[data-state='warn'] { background: var(--dsw-alias-state-warn-primary); }
.dsh-zcode-bar-fill[data-state='error'] { background: var(--dsw-alias-state-error-primary); }

.dsh-zcode-meta {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  font-size: 12px;
  line-height: 18px;
  color: var(--dsw-alias-label-tertiary);
  font-variant-numeric: tabular-nums;
}

.dsh-zcode-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

/* ---- buttons (the primitives' geometry, restated) ------------------------ */

.dsh-zcode-btn {
  box-sizing: border-box;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  border: none;
  border-radius: var(--dsw-radius-md);
  cursor: pointer;
  font-size: 14px;
  line-height: 22px;
  color: var(--dsw-alias-label-primary);
  background: transparent;
  padding: 0 14px;
  height: 36px;
  transition: background-color 0.1s ease, color 0.1s ease, opacity 0.1s ease;
}

.dsh-zcode-btn-sm {
  height: 28px;
  font-size: 12px;
  line-height: 18px;
  padding: 0 10px;
  border-radius: var(--dsw-radius-sm);
}

.dsh-zcode-btn:disabled { cursor: not-allowed; opacity: 0.4; }

.dsh-zcode-btn-primary {
  background: var(--dsw-alias-button-primary-fill);
  color: var(--dsw-alias-label-primary-foreground);
}

@media (hover: hover) {
  .dsh-zcode-btn-primary:hover:not(:disabled) { background: var(--dsw-alias-button-primary-hover); }
  .dsh-zcode-btn-ghost:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); }
  .dsh-zcode-btn-outline:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); }
  .dsh-zcode-btn-ghost:active:not(:disabled) { background: var(--dsw-alias-interactive-bg-active); }
  .dsh-zcode-btn-outline:active:not(:disabled) { background: var(--dsw-alias-interactive-bg-active); }
}

/* The transparent border preserves layout; the inset stroke stays complete
 * at fractional widths (the primitives' own trick). */
.dsh-zcode-btn-outline {
  border: 0.5px solid transparent;
  box-shadow: inset 0 0 0 var(--dsh-hairline-width, 0.5px)
    var(--dsh-button-outline-color, var(--dsw-alias-border-l3));
}

.dsh-zcode-btn:focus-visible,
.dsh-zcode-chip:focus-visible,
.dsh-zcode-link:focus-visible {
  outline: 2px solid var(--dsw-alias-state-business-primary);
  outline-offset: 2px;
}

/* Text link for the authorization page: accent color, underline on hover. */
.dsh-zcode-link {
  border: none;
  padding: 0;
  background: transparent;
  cursor: pointer;
  font-size: 13px;
  line-height: 20px;
  color: var(--dsw-alias-link);
  text-decoration: none;
}

@media (hover: hover) {
  .dsh-zcode-link:hover { text-decoration: underline; }
}

/* ---- bottom-bar chips (the model selector's family) ---------------------- */

.dsh-zcode-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 28px;
  padding: 0 8px;
  border: none;
  border-radius: var(--dsw-radius-sm);
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  font-size: 13px;
  line-height: 20px;
  cursor: pointer;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.dsh-zcode-chip:disabled { cursor: default; opacity: 0.6; }

@media (hover: hover) {
  .dsh-zcode-chip:hover:not(:disabled) {
    background: var(--dsw-alias-interactive-bg-hover);
    color: var(--dsw-alias-label-primary);
  }
}

/* The one colored element: a semantic status dot, never a glow. The host's
 * global superellipse corner-shape would squash it; round restores a circle. */
.dsh-zcode-chip-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  corner-shape: round;
  background: var(--dsh-zcode-dot, var(--dsw-alias-label-caption));
  flex: 0 0 auto;
}

.dsh-zcode-chip-tag {
  font-size: 11px;
  line-height: 16px;
  color: var(--dsw-alias-label-caption);
}

.dsh-zcode-chip svg { display: block; color: var(--dsw-alias-label-caption); }

.dsh-zcode-chip-fail {
  font-size: 12px;
  line-height: 18px;
  color: var(--dsw-alias-state-error-primary);
}

/* ---- reset dialog (portaled to body) ------------------------------------- */

.dsh-zcode-overlay {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}

.dsh-zcode-mask {
  position: absolute;
  inset: 0;
  backdrop-filter: var(--dsw-mask-blur);
}

.dsh-zcode-mask::after {
  content: '';
  position: absolute;
  inset: 0;
  background: var(--dsw-alias-bg-mask-1);
  animation: dsh-zcode-fade var(--ds-transition-duration, 0.2s) var(--ds-ease-in-out, ease);
}

.dsh-zcode-dialog {
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: min(380px, 100%);
  padding: 22px 24px 24px;
  border: 0;
  border-radius: var(--dsw-radius-panel);
  background: var(--dsw-alias-bg-layer-2);
  box-shadow: var(--dsw-elevation-prominent);
  animation: dsh-zcode-fade var(--ds-transition-duration, 0.2s) var(--ds-ease-in-out, ease);
}

@keyframes dsh-zcode-fade {
  from { opacity: 0; }
}

@media (prefers-reduced-motion: reduce) {
  .dsh-zcode-mask::after, .dsh-zcode-dialog, .dsh-zcode-bar-fill { animation: none; transition: none; }
}

.dsh-zcode-dialog-title {
  margin: 0;
  font-size: 16px;
  line-height: 24px;
  font-weight: 500;
}

.dsh-zcode-dialog-body {
  margin: 0;
  font-size: 14px;
  line-height: 22px;
  color: var(--dsw-alias-label-secondary);
}

.dsh-zcode-dialog-detail {
  margin: 0;
  font-size: 12px;
  line-height: 18px;
  color: var(--dsw-alias-label-tertiary);
}

.dsh-zcode-dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 12px;
}

/* ---- selectable reset rows ------------------------------------------------ */

.dsh-zcode-options {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 4px;
}

/* Quiet hairline rows; selection is one accent ring plus the pressed fill. */
.dsh-zcode-option {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  padding: 10px 12px;
  border: none;
  border-radius: var(--dsw-radius-md);
  background: transparent;
  box-shadow: inset 0 0 0 var(--dsh-hairline-width, 0.5px) var(--dsw-alias-border-l3);
  cursor: pointer;
  text-align: left;
  color: var(--dsw-alias-label-primary);
  transition: background-color 0.1s ease;
}

.dsh-zcode-option:disabled { cursor: not-allowed; opacity: 0.5; }

@media (hover: hover) {
  .dsh-zcode-option:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); }
}

.dsh-zcode-option:focus-visible {
  outline: 2px solid var(--dsw-alias-state-business-primary);
  outline-offset: 2px;
}

.dsh-zcode-option-active,
.dsh-zcode-option-active:hover:not(:disabled) {
  background: var(--dsw-alias-interactive-bg-active);
  box-shadow: inset 0 0 0 var(--dsh-hairline-width, 0.5px) var(--dsw-alias-state-business-primary);
}

.dsh-zcode-option-name {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  line-height: 20px;
  font-weight: 500;
}

/* A native radio affordance: the dot fills with the accent when checked, so
 * selection never rides on the hairline ring alone. */
.dsh-zcode-option-dot {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  corner-shape: round;
  box-shadow: inset 0 0 0 var(--dsh-hairline-width, 0.5px) var(--dsw-alias-border-l4);
}

.dsh-zcode-option-dot::after {
  content: '';
  width: 6px;
  height: 6px;
  border-radius: 50%;
  corner-shape: round;
  background: transparent;
  transition: background-color 0.1s ease;
}

.dsh-zcode-option-active .dsh-zcode-option-dot {
  box-shadow: inset 0 0 0 var(--dsh-hairline-width, 0.5px) var(--dsw-alias-state-business-primary);
}

.dsh-zcode-option-active .dsh-zcode-option-dot::after {
  background: var(--dsw-alias-state-business-primary);
}

.dsh-zcode-option-meta {
  font-size: 12px;
  line-height: 18px;
  color: var(--dsw-alias-label-tertiary);
  font-variant-numeric: tabular-nums;
}
`
