import { generate } from './generate-indexes.mjs'
import { targetRoot } from './catalog.mjs'

try {
  // Scan every authored record, validate existing schemas and relationships,
  // then compare all generated consumer indexes.
  await generate(targetRoot(), true)
  console.log('Catalog structure, schemas, references and generated indexes are valid.')
} catch (error) {
  console.error(`Catalog validation failed:\n${error.message}`)
  process.exitCode = 1
}
