/**
 * Browser half of dsh-zcode: one Settings page ("ZCode (BigModel)") offering
 * the sign-in the harness ships no generic surface for. Talks to the host
 * bridge (webui.ts) through the plugin-owned loopback routes in
 * webui-protocol.ts.
 *
 * Contributions degrade independently: a slots API break logs to the console
 * and leaves the rest standing, never throwing into the module loader's
 * failed-plugin banner. The host provider is unaffected either way.
 *
 * @module dsh-zcode/client
 */

import { ZcodeSection } from './ZcodeSection.tsx'
import { QuotaChip } from './QuotaChip.tsx'
import { en, zh } from './locales.ts'
import type { ClientContext, ModelDirectoriesService } from './runtime.ts'

export const name = 'dsh-zcode'
export const inject = ['slots', 'locale']

const NAMESPACE = 'settings.zcode'

/** Run one browser-side contribution, degrading its failure to a console error. */
function guarded(label: string, run: () => (() => void) | undefined): () => void {
  const noop = (): void => {}
  try {
    return run() ?? noop
  } catch (error) {
    console.error(`[dsh-zcode] client contribution failed to load (host provider unaffected): ${label}`, error)
    return noop
  }
}

export function apply(ctx: ClientContext): void {
  guarded('settings copy', () =>
    ctx.effect(() => ctx.locale.register(NAMESPACE, { zh, en }), 'dsh-zcode: settings copy'))
  const t = ctx.locale.bind(NAMESPACE)
  guarded('settings section subscription', () =>
    ctx.slots.inject('settings.section', () =>
      guarded('settings section entry', () =>
        ctx.slots.register({
          name: 'settings.section',
          id: 'zcode',
          order: 15,
          label: () => t('nav'),
          locale: NAMESPACE,
        }, ZcodeSection))))
  guarded('quota badge subscription', () =>
    ctx.inject(['modelDirectories'], (scope) =>
      guarded('quota badge registration', () =>
        scope.slots.inject('conversation.input.right', () =>
          guarded('quota badge entry', () =>
            scope.slots.register({
              name: 'conversation.input.right',
              id: 'zcode-quota',
              order: 9,
              inject: (owner) => ({
                directory: (scope as unknown as { modelDirectories: ModelDirectoriesService })
                  .modelDirectories.directoryFor(String(owner)).store,
                t,
              }),
            }, QuotaChip))))))
}
