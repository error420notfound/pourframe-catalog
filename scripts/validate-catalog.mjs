import { readFile, stat } from 'node:fs/promises'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const catalogue = resolve(root, 'catalogue')
const errors = []
const seen = new Set()

async function json(relativePath) {
  try {
    return JSON.parse(await readFile(resolve(root, relativePath), 'utf8'))
  } catch (error) {
    errors.push(`${relativePath}: ${error.message}`)
    return null
  }
}

async function exists(relativeToCatalogue) {
  try {
    return (await stat(resolve(catalogue, relativeToCatalogue))).isFile()
  } catch {
    return false
  }
}

function id(value, location) {
  if (typeof value !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)) {
    errors.push(`${location}: invalid kebab-case id`)
    return
  }
  if (seen.has(`${location.split(':')[0]}:${value}`)) errors.push(`${location}: duplicate id ${value}`)
  seen.add(`${location.split(':')[0]}:${value}`)
}

const version = await json('catalogue/version.json')
if (version?.schemaVersion !== 1) errors.push('catalogue/version.json: unsupported schemaVersion')

const roasteries = await json('catalogue/roasteries/index.json')
for (const entry of roasteries?.roasteries ?? []) {
  id(entry.id, 'roasteries:index')
  if (!await exists(entry.path)) errors.push(`roasteries index: missing ${entry.path}`)
  const roastery = await json(`catalogue/${entry.path}`)
  if (roastery?.roastery?.id !== entry.id) errors.push(`${entry.path}: roastery id does not match root index`)
  for (const coffeeEntry of roastery?.coffees ?? []) {
    id(coffeeEntry.id, `${entry.id}:coffees`)
    if (!await exists(coffeeEntry.path)) errors.push(`${entry.path}: missing ${coffeeEntry.path}`)
    const coffee = await json(`catalogue/${coffeeEntry.path}`)
    if (coffee?.id !== coffeeEntry.id) errors.push(`${coffeeEntry.path}: coffee id does not match index`)
    if (coffee?.roasteryId !== entry.id) errors.push(`${coffeeEntry.path}: roasteryId does not match parent`)
  }
}

const recipes = await json('catalogue/recipes/index.json')
for (const entry of recipes?.recipes ?? []) {
  id(entry.id, 'recipes:index')
  if (!await exists(entry.path)) errors.push(`recipes index: missing ${entry.path}`)
  const recipe = await json(`catalogue/${entry.path}`)
  if (recipe?.id !== entry.id) errors.push(`${entry.path}: recipe id does not match index`)
  if (recipe && !(recipe.bloom < recipe.water)) errors.push(`${entry.path}: bloom must be less than water`)
}

for (const schema of ['coffee', 'recipe', 'roasteries-index', 'roastery-index', 'recipes-index']) {
  const document = await json(`schemas/${schema}.schema.json`)
  if (document?.$schema !== 'https://json-schema.org/draft/2020-12/schema') {
    errors.push(`schemas/${schema}.schema.json: expected JSON Schema draft 2020-12`)
  }
}

if (errors.length) {
  console.error(`Catalog validation failed:\n- ${errors.join('\n- ')}`)
  process.exitCode = 1
} else {
  console.log('Catalog structure and references are valid.')
}
