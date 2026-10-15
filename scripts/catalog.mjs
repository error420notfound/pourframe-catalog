import { readFile, readdir, lstat } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import Ajv2020 from 'ajv/dist/2020.js'
import addFormats from 'ajv-formats'

export const repository = resolve(import.meta.dirname, '..')
export const idPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
export const json = async path => JSON.parse(await readFile(path, 'utf8'))
export const encode = value => `${JSON.stringify(value, null, 2)}\n`
export const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0
export const ordered = (a, b) => (a.sortOrder ?? Infinity) -
  (b.sortOrder ?? Infinity) || compare(a.id, b.id)
export const pick = (record, keys) => Object.fromEntries(keys.filter(key => record[key] !== undefined).map(key => [key, record[key]]))

// A PR's data must never redirect reads or generated writes through symlinks.
export async function safeTree(path) {
  const info = await lstat(path).catch(error => {
    if (error.code === 'ENOENT') return null
    throw error
  })
  if (!info) return
  if (info.isSymbolicLink() || (!info.isFile() && !info.isDirectory())) throw new Error(`Unsupported file type: ${path}`)
  if (info.isDirectory()) for (const child of await readdir(path)) await safeTree(join(path, child))
}

export async function entries(path) {
  return (await readdir(path, { withFileTypes: true }).catch(error => {
    if (error.code === 'ENOENT') return []
    throw error
  })).sort((a, b) => compare(a.name, b.name))
}

export async function contracts() {
  const ajv = new Ajv2020({ allErrors: true, strict: false })
  addFormats(ajv)
  const schemas = {}
  for (const item of await entries(join(repository, 'schemas'))) {
    if (!item.name.endsWith('.schema.json')) continue
    const name = item.name.replace('.schema.json', '')
    schemas[name] = await json(join(repository, 'schemas', item.name))
    if (schemas[name].$schema !== 'https://json-schema.org/draft/2020-12/schema') throw new Error(`${item.name}: expected JSON Schema draft 2020-12`)
    ajv.addSchema(schemas[name], name)
  }
  // Reuse the existing authored roastery contract; no parallel source schema.
  const roastery = ajv.compile(schemas['roastery-index'].properties.roastery)
  const date = ajv.compile({ type: 'string', format: 'date' })
  return { schemas, check(name, value, location) {
    const validate = name === 'roastery' ? roastery : name === 'date' ? date : ajv.getSchema(name)
    if (!validate(value)) throw new Error(`${location}: ${ajv.errorsText(validate.errors, { separator: '; ' })}`)
  } }
}

