import { mkdir, readFile, writeFile, unlink, realpath } from 'node:fs/promises'
import { join, dirname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { entries, expectedIndexes, targetRoot } from './catalog.mjs'

export async function generate(root, checkOnly = false) {
  const expected = await expectedIndexes(root), changes = []
  for (const [path, text] of expected) {
    const current = await readFile(join(root, path), 'utf8').catch(error => {
      if (error.code === 'ENOENT') return null
      throw error
    })
    if (current === text) continue
    changes.push(path)
    if (!checkOnly) {
      await mkdir(dirname(join(root, path)), { recursive: true })
      await writeFile(join(root, path), text)
    }
  }
  for (const item of await entries(join(root, 'catalogue/roasteries'))) {
    if (!item.isDirectory()) continue
    const path = `catalogue/roasteries/${item.name}/index.json`
    if (expected.has(path)) continue
    // Authored-data validation rejects removing a roastery with remaining coffees.
    try {
      await readFile(join(root, path))
      changes.push(path)
      if (!checkOnly) await unlink(join(root, path))
    } catch (error) { if (error.code !== 'ENOENT') throw error }
  }
  if (checkOnly && changes.length) throw new Error(`Stale generated indexes; run npm run generate:\n${changes.join('\n')}`)
  return changes
}

if (process.argv[1] && import.meta.url === pathToFileURL(await realpath(resolve(process.argv[1]))).href) {
  try {
    const changes = await generate(targetRoot(), process.argv.includes('--check'))
    console.log(changes.length ? `Updated ${changes.length} indexes.` : 'Generated indexes are current.')
  } catch (error) { console.error(error.message); process.exitCode = 1 }
}
