# Catalog editor setup

The static editor is `https://error420notfound.github.io/pourframe-catalog/admin/`.
It pins Decap CMS **3.16.3**, uses GitHub editorial workflow, and loads its config
and helper scripts relative to `/pourframe-catalog/admin/`. There is no app framework.

## Manual GitHub settings

Apply these settings after reviewing and merging the implementation through a
normal code PR. This checkout does not enable Pages or modify repository settings.

1. **Settings → Actions → General**: enable Actions and permit the official
   `actions/checkout`, `actions/setup-node`, `actions/github-script`,
   `actions/upload-pages-artifact`, and `actions/deploy-pages` actions. The default
   workflow token can remain read-only; only the CMS preparation job requests
   `contents: write`, `checks: write`, and `pull-requests: read`. Organization policy must permit those
   permissions. No PAT or OAuth secret belongs in this repository. The checkbox
   allowing Actions to create/approve PRs is not required; Decap editors create PRs.
2. **Settings → General → Pull Requests**: enable **Allow merge commits**, matching
   Decap's default publish operation.
3. **Settings → Branches → Add branch protection rule**, branch `main`: require
   a pull request and the **Catalog validation** check from GitHub Actions before
   merging. Require branches to be up to date, disable force pushes/deletion,
   and apply protection to administrators (no bypass). Set required approving
   reviews to **1** when a second maintainer is available; use **0** for a solo
   maintainer. The check becomes selectable after its first run. Leave `cms/**`
   branches writable so editors and the preparation job can update drafts.
4. **Settings → Pages → Build and deployment → Source**: select **GitHub Actions**.
   Do not choose a branch/Jekyll source. In **Settings → Environments**, if a
   `github-pages` environment exists, permit deployment from `main`. After enabling
   Pages, run **Actions → Deploy catalog Pages → Run workflow → main** once.
   Later merges to `main` deploy automatically. The build publishes only the
   static editor, consumer catalog, schemas, and optional media.
5. **Settings → Collaborators** (or **Collaborators and teams**): give editors
   **Write** access or higher. Readers cannot use this GitHub backend to edit.
   Each editor signs in with GitHub, authorizes the OAuth app, and satisfies any
   organization SSO/OAuth-app restrictions. Open authoring/fork editing is disabled.

The OAuth proxy must be deployed separately at
`https://pourframe-catalog-auth.9h24z9jnfy.workers.dev` **before live GitHub login
can be verified**. The config uses `base_url` above and `auth_endpoint: auth`.
The separate proxy owner must allow the Pages editor's origin and provide the
GitHub OAuth callback handling. This change neither deploys the proxy nor requests
or stores its secrets. Loading the login page is not proof of OAuth success.

## Local preview and checks

Use Node.js 22 or later:

```sh
npm ci --ignore-scripts
npm run generate
npm run generate:cms
npm run validate
npm test
npm run preview
```

Open `http://localhost:4173/pourframe-catalog/admin/`. This previews the real project
base path, including `config.yml`, `cms.js`, and schema requests. It still uses the
remote GitHub backend unless local mode is explicitly selected. The pinned Decap
script is loaded from jsDelivr, so browser preview needs network access. `_site/`
and browser QA output are ignored.

For local form editing without GitHub login, start `npx decap-server` in the
repository root in another terminal and open
`http://localhost:4173/pourframe-catalog/admin/?local` (the server's default port
is 8081). This option is accepted only on localhost/127.0.0.1. Local mode uses
simple publishing: **Save/Publish writes directly to your working tree** and does
not simulate PR review. Use a disposable clone for exploratory edits. After local
edits, regenerate indexes and restart preview to refresh the static build. The
production config does not enable the local backend.

## Authoring and index ownership

| Authored data | Derived consumer output |
| --- | --- |
| `content/roasteries/<id>.json` | Root roastery discovery entries and each roastery index's `roastery` object |
| `catalogue/roasteries/<roastery-id>/coffees/<id>.json` | Each roastery index's `coffees` list |
| `catalogue/recipes/<id>.json` | `catalogue/recipes/index.json` |

The source roastery files reuse the existing roastery-object schema from
`schemas/roastery-index.schema.json`. Migration copied every authored property,
including names, geography, URLs, descriptions, active state, and sort order.
No generated index is a CMS collection. Do not edit indexes manually.

Generation uses only authored records, never the previous index as a data source.
Roasteries and coffees sort by `sortOrder`, then ID; missing sort order sorts last.
Recipes sort by ID. Output uses UTF-8, two spaces, and LF with a trailing newline.
The catalog version/date remain explicit release metadata; generation does not
invent dates or increment versions. Reference forms reorder existing schema enum
values; changing vocabulary requires a schema and consumer compatibility code PR.

