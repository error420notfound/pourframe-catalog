import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cp, mkdtemp, readFile, writeFile, mkdir, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { parse } from 'yaml'
import { contracts, encode, expectedIndexes, json, repository } from './catalog.mjs'
import { generate } from './generate-indexes.mjs'
import { configText } from './build-cms-config.mjs'
import { prepareRecord } from '../admin/cms.js'

async function fixture(t) {
  const prefix = join(tmpdir(), 'pourframe-catalog-')
  const root = await mkdtemp(prefix)
  t.after(async () => {
    assert.ok(resolve(root).startsWith(resolve(prefix)))
    await rm(root, { recursive: true, force: true })
  })
  for (const folder of ['content', 'catalogue']) await cp(join(repository, folder), join(root, folder), { recursive: true })
  return root
}
const save = (root, path, value) => writeFile(join(root, path), encode(value))

test('existing records retain consumer contracts and authored metadata', async t => {
  const root = await fixture(t)
  const oldRoot = await json(join(root, 'catalogue/roasteries/index.json'))
  await generate(root)
  await generate(root, true)
  assert.deepEqual(await json(join(root, 'catalogue/roasteries/index.json')), oldRoot)
  for (const entry of oldRoot.roasteries) {
    assert.deepEqual(await json(join(root, 'catalogue', entry.path)), await json(join(repository, 'catalogue', entry.path)))
  }
  assert.deepEqual(await generate(root), [])
})

test('coffee and recipe create/edit/delete rebuild discovery entries with stable paths', async t => {
  const root = await fixture(t)
  const coffeePath = 'catalogue/roasteries/blue-tokai/coffees/fixture-coffee.json'
  const coffee = { schemaVersion: 1, id: 'fixture-coffee', name: 'Fixture coffee', roasteryId: 'blue-tokai',
    status: 'unknown', featured: false, sortOrder: 0, source: { url: 'https://example.com/coffee', checkedAt: '2026-10-16' }, updatedAt: '2026-10-16' }
  const recipePath = 'catalogue/recipes/fixture-recipe.json'
  const recipe = { ...await json(join(root, 'catalogue/recipes/example-v60.json')), id: 'fixture-recipe', name: 'Fixture recipe', flowRate: 4.25 }
  await save(root, coffeePath, coffee)
  await save(root, recipePath, recipe)
  await assert.rejects(generate(root, true), /Stale generated indexes/)
  await generate(root)
  let roastery = await json(join(root, 'catalogue/roasteries/blue-tokai/index.json'))
  assert.equal(roastery.coffees[0].id, coffee.id)
  assert.equal(roastery.coffees[0].featured, false)
  assert.equal(roastery.coffees[0].path, coffeePath.replace('catalogue/', ''))
  let index = await json(join(root, 'catalogue/recipes/index.json'))
  assert.equal(index.recipes.find(item => item.id === recipe.id).path, 'recipes/fixture-recipe.json')
  coffee.name = 'Edited coffee'; coffee.status = 'available'; recipe.name = 'Edited recipe'
  await save(root, coffeePath, coffee); await save(root, recipePath, recipe)
  await generate(root); await generate(root, true)
  roastery = await json(join(root, 'catalogue/roasteries/blue-tokai/index.json'))
  assert.equal(roastery.coffees[0].name, 'Edited coffee')
  assert.equal(roastery.coffees[0].status, 'available')
  await rm(join(root, coffeePath)); await rm(join(root, recipePath))
  await generate(root); await generate(root, true)
  roastery = await json(join(root, 'catalogue/roasteries/blue-tokai/index.json'))
  index = await json(join(root, 'catalogue/recipes/index.json'))
  assert.ok(!roastery.coffees.some(item => item.id === coffee.id))
  assert.ok(!index.recipes.some(item => item.id === recipe.id))
})

test('roastery metadata changes preserve authored fields; deletion rejects orphaned coffees', async t => {
  const root = await fixture(t)
  const path = 'content/roasteries/blue-tokai.json', record = await json(join(root, path))
  record.logoUrl = 'https://example.com/new-logo.png'; record.sortOrder = 0; record.description = 'Edited description'
  await save(root, path, record); await generate(root)
  const index = await json(join(root, 'catalogue/roasteries/index.json'))
  assert.equal(index.roasteries[0].logoUrl, record.logoUrl)
  assert.equal((await json(join(root, 'catalogue/roasteries/blue-tokai/index.json'))).roastery.description, record.description)
  await rm(join(root, path))
  await assert.rejects(generate(root), /existing parent roastery/)
  const coffeeDir = join(root, 'catalogue/roasteries/blue-tokai/coffees')
  assert.ok(resolve(coffeeDir).startsWith(resolve(root)))
  await rm(coffeeDir, { recursive: true })
  await generate(root); await generate(root, true)
  assert.ok(!(await json(join(root, 'catalogue/roasteries/index.json'))).roasteries.some(item => item.id === record.id))
  await assert.rejects(readFile(join(root, 'catalogue/roasteries/blue-tokai/index.json')), { code: 'ENOENT' })
  await save(root, 'content/roasteries/fixture-roastery.json', { id: 'fixture-roastery', name: 'Fixture', logoUrl: 'https://example.com/logo.png', active: false })
  await generate(root); await generate(root, true)
  assert.deepEqual((await json(join(root, 'catalogue/roasteries/fixture-roastery/index.json'))).coffees, [])
})