export async function loadAuthored(root = repository) {
  for (const folder of ['content', 'catalogue']) await safeTree(join(root, folder))
  const { check, schemas } = await contracts()
  const roasteries = [], recipes = [], coffees = new Map()
  function identity(record, filename, location) {
    if (!idPattern.test(record.id) || record.id === 'index' || filename !== `${record.id}.json`) {
      throw new Error(`${location}: id must match its kebab-case filename; index is reserved`)
    }
  }
  for (const entry of await entries(join(root, 'content/roasteries'))) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) throw new Error(`Unexpected roastery source: ${entry.name}`)
    const path = `content/roasteries/${entry.name}`, record = await json(join(root, path))
    check('roastery', record, path)
    identity(record, entry.name, path)
    roasteries.push(pick(record, Object.keys(schemas['roastery-index'].properties.roastery.properties)))
    coffees.set(record.id, [])
  }
  for (const folder of await entries(join(root, 'catalogue/roasteries'))) {
    if (folder.name === 'index.json' && folder.isFile()) continue
    if (!folder.isDirectory() || !idPattern.test(folder.name)) throw new Error(`Unexpected roastery path: ${folder.name}`)
    for (const child of await entries(join(root, 'catalogue/roasteries', folder.name))) {
      if (child.name === 'index.json' && child.isFile()) continue
      if (child.name !== 'coffees' || !child.isDirectory()) throw new Error(`Unexpected roastery child: ${child.name}`)
      for (const entry of await entries(join(root, 'catalogue/roasteries', folder.name, 'coffees'))) {
        const path = `catalogue/roasteries/${folder.name}/coffees/${entry.name}`
        if (!entry.isFile() || !entry.name.endsWith('.json')) throw new Error(`Unexpected coffee path: ${path}`)
        const record = await json(join(root, path))
        check('coffee', record, path)
        identity(record, entry.name, path)
        if (record.roasteryId !== folder.name || !coffees.has(folder.name)) throw new Error(`${path}: roasteryId must match an existing parent roastery`)
        if (record.altitudeRangeM && record.altitudeRangeM.min > record.altitudeRangeM.max) throw new Error(`${path}: altitude range min exceeds max`)
        coffees.get(folder.name).push(record)
      }
    }
  }
  for (const entry of await entries(join(root, 'catalogue/recipes'))) {
    if (entry.name === 'index.json' && entry.isFile()) continue
    const path = `catalogue/recipes/${entry.name}`
    if (!entry.isFile() || !entry.name.endsWith('.json')) throw new Error(`Unexpected recipe path: ${path}`)
    const record = await json(join(root, path))
    check('recipe', record, path)
    identity(record, entry.name, path)
    if (!(record.bloom < record.water)) throw new Error(`${path}: bloom must be less than water`)
    recipes.push(record)
  }
  const reference = await json(join(root, 'catalogue/reference.json'))
  const vocabulary = { roastLevels: schemas.coffee.properties.roastLevel.enum, grindSizes: schemas.recipe.properties.grind.enum,
    serveStyles: schemas.recipe.properties.serveStyle.enum, coffeeStatuses: schemas.coffee.properties.status.enum }
  if (reference.schemaVersion !== 1 || Object.keys(reference).sort().join() !== ['schemaVersion', ...Object.keys(vocabulary)].sort().join()) throw new Error('reference.json: unexpected fields or schemaVersion')
  for (const [key, values] of Object.entries(vocabulary)) {
    if (!Array.isArray(reference[key]) || [...reference[key]].sort().join('\0') !== [...values].sort().join('\0')) throw new Error(`reference.json: ${key} must contain each schema enum value exactly once`)
  }
  const version = await json(join(root, 'catalogue/version.json'))
  if (version.schemaVersion !== 1 || typeof version.catalogVersion !== 'string' || !/^\d+\.\d+\.\d+$/.test(version.catalogVersion) || Object.keys(version).sort().join() !== 'catalogVersion,schemaVersion,updatedAt') throw new Error('version.json: expected schemaVersion, major.minor.patch catalogVersion and updatedAt')
  check('date', version.updatedAt, 'catalogue/version.json updatedAt')
  roasteries.sort(ordered)
  for (const list of coffees.values()) list.sort(ordered)
  recipes.sort((a, b) => compare(a.id, b.id))
  return { roasteries, coffees, recipes, check }
}

export async function expectedIndexes(root = repository) {
  const { roasteries, coffees, recipes, check } = await loadAuthored(root), output = new Map()
  const rootIndex = { $schema: '../../schemas/roasteries-index.schema.json', schemaVersion: 1,
    roasteries: roasteries.map(record => ({ ...pick(record, ['id', 'name', 'country', 'city', 'logoUrl']),
      path: `roasteries/${record.id}/index.json`, ...pick(record, ['sortOrder']) })) }
  check('roasteries-index', rootIndex, 'root roastery index')
  output.set('catalogue/roasteries/index.json', encode(rootIndex))
  for (const roastery of roasteries) {
    const index = { $schema: '../../../schemas/roastery-index.schema.json', schemaVersion: 1, roastery,
      coffees: coffees.get(roastery.id).map(record => ({ ...pick(record, ['id', 'name', 'status']),
        path: `roasteries/${roastery.id}/coffees/${record.id}.json`, ...pick(record, ['featured', 'sortOrder', 'updatedAt']) })) }
    check('roastery-index', index, `${roastery.id} index`)
    output.set(`catalogue/roasteries/${roastery.id}/index.json`, encode(index))
  }
  const recipeIndex = { $schema: '../../schemas/recipes-index.schema.json', schemaVersion: 1,
    recipes: recipes.map(record => ({ ...pick(record, ['id', 'name', 'dripper', 'serveStyle']), path: `recipes/${record.id}.json`, ...pick(record, ['publishedAt', 'updatedAt']) })) }
  check('recipes-index', recipeIndex, 'recipe index')
  output.set('catalogue/recipes/index.json', encode(recipeIndex))
  return output
}

export function targetRoot(args = process.argv.slice(2)) {
  const pos = args.indexOf('--root')
  if (pos !== -1 && !args[pos + 1]) throw new Error('--root requires a directory')
  return pos === -1 ? repository : resolve(args[pos + 1])
}
