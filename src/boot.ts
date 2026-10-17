/**
 * Host-binding entry point.
 *
 * The published dsh CLI keeps its @deepseek-ai packages inside the CLI's own
 * node_modules, which is not on any resolution path a profile plugin would
 * search; pnpm instead auto-installs old npm copies next to this plugin, and
 * importing those yields foreign class identities (the host's instanceof
 * checks on LlmAdapter/LlmError would fail) or missing exports outright.
 *
 * So the package main is this boot module: locate the running dsh CLI, resolve
 * its packages, register a scoped module resolve hook that redirects our
 * imports onto those exact files, and only then load the plugin body — every
 * host symbol the body touches is the same module instance the host uses.
 */

import { createRequire } from 'node:module'
import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import type * as Plugin from './plugin.ts'

/** Runtime specifiers that must come from the host process, never bundled. */
const HOST_SPECIFIERS = [
  '@deepseek-ai/dsh-llm',
  '@deepseek-ai/dsh-credentials',
  '@deepseek-ai/dsh-authorization',
  '@deepseek-ai/schemastery',
] as const

/** package.json names accepted as "this directory is the dsh host". */
const HOST_PACKAGE_NAMES = new Set(['@deepseek-ai/dsh', '@deepseek-ai/dsh-root'])

/** Global slot so an HMR re-import reuses the already-registered hooks. */
const HOOKS_FLAG = Symbol.for('dsh-zcode.host-redirects')
interface InstalledHooks { root: string, targets: Map<string, string> }

function readPackageName(dir: string): string | undefined {
  try {
    const parsed = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as { name?: unknown }
    return typeof parsed.name === 'string' ? parsed.name : undefined
  } catch {
    return undefined
  }
}

/** Walk up from each launch candidate to a directory owned by the dsh host. */
function findHostRoot(): string | undefined {
  const candidates: string[] = []
  const override = process.env.DSH_ZCODE_HOST
  if (override !== undefined && override !== '') candidates.push(override)
  for (const launched of [process.argv[1], process.execPath]) {
    if (typeof launched !== 'string' || launched === '') continue
    try {
      candidates.push(realpathSync(launched))
    } catch {
      /* argv entries need not exist on disk; skip them. */
    }
  }
  for (const candidate of candidates) {
    let dir: string
    try {
      // Directory candidates (the env override) name the package themselves.
      dir = statSync(candidate).isDirectory() ? candidate : dirname(candidate)
    } catch {
      continue
    }
    for (;;) {
      const pkg = readPackageName(dir)
      if (pkg !== undefined && HOST_PACKAGE_NAMES.has(pkg)) return dir
      const parent = dirname(dir)
      if (parent === dir) break
      dir = parent
    }
  }
  return undefined
}

function toFileUrl(path: string): string {
  return pathToFileURL(realpathSync(path)).href
}

/** resolve() with the runtime-supported `conditions` option (missing from older @types/node). */
type ResolveWithConditions = (specifier: string, options: { conditions: string[] }) => string

/** Resolve one host specifier from the host root, preferring ESM entries.
 * @returns the file URL, or undefined when the host does not provide it.
 */
function resolveHostSpecifier(require: NodeJS.Require, root: string, specifier: string): string | undefined {
  const resolveWithConditions = require.resolve as ResolveWithConditions
  for (const conditions of [['node', 'import'] as string[], undefined]) {
    try {
      const resolved = conditions === undefined
        ? require.resolve(specifier)
        : resolveWithConditions(specifier, { conditions })
      return toFileUrl(resolved)
    } catch {
      /* try the next resolution mode */
    }
  }
  // Source-checkout hosts run unbuilt packages whose exports point at a
  // missing lib/; the TS sources load because such hosts register a loader.
  for (const base of [join(root, 'node_modules'), root]) {
    const source = join(base, ...specifier.split('/'), 'src', 'index.ts')
    if (existsSync(source)) return toFileUrl(source)
  }
  return undefined
}

async function installRedirects(): Promise<void> {
  const installed = (globalThis as Record<symbol, InstalledHooks | undefined>)[HOOKS_FLAG]
  if (installed !== undefined) return
  const root = findHostRoot()
  if (root === undefined) {
    throw new Error(
      'dsh-zcode: cannot locate the running dsh CLI; start this plugin from a dsh process '
        + 'or point DSH_ZCODE_HOST at the CLI installation directory',
    )
  }
  const require = createRequire(join(root, 'package.json'))
  const targets = new Map<string, string>()
  for (const specifier of HOST_SPECIFIERS) {
    const target = resolveHostSpecifier(require, root, specifier)
    if (target === undefined) {
      throw new Error(`dsh-zcode: the dsh host at ${root} does not provide ${specifier}`)
    }
    targets.set(specifier, target)
  }
  type RegisterHooks = (hooks: {
    resolve?: (specifier: string, context: { parentURL: string | undefined }, next: (specifier: string, context: unknown) => unknown) => unknown
  }) => unknown
  const { registerHooks } = (await import('node:module')) as { registerHooks?: RegisterHooks }
  if (typeof registerHooks !== 'function') {
    throw new Error('dsh-zcode: this Node runtime lacks module.registerHooks (need Node >= 22.15)')
  }
  const selfPrefix = new URL('.', import.meta.url).href
  registerHooks({
    resolve(specifier, context, next) {
      const target = context.parentURL !== undefined && context.parentURL.startsWith(selfPrefix)
        ? targets.get(specifier)
        : undefined
      return next(target ?? specifier, context)
    },
  })
  ;(globalThis as Record<symbol, InstalledHooks | undefined>)[HOOKS_FLAG] = { root, targets }
}

await installRedirects()
const plugin: typeof Plugin = await import('./plugin.js')

export const name = plugin.name
export const inject = plugin.inject
export const Config = plugin.Config
export const apply = plugin.apply