test('full schema validation rejects invalid and unindexed detail records', async t => {
  const root = await fixture(t), path = 'catalogue/roasteries/blue-tokai/coffees/fixture.json'
  const valid = { ...await json(join(root, 'catalogue/roasteries/blue-tokai/coffees/salawara-estate.json')), id: 'fixture' }
  const cases = [
    { ...valid, bagSizeG: '250' }, { ...valid, bagSizeG: 0 }, { ...valid, status: 'bogus' },
    { ...valid, source: { url: 'not-a-url', checkedAt: '2026-02-30' } },
    { ...valid, roasteryId: 'half-light' }, { ...valid, id: 'renamed' },
    { ...valid, altitudeRangeM: { min: 1500, max: 1000 } }, { ...valid, inventory: 200 },
  ]
  for (const record of cases) {
    await save(root, path, record)
    await assert.rejects(expectedIndexes(root))
  }
  await save(root, path, valid); await generate(root)
  const ref = await json(join(root, 'catalogue/reference.json'))
  ref.roastLevels[0] = 'Unrecognized'; await save(root, 'catalogue/reference.json', ref)
  await assert.rejects(generate(root), /schema enum/)
})

test('a data symlink cannot redirect generation outside the checkout', async t => {
  const root = await fixture(t), outside = await mkdtemp(join(tmpdir(), 'pourframe-catalog-outside-'))
  t.after(async () => {
    assert.ok(resolve(outside).startsWith(resolve(join(tmpdir(), 'pourframe-catalog-outside-'))))
    await rm(outside, { recursive: true, force: true })
  })
  try { await symlink(outside, join(root, 'catalogue/roasteries/redirect'), process.platform === 'win32' ? 'junction' : 'dir') }
  catch (error) { if (['EPERM', 'EACCES'].includes(error.code)) { t.skip('OS does not permit symlink creation'); return }; throw error }
  await assert.rejects(generate(root), /Unsupported file type/)
})

test('CMS YAML matches all schema fields and cannot treat indexes as detail records', async () => {
  const text = await readFile(join(repository, 'admin/config.yml'), 'utf8')
  assert.equal(text, await configText())
  const config = parse(text), { schemas } = await contracts()
  assert.equal(config.publish_mode, 'editorial_workflow')
  assert.deepEqual(config.backend, { name: 'github', repo: 'error420notfound/pourframe-catalog', branch: 'main', base_url: 'https://pourframe-catalog-auth.9h24z9jnfy.workers.dev', auth_endpoint: 'auth' })
  function mappings(fields, schema, optionalAncestor = false) {
    assert.deepEqual(fields.map(field => field.name), Object.keys(schema.properties))
    for (const field of fields) {
      const property = schema.properties[field.name]
      const required = schema.required?.includes(field.name) ?? false
      const permitsBlank = (property.type === 'string' && !property.minLength && !property.pattern && !property.format) || (property.type === 'array' && !property.minItems)
      assert.equal(field.required, required && !optionalAncestor && !permitsBlank)
      if (property.enum) assert.deepEqual(field.options, property.enum)
      if (property.type === 'object') mappings(field.fields, property, optionalAncestor || !required)
      if (property.type === 'number' || property.type === 'integer') assert.equal(field.value_type, property.type === 'integer' ? 'int' : 'float')
      if (property.type === 'array') { assert.equal(field.widget, 'list'); assert.equal(field.max, property.maxItems); assert.deepEqual(field.default, []) }
      if (property.format === 'date') { assert.equal(field.date_format, 'YYYY-MM-DD'); assert.equal(field.time_format, false) }
    }
  }
  for (const collection of config.collections) {
    assert.equal(collection.delete, false)
    if (!collection.folder) { assert.ok(collection.files.every(file => !file.file.endsWith('/index.json'))); continue }
    assert.equal(collection.identifier_field, 'id'); assert.equal(collection.slug, '{{fields.id}}')
    assert.equal(collection.format, 'json'); assert.equal(collection.extension, 'json')
    if (collection.name === 'roasteries') mappings(collection.fields, schemas['roastery-index'].properties.roastery)
    if (collection.name.startsWith('coffees-')) {
      mappings(collection.fields, schemas.coffee)
      const id = collection.name.slice('coffees-'.length)
      assert.equal(collection.folder, `catalogue/roasteries/${id}/coffees`)
      assert.equal(collection.fields.find(field => field.name === 'roasteryId').default, id)
    }
    if (collection.name === 'recipes') {
      mappings(collection.fields, schemas.recipe)
      const filter = collection.filter
      assert.equal((await json(join(repository, 'catalogue/recipes/example-v60.json')))[filter.field], filter.value)
      assert.notEqual((await json(join(repository, 'catalogue/recipes/index.json')))[filter.field], filter.value)
    }
  }
  const page = await readFile(join(repository, 'admin/index.html'), 'utf8')
  assert.match(page, /decap-cms@3\.16\.3\/dist\/decap-cms\.js/)
  assert.match(page, /href="\.\/config\.yml"/)
})

