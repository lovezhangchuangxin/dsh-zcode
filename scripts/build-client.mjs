/**
 * Build the browser half into the envelope the dsh web app's module loader
 * evaluates: `window.__ModuleLoader__.load({ id, factory })`, where the
 * factory receives the host-provided `require` (React and its jsx runtime
 * come from the loader, never from this bundle) and returns the module whose
 * `name` / `inject` / `apply` the client runtime consumes.
 */

import { writeFile } from 'node:fs/promises'
import { build } from 'esbuild'

const result = await build({
  entryPoints: ['src/client/index.tsx'],
  bundle: true,
  platform: 'browser',
  format: 'cjs',
  external: ['react', 'react/jsx-runtime'],
  jsx: 'automatic',
  write: false,
  legalComments: 'none',
  outdir: 'lib',
})

const body = result.outputFiles[0].text
if (body === undefined) throw new Error('build-client: esbuild produced no output')

const wrapped = `window.__ModuleLoader__.load({
  id: "dsh-zcode",
  factory: (require) => {
    "use strict";
    var module = { exports: {} };
    var exports = module.exports;
${body}
    return module.exports;
  },
});
`

await writeFile(new URL('../lib/client.js', import.meta.url), wrapped, 'utf8')
console.log(`build-client: lib/client.js (${wrapped.length} bytes)`)
