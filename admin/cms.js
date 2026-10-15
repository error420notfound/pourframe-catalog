// Shared by the browser hooks and local fixture tests. JSON values only.
export function prepareRecord(record, schema, { slug, newRecord, roasteryId } = {}) {
  if (schema.properties?.id) {
    if (!/^(?!index$)[a-z0-9]+(?:-[a-z0-9]+)*$/.test(record.id)) throw new Error('Use a permanent kebab-case ID; index is reserved.')
    if (!newRecord && slug && record.id !== slug) throw new Error('Existing IDs and filenames cannot be renamed. Use a reviewed migration PR.')
  }
  if (roasteryId && record.roasteryId !== roasteryId) throw new Error('The coffee must stay in its original roastery collection.')
  const removals = []
  function visit(value, definition, path = [], required = true) {
    if (!required && (value === '' || value === null || value === undefined)) { removals.push(path); return undefined }
    if (definition.type === 'object' && value && typeof value === 'object') {
      // An untouched optional object can contain empty required child inputs.
      if (!required && Object.values(value).every(child => child === '' || child === null || child === undefined)) {
        removals.push(path); return undefined
      }
      for (const name of definition.required ?? []) {
        if (value[name] === undefined || value[name] === null) throw new Error(`${[...path, name].join('.')}: is required`)
      }
      const result = {}
      for (const [name, child] of Object.entries(value)) {
        const property = definition.properties?.[name]
        if (!property) { result[name] = child; continue }
        const next = visit(child, property, [...path, name], definition.required?.includes(name) ?? false)
        if (next !== undefined) result[name] = next
      }
      if (!required && !Object.keys(result).length) { removals.push(path); return undefined }
      return result
    }
    if (required && (value === undefined || value === null || (value === '' && definition.type !== 'string'))) throw new Error(`${path.join('.')}: is required`)
    if (definition.type === 'array') {
      if (!Array.isArray(value)) throw new Error(`${path.join('.')}: must be a list`)
      return value.map((child, index) => visit(child, definition.items, [...path, index], true))
    }
    if (definition.type === 'string' && typeof value !== 'string') throw new Error(`${path.join('.')}: must be text`)
    if (typeof value === 'string' && definition.pattern && !new RegExp(definition.pattern).test(value)) throw new Error(`${path.join('.')}: must match the catalog schema format`)
    if (typeof value === 'number' && definition.exclusiveMinimum !== undefined && value <= definition.exclusiveMinimum) throw new Error(`${path.join('.')}: must be greater than ${definition.exclusiveMinimum}`)
    return value
  }
  const clean = visit(record, schema)
  if (schema.properties?.bloom && !(clean.bloom < clean.water)) throw new Error('Bloom must be less than total water.')
  if (clean.altitudeRangeM && clean.altitudeRangeM.min > clean.altitudeRangeM.max) throw new Error('Altitude minimum must not exceed maximum.')
  return { record: clean, removals }
}

if (typeof window !== 'undefined') {
  try {
    const [coffee, recipe, roasteryIndex] = await Promise.all(['coffee', 'recipe', 'roastery-index'].map(async name => {
      const response = await fetch(new URL(`../schemas/${name}.schema.json`, import.meta.url))
      if (!response.ok) throw new Error(`Unable to load ${name} schema (${response.status})`)
      return response.json()
    }))
    window.CMS.registerEventListener({ name: 'preSave', handler: ({ entry }) => {
      const collection = entry.get('collection')
      const schema = collection === 'roasteries' ? roasteryIndex.properties.roastery :
        collection === 'recipes' ? recipe : collection.startsWith('coffees-') ? coffee : null
      let data = entry.get('data')
      if (schema) {
        const { removals } = prepareRecord(data.toJS(), schema, {
          slug: entry.get('slug'), newRecord: entry.get('newRecord'),
          roasteryId: collection.startsWith('coffees-') ? collection.slice('coffees-'.length) : undefined,
        })
        // Preserve Immutable data and remove only absent optional values.
        for (const path of removals.sort((a, b) => b.length - a.length)) data = data.deleteIn(path)
      }
      return data
    } })
    const local = ['localhost', '127.0.0.1'].includes(window.location.hostname) && new URLSearchParams(window.location.search).has('local')
    window.CMS.init(local ? { config: { local_backend: true, publish_mode: 'simple' } } : undefined)
  } catch (error) {
    document.body.textContent = `Unable to start the catalog editor: ${error.message}`
    console.error(error)
  }
}