test('preSave protects IDs, relationships and optional JSON values', async () => {
  const { schemas } = await contracts()
  const original = await json(join(repository, 'catalogue/roasteries/blue-tokai/coffees/salawara-estate.json'))
  assert.throws(() => prepareRecord({ ...original, id: 'renamed' }, schemas.coffee, { slug: original.id }), /cannot be renamed/)
  assert.throws(() => prepareRecord(original, schemas.coffee, { roasteryId: 'half-light' }), /original roastery/)
  assert.throws(() => prepareRecord({ ...original, id: 'index' }, schemas.coffee, { newRecord: true }), /reserved/)
  const edited = prepareRecord({ ...original, price: { amount: '', currency: '' }, origin: { country: '', region: '' },
    productUrl: '', altitudeM: null, featured: false, sortOrder: 0, tastingNotes: [] }, schemas.coffee, { slug: original.id }).record
  assert.ok(!('price' in edited)); assert.ok(!('origin' in edited)); assert.ok(!('productUrl' in edited)); assert.ok(!('altitudeM' in edited))
  assert.equal(edited.featured, false); assert.equal(edited.sortOrder, 0); assert.deepEqual(edited.tastingNotes, [])
  assert.throws(() => prepareRecord({ ...original, price: { amount: 10, currency: '' } }, schemas.coffee), /price.currency/)
  assert.throws(() => prepareRecord({ ...original, altitudeRangeM: { min: 100, max: '' } }, schemas.coffee), /altitudeRangeM.max/)
})

