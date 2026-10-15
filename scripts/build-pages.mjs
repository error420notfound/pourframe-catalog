import { cp, mkdir, writeFile, access, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { repository, safeTree } from './catalog.mjs'

export async function buildPages() {
  const destination = resolve(repository, '_site')
  if (destination !== join(repository, '_site')) throw new Error('Invalid Pages build directory')
  await safeTree(destination)
  await rm(destination, { recursive: true, force: true })
  await mkdir(destination, { recursive: true })
  // Publish only public assets, never tooling or canonical CMS source records.
  for (const path of ['index.html', 'admin', 'catalogue', 'schemas', 'media']) {
    if (!await access(join(repository, path)).then(() => true, () => false)) continue
    await safeTree(join(repository, path))
    await cp(join(repository, path), join(destination, path), { recursive: true })
  }
  await writeFile(join(destination, '.nojekyll'), '')
  return destination
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  console.log(`Static Pages files prepared at ${await buildPages()}`)
}