Coffee collections use explicit, ordinary folders for the three current roasteries,
so neighboring `index.json` files cannot appear as coffee records. Recipes use a
field-value filter on `$schema: ../../schemas/recipe.schema.json`, excluding the
recipe index. Keep that hidden schema field on CMS-managed recipes. Decap's beta
nested collections are unnecessary for this layout and would expose path movement.
Existing IDs are checked against their filenames on save and by validation; the
roastery relationship is fixed by the coffee collection. New IDs use lowercase
kebab-case, must be unique in their collection, and cannot be `index`. Changing a
display name does not change the ID or filename. ID migrations require a code PR.

To add a roastery, use a normal code PR: add its source metadata JSON, add coffee
details under its existing consumer path convention if any, then run
`npm run generate:cms` to add its coffee collection and `npm run generate` to create
indexes. Roastery creation is disabled in the CMS because it also needs this config
change. Routine metadata edits do not change collection names or config.

## Full publish workflow

1. Open the editor and sign in after the proxy is deployed. Choose a roastery,
   coffee collection, recipe, or reference/version file. Supply public sources and
   checked/published/updated dates; optional unknowns can remain blank.
2. **Save draft** creates or updates a `cms/...` branch and GitHub PR. Move it through
   Draft, In review, and Ready as appropriate. Review source facts and the PR diff.
3. **Prepare CMS indexes** runs only for same-repository `cms/` PRs targeting `main`.
   It checks out tooling and dependencies from the trusted base commit, reads only
   allowlisted JSON data from the PR, rejects symlinks, generates indexes, validates,
   and pushes only index changes to that PR branch. It then validates the resulting
   commit and attaches **Catalog validation** to that exact SHA. This explicit check
   avoids relying on a workflow retrigger after a `GITHUB_TOKEN` commit. Depending
   on GitHub's event policy, automation updates may suppress runs or leave new
   `pull_request` runs waiting for approval. If GitHub displays **Approve workflows
   to run**, a maintainer can approve those additional read-only checks.
   Fork PRs never enter the job with write permissions; normal PR validation is
   read-only. Unsupported code changes on a CMS branch require a normal code PR.
4. Wait for preparation and the required check on the **latest** commit. If another
   editor saves while preparation runs, the non-force push or final SHA comparison
   fails safely; rerun preparation for the current head. Fix validation failures
   rather than bypassing them. Maintainers review generated diffs and approve.
5. Use **Publish** in Decap (or merge the reviewed PR in GitHub). Branch protection
   must enforce the check; the CMS alone is not a merge gate. Published data lands
   on `main` together with its indexes, and Pages deploys the static files. Consumers
   keep using their existing small-index → selected-detail paths. Decap removes the
   draft branch/card after publishing.

Published-record **Delete** is disabled because Decap 3.16.3 deletes published
files directly from the publication branch even in editorial mode. Delete via a
normal GitHub PR instead: remove the detail JSON, run `npm run generate`, commit
the record deletion and index changes together, then review/check/merge. To delete
a roastery, first remove all its coffees, then remove its source metadata and run
both generation commands; the generator removes its now-unused consumer index.
Removing a roastery while coffees remain fails validation. Discarding unpublished
drafts in the editorial workflow remains available.

Live OAuth, GitHub permission settings, hosted Actions execution, branch-protection
enforcement, and Pages deployment need verification after manual setup. Local
fixture checks cover index lifecycle and branch-update behavior without publishing.

## Configuration references

Syntax and behavior were checked against official Decap documentation:
[configuration](https://decapcms.org/docs/configuration-options/),
[folder paths and filters](https://decapcms.org/docs/collection-folder/),
[nested collections](https://decapcms.org/docs/collection-nested/),
[editorial workflow](https://decapcms.org/docs/editorial-workflows/),
[GitHub access](https://decapcms.org/docs/github-backend/),
[backend authentication](https://decapcms.org/docs/backends-overview/),
[number types](https://decapcms.org/docs/widgets/number/),
[date storage](https://decapcms.org/docs/widgets/datetime/),
[manual initialization](https://decapcms.org/docs/manual-initialization/), and
[save events](https://decapcms.org/docs/registering-events/).
GitHub documents [automation-triggered workflow behavior](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow)
and [Pages custom workflows](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages).
The direct-delete behavior was confirmed in the pinned release's
[backend implementation](https://github.com/decaporg/decap-cms/blob/decap-cms%403.16.3/packages/decap-cms-core/src/backend.ts).