test('trusted PR helper updates and validates the resulting commit without another workflow', async t => {
  const sandbox = await fixture(t), candidate = join(sandbox, 'candidate'), remote = join(sandbox, 'remote.git')
  await mkdir(candidate)
  for (const folder of ['content', 'catalogue']) await cp(join(repository, folder), join(candidate, folder), { recursive: true })
  await cp(join(repository, '.gitattributes'), join(candidate, '.gitattributes'))
  await symlink(repository, join(sandbox, 'tooling'), process.platform === 'win32' ? 'junction' : 'dir')
  const git = args => execFileSync('git', args, { cwd: candidate, encoding: 'utf8' }).trim()
  git(['init', '-b', 'main']); git(['config', 'user.name', 'Fixture']); git(['config', 'user.email', 'fixture@example.com'])
  git(['add', '.']); git(['commit', '-m', 'Baseline']); const base = git(['rev-parse', 'HEAD'])
  git(['checkout', '-b', 'cms/recipes/fixture-recipe'])
  await save(candidate, 'catalogue/recipes/fixture-recipe.json', {
    ...await json(join(candidate, 'catalogue/recipes/example-v60.json')), id: 'fixture-recipe', name: 'Fixture',
  })
  git(['add', '.']); git(['commit', '-m', 'Create fixture']); const original = git(['rev-parse', 'HEAD'])
  execFileSync('git', ['init', '--bare', remote], { encoding: 'utf8' })
  git(['remote', 'add', 'origin', remote]); git(['push', '--all', 'origin'])
  const runner = `const {execFileSync}=require('node:child_process');
    const prepare=require(${JSON.stringify(join(repository, 'scripts/prepare-cms-pr.cjs'))});
    const context={repo:{owner:'owner',repo:'repo'},payload:{pull_request:{number:1,base:{ref:'main',sha:${JSON.stringify(base)}},head:{repo:{full_name:'owner/repo'},ref:'cms/recipes/fixture-recipe',sha:${JSON.stringify(original)}}}},serverUrl:'https://github.com',runId:1};
    const head=()=>execFileSync('git',['--git-dir',${JSON.stringify(remote)},'rev-parse','refs/heads/cms/recipes/fixture-recipe'],{encoding:'utf8'}).trim();
    prepare({context,core:{info:()=>{}},github:{rest:{pulls:{get:async()=>({data:{state:'open',head:{sha:head()}}})},checks:{create:async check=>{if(check.head_sha!==head()||check.name!=='Catalog validation'||check.conclusion!=='success')throw Error('Wrong check');console.log(JSON.stringify(check));}}}}}).catch(e=>{console.error(e);process.exitCode=1});`
  const output = execFileSync(process.execPath, ['-e', runner], { cwd: sandbox, encoding: 'utf8', env: { ...process.env, GITHUB_TOKEN: 'fixture-token' } })
  const result = git(['rev-parse', 'HEAD'])
  assert.notEqual(result, original)
  assert.equal(git(['rev-parse', 'HEAD^']), original)
  assert.equal(JSON.parse(output).head_sha, result)
  assert.equal(git(['status', '--porcelain']), '')
  assert.equal(git(['show', '--format=', '--name-only', 'HEAD']), 'catalogue/recipes/index.json')
  await generate(candidate, true)
  // A rerun without data changes must validate the same SHA without another commit.
  execFileSync(process.execPath, ['-e', runner.replace(JSON.stringify(original), JSON.stringify(result))], {
    cwd: sandbox, encoding: 'utf8', env: { ...process.env, GITHUB_TOKEN: 'fixture-token' },
  })
  assert.equal(git(['rev-parse', 'HEAD']), result)
  await mkdir(join(candidate, 'scripts'))
  await writeFile(join(candidate, 'scripts/untrusted.mjs'), 'throw new Error("PR code must not run")\n')
  git(['add', '.']); git(['commit', '-m', 'Unsupported code change'])
  const badHead = git(['rev-parse', 'HEAD'])
  assert.throws(() => execFileSync(process.execPath, ['-e', runner.replace(JSON.stringify(original), JSON.stringify(badHead))], {
    cwd: sandbox, encoding: 'utf8', env: { ...process.env, GITHUB_TOKEN: 'fixture-token' }, stdio: 'pipe',
  }), /unsupported path/)
  assert.equal(execFileSync('git', ['--git-dir', remote, 'rev-parse', 'refs/heads/cms/recipes/fixture-recipe'], { encoding: 'utf8' }).trim(), result)
})

test('privileged helper rejects fork PRs before reading or executing their content', async () => {
  const prepare = createRequire(import.meta.url)('./prepare-cms-pr.cjs')
  await assert.rejects(prepare({ context: { repo: { owner: 'owner', repo: 'repo' }, payload: {
    pull_request: { head: { repo: { full_name: 'fork/repo' }, ref: 'cms/recipes/foo' }, base: { ref: 'main' } },
  } } }), /Only same-repository/)
})

test('workflow YAML isolates PR data from write credentials and prepares static Pages', async () => {
  const workflow = parse(await readFile(join(repository, '.github/workflows/prepare-cms-pr.yml'), 'utf8'))
  assert.ok(workflow.on.pull_request_target)
  assert.deepEqual(workflow.permissions, { contents: 'read' })
  assert.match(workflow.jobs.prepare.if, /head.repo.full_name == github.repository/)
  assert.deepEqual(workflow.jobs.prepare.permissions, { contents: 'write', checks: 'write', 'pull-requests': 'read' })
  const checkouts = workflow.jobs.prepare.steps.filter(step => step.uses?.startsWith('actions/checkout@'))
  assert.equal(checkouts[0].with.ref, '${{ github.event.pull_request.base.sha }}')
  assert.equal(checkouts[0].with.path, 'tooling')
  assert.equal(checkouts[1].with.ref, '${{ github.event.pull_request.head.sha }}')
  assert.ok(checkouts.every(step => step.with['persist-credentials'] === false))
  const install = workflow.jobs.prepare.steps.find(step => step.run?.startsWith('npm ci'))
  assert.equal(install['working-directory'], 'tooling')
  assert.match(install.run, /--ignore-scripts/)
  const pages = parse(await readFile(join(repository, '.github/workflows/pages.yml'), 'utf8'))
  assert.deepEqual(pages.on.push.branches, ['main'])
  assert.deepEqual(pages.jobs.deploy.permissions, { pages: 'write', 'id-token': 'write' })
})
