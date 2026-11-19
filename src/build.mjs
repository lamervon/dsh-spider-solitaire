/**
 * Build the browser half of the bundle.
 *
 * The profile loads `client.js` as one module, so the two locale dictionaries
 * and the stylesheet are inlined into it here rather than read at runtime: the
 * template keeps placeholders for them and this script substitutes the exact
 * JSON and CSS text. `node build.mjs` writes `client.js`; the file is committed
 * beside the template because a linked-directory install serves the package
 * root as it stands.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')

/** Read one UTF-8 file. */
function read(path) {
  return readFileSync(path, 'utf8')
}

const template = read(join(here, 'client.tpl.js'))
const css = read(join(here, 'styles.css'))
const zh = JSON.parse(read(join(root, 'locale', 'zh.json')))
const en = JSON.parse(read(join(root, 'locale', 'en.json')))

const missing = (Object.keys(en)).filter(key => !(key in zh))
if (missing.length > 0) throw new Error(`locale/zh.json is missing keys: ${missing.join(', ')}`)
const extra = (Object.keys(zh)).filter(key => !(key in en))
if (extra.length > 0) throw new Error(`locale/zh.json has keys locale/en.json lacks: ${extra.join(', ')}`)

// A locale that declares a detail document must ship it: Plugin Manager shows
// the failure instead of falling back to the README when the file is missing.
for (const [language, dict] of [['en', en], ['zh', zh]]) {
  const detail = dict['meta.detail']
  if (detail === undefined) continue
  if (!existsSync(join(root, detail))) {
    throw new Error(`locale/${language}.json declares meta.detail "${detail}", which does not exist`)
  }
}

const output = template
  .replace('__DICTS__', JSON.stringify({ zh, en }))
  .replace('__CSS__', JSON.stringify(css))

if (output === template) throw new Error('the template carries no substitution placeholders')
writeFileSync(join(root, 'client.js'), output, 'utf8')

// The board harness mounts this component outside the app, so it needs the same
// dictionaries as a plain global rather than through the locale service.
writeFileSync(
  join(root, '.harness', 'dicts.js'),
  `window.__SPIDER_DICTS__ = ${JSON.stringify({ zh, en })}\n`,
  'utf8',
)
console.log(`client.js written: ${output.length} bytes, ${Object.keys(en).length} copy keys, ${css.length} bytes of CSS`)
