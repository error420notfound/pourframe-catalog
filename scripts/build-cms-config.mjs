import { readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { stringify } from 'yaml'
import { contracts, entries, json, repository } from './catalog.mjs'

const label = name => name.replace(/([A-Z])/g, ' $1').replace(/^./, c => c.toUpperCase())
export function fieldsFor(schema, optionalAncestor = false) {
  return Object.entries(schema.properties).map(([name, property]) => {
    const schemaRequired = schema.required?.includes(name) ?? false
    // Decap validates children even when an optional object is untouched. Defer
    // conditional requirements to preSave and JSON Schema validation instead.
    const allowsBlank = (property.type === 'string' && !property.minLength && !property.pattern && !property.format) ||
      (property.type === 'array' && !property.minItems)
    const field = { name, label: label(name), required: schemaRequired && !optionalAncestor && !allowsBlank,
      ...(schemaRequired && optionalAncestor ? { hint: 'Required when this optional object is filled in.' } : {}),
      ...(schemaRequired && allowsBlank ? { default: property.type === 'array' ? [] : '' } : {}) }
    if (name === '$schema' || property.const !== undefined) return { ...field, widget: 'hidden', default: property.const }
    if (property.enum) return { ...field, widget: 'select', options: property.enum }
    if (property.type === 'object') return { ...field, widget: 'object', fields: fieldsFor(property, optionalAncestor || !schemaRequired) }
    if (property.type === 'array') return { ...field, widget: 'list', default: [], max: property.maxItems, min: property.minItems ?? 0,
      field: fieldsFor({ properties: { item: property.items }, required: ['item'] })[0] }
    if (property.type === 'boolean') return { ...field, widget: 'boolean', default: false }
    if (['number', 'integer'].includes(property.type)) return { ...field, widget: 'number',
      value_type: property.type === 'integer' ? 'int' : 'float', step: property.type === 'integer' ? 1 : 0.01,
      min: property.minimum ?? property.exclusiveMinimum, max: property.maximum,
      ...(property.exclusiveMinimum !== undefined ? { hint: `Must be greater than ${property.exclusiveMinimum}.` } : {}) }
    if (property.format === 'date') return { ...field, widget: 'datetime', date_format: 'YYYY-MM-DD', time_format: false, picker_utc: true }
    const pattern = property.pattern ?? (property.format === 'uri' ? '^[A-Za-z][A-Za-z0-9+.-]*:\\S+$' :
      (property.minLength || property.maxLength ? `^[\\s\\S]{${property.minLength ?? 0},${property.maxLength ?? ''}}$` : undefined))
    return { ...field, widget: ['description', 'notes', 'agitation'].includes(name) ? 'text' : 'string',
      ...(pattern ? { pattern: [pattern, property.format === 'uri' ? 'Enter an absolute source URL.' : 'Value must match the catalog schema (format and length).'] } : {}),
      ...(name === 'id' ? { pattern: ['^(?!index$)[a-z0-9]+(?:-[a-z0-9]+)*$', 'Use a lowercase kebab-case ID; index is reserved.'],
        hint: 'Permanent ID and filename. Existing IDs cannot be changed; saving enforces this.' } : {}) }
  })
}

export async function configuration() {
  const { schemas } = await contracts()
  const folder = (name, title, path, fields) => ({ name, label: title, folder: path, create: true,
    // Decap deletes published records directly from main even in editorial mode.
    // Deletions must use reviewed PRs; discarding an unpublished draft still works.
    delete: false, extension: 'json', format: 'json', identifier_field: 'id', slug: '{{fields.id}}',
    summary: '{{name}} ({{id}})', editor: { preview: false }, fields })
  const roasteryFields = fieldsFor(schemas['roastery-index'].properties.roastery)
  // New roasteries also need a coffee collection, so add them in a code PR.
  const collections = [{ ...folder('roasteries', 'Roasteries', 'content/roasteries', roasteryFields), create: false }]
  for (const entry of await entries(join(repository, 'content/roasteries'))) {
    const roastery = await json(join(repository, 'content/roasteries', entry.name))
    const fields = fieldsFor(schemas.coffee).map(field => field.name === '$schema' ?
      { ...field, default: '../../../../schemas/coffee.schema.json' } : field.name === 'roasteryId' ?
        { ...field, widget: 'hidden', default: roastery.id } : field)
    collections.push(folder(`coffees-${roastery.id}`, `Coffees · ${roastery.id}`,
      `catalogue/roasteries/${roastery.id}/coffees`, fields))
  }
  const recipeFields = fieldsFor(schemas.recipe).map(field => field.name === '$schema' ?
    { ...field, default: '../../schemas/recipe.schema.json' } : field)
  collections.push({ ...folder('recipes', 'Recipes', 'catalogue/recipes', recipeFields),
    // Folder filters are field-value filters, not filename/glob exclusions.
    filter: { field: '$schema', value: '../../schemas/recipe.schema.json' } })
  const versionFields = fieldsFor({ required: ['schemaVersion', 'catalogVersion', 'updatedAt'], properties: {
    schemaVersion: { const: 1 }, catalogVersion: { type: 'string', pattern: '^\\d+\\.\\d+\\.\\d+$' }, updatedAt: { type: 'string', format: 'date' },
  } })
  const referenceFields = [{ name: 'schemaVersion', widget: 'hidden', default: 1 },
    ...Object.entries({ roastLevels: schemas.coffee.properties.roastLevel.enum, grindSizes: schemas.recipe.properties.grind.enum,
      serveStyles: schemas.recipe.properties.serveStyle.enum, coffeeStatuses: schemas.coffee.properties.status.enum }).map(([name, options]) => ({
      name, label: label(name), widget: 'list', default: options, min: options.length, max: options.length,
      hint: 'Ordering only: keep each schema value exactly once. Vocabulary changes require a schema/code PR.',
      field: { name: 'value', widget: 'select', options },
    }))]
  collections.push({ name: 'settings', label: 'Reference and version', delete: false, editor: { preview: false }, files: [
    { name: 'reference', label: 'Reference vocabulary order', file: 'catalogue/reference.json', fields: referenceFields },
    { name: 'version', label: 'Catalog release metadata', file: 'catalogue/version.json', fields: versionFields },
  ] })
  return { backend: { name: 'github', repo: 'error420notfound/pourframe-catalog', branch: 'main',
    base_url: 'https://pourframe-catalog-auth.9h24z9jnfy.workers.dev', auth_endpoint: 'auth' },
    publish_mode: 'editorial_workflow', site_url: 'https://error420notfound.github.io/pourframe-catalog/',
    media_folder: 'media/uploads', public_folder: '/pourframe-catalog/media/uploads',
    show_preview_links: false, editor: { preview: false }, collections }
}

export async function configText() {
  return '# Generated from schemas by npm run generate:cms. Do not hand-edit.\n' + stringify(await configuration(), { lineWidth: 110 })
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const expected = await configText(), path = join(repository, 'admin/config.yml')
  if (process.argv.includes('--check')) {
    if (await readFile(path, 'utf8') !== expected) throw new Error('Stale CMS configuration; run npm run generate:cms')
    console.log('CMS configuration matches catalog schemas and roastery sources.')
  } else await writeFile(path, expected)
}
