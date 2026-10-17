/**
 * The slice of the browser Cordis context a client entry receives, restated
 * locally: the slots registry (`@deepseek-ai/dsh-client-ui-renderer`) and the
 * locale service (`@deepseek-ai/dsh-client-locale`). Types only — the runtime
 * object arrives from the module loader, and a local contract keeps the
 * browser bundle free of host-package imports.
 *
 * @module dsh-zcode/client/runtime
 */

import type { ComponentType } from 'react'

/** Options for one entry registered into a list slot; only the fields this entry uses. */
export interface SlotEntryOptions {
  /** The slot being registered into, matching the inject() subscription. */
  name: string
  /** List-slot entry key; drives the shell's `only` filtering and duplicate detection. */
  id: string
  /** Nav position among the section list; lower renders earlier. */
  order?: number
  /** Section label, thunked so a locale switch re-reads it. */
  label: () => string
  /** Locale namespace whose bound translator is injected as the `t` prop. */
  locale?: string
}

/** The browser slots registry. */
export interface ClientSlotsService {
  /**
   * Subscribe to a slot's declaration; the callback runs (now or later, when
   * the declaring package commits the slot) and returns the entry's disposer.
   * @param slot - slot name, e.g. 'settings.section'.
   * @param register - registers the entry once the slot exists.
   * @returns disposer for the whole subscription.
   */
  inject(slot: string, register: () => (() => void) | undefined): () => void
  /**
   * Put one entry into a declared slot.
   * @param options - entry identity and presentation.
   * @param component - the React component the renderer mounts.
   * @returns disposer withdrawing the entry.
   */
  register(options: SlotEntryOptions, component: ComponentType<never>): () => void
}

/** The browser locale service. */
export interface ClientLocaleService {
  /**
   * Contribute one namespace's dictionaries.
   * @param ns - namespace id, e.g. 'settings.zcode'.
   * @param dicts - locale id → flat key/value table.
   * @returns disposer removing the contribution.
   */
  register(ns: string, dicts: Record<string, Record<string, string>>): () => void
  /** @param ns - namespace id. @returns the namespace's translator. */
  bind(ns: string): (key: string, params?: Record<string, string | number>) => string
}

/** The context the module loader hands a browser entry's apply(). */
export interface ClientContext {
  /** cordis effect(): run now, dispose on unload. */
  effect(setup: () => (() => void) | undefined, label?: string): () => void
  slots: ClientSlotsService
  locale: ClientLocaleService
}
