// Executed only from the trusted base checkout by pull_request_target.
const { execFileSync } = require('node:child_process')
const { resolve } = require('node:path')
const { readdirSync } = require('node:fs')

module.exports = async function prepare({ github, context, core }) {
  const pr = context.payload.pull_request
  if (pr.head.repo.full_name !== `${context.repo.owner}/${context.repo.repo}` ||
      !pr.head.ref.startsWith('cms/') || pr.base.ref !== 'main') {
    throw new Error('Only same-repository CMS PRs targeting main can be prepared')
  }
  const candidate = resolve('candidate')
  const git = args => execFileSync('git', args, { cwd: candidate, encoding: 'utf8' }).trim()
  const original = git(['rev-parse', 'HEAD'])
  if (original !== pr.head.sha) throw new Error('Checkout does not match the event PR head')
  // No scripts, schemas, workflows, dependencies, or other executable PR content.
  const allowed = /^(?:content\/roasteries\/[a-z0-9]+(?:-[a-z0-9]+)*\.json|catalogue\/(?:reference|version)\.json|catalogue\/recipes\/[a-z0-9]+(?:-[a-z0-9]+)*\.json|catalogue\/roasteries\/(?:index\.json|[a-z0-9]+(?:-[a-z0-9]+)*\/(?:index\.json|coffees\/[a-z0-9]+(?:-[a-z0-9]+)*\.json)))$/
  const changed = execFileSync('git', ['diff', '--name-only', '-z', `${pr.base.sha}...${original}`], { cwd: candidate, encoding: 'utf8' }).split('\0').filter(Boolean)
  for (const path of changed) if (!allowed.test(path)) throw new Error(`CMS PR changes unsupported path: ${path}. Use a normal code PR.`)
  const run = name => execFileSync(process.execPath, [resolve('tooling/scripts', name), '--root', candidate], { encoding: 'utf8' })
  core.info(run('generate-indexes.mjs'))
  core.info(run('validate-catalog.mjs'))
  const sourceIds = path => readdirSync(resolve(path, 'content/roasteries')).filter(name => name.endsWith('.json')).sort().join('\n')
  if (sourceIds('tooling') !== sourceIds('candidate')) throw new Error('Adding or removing roasteries requires a normal code PR and npm run generate:cms')
  git(['add', '--', 'catalogue/roasteries/index.json', 'catalogue/recipes/index.json', ':(glob)catalogue/roasteries/*/index.json'])
  const staged = git(['diff', '--cached', '--name-only'])
  if (staged) {
    git(['-c', 'user.name=github-actions[bot]', '-c', 'user.email=41898282+github-actions[bot]@users.noreply.github.com',
      'commit', '-m', 'Regenerate catalog discovery indexes'])
    // Validate the committed content, not just the previous PR snapshot.
    core.info(run('validate-catalog.mjs'))
    const token = process.env.GITHUB_TOKEN
    if (!token) throw new Error('GITHUB_TOKEN is required for the CMS branch update')
    execFileSync('git', ['push', 'origin', `HEAD:refs/heads/${pr.head.ref}`], {
      cwd: candidate, encoding: 'utf8', env: { ...process.env,
        GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'http.https://github.com/.extraheader',
        GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${Buffer.from(`x-access-token:${token}`).toString('base64')}` },
    })
  }
  const sha = git(['rev-parse', 'HEAD'])
  const { data: current } = await github.rest.pulls.get({ ...context.repo, pull_number: pr.number })
  if (current.state !== 'open' || current.head.sha !== sha) throw new Error('PR moved during preparation; rerun for its latest head')
  // GITHUB_TOKEN pushes do not guarantee another automatic validation run. Explicitly
  // attach the required check to the exact resulting commit, using the same name
  // and GitHub Actions app as the normal read-only validation job.
  await github.rest.checks.create({ ...context.repo, head_sha: sha, name: 'Catalog validation',
    status: 'completed', conclusion: 'success', completed_at: new Date().toISOString(),
    details_url: `${context.serverUrl}/${context.repo.owner}/${context.repo.repo}/actions/runs/${context.runId}`,
    output: { title: 'Catalog indexes generated and validated', summary: `Trusted base-branch tooling generated the indexes and validated all records and references on commit ${sha}.` },
  })
  core.info(`Prepared and validated CMS PR #${pr.number} at ${sha}`)
}
