# PourFrame Catalog

Community-maintained coffee and brewing recipe data for PourFrame.

The repository is deliberately split into small indexes and individual detail
records. A client first downloads a roastery or recipe index, then downloads a
full record only after the user selects it.

## Layout

```text
catalogue/
  version.json
  reference.json
  roasteries/
    index.json
    blue-tokai/
      index.json
      coffees/
        salawara-estate.json
  recipes/
    index.json
    example-v60.json
schemas/
  coffee.schema.json
  recipe.schema.json
  roastery-index.schema.json
scripts/
  validate-catalog.mjs
  generate-indexes.mjs
content/roasteries/    # authored roastery metadata; consumer indexes are generated
admin/                # static Decap CMS, no application framework
```

All IDs and filenames use lowercase kebab-case. Index entries contain only the
fields required for search and discovery; detail files contain the complete
record. Dates use ISO 8601 (`YYYY-MM-DD`).

## Validate locally

```sh
npm ci --ignore-scripts
npm run generate
node scripts/validate-catalog.mjs
```

The static Decap editor uses draft branches and reviewed pull requests. See
[CMS setup](docs/cms-setup.md) for manual GitHub/Pages settings, editor access,
local preview, index ownership, and the complete publish workflow. Pages and the
separate OAuth proxy must be deployed before hosted login can be verified.

See [CONTRIBUTING.md](CONTRIBUTING.md) before adding a roastery, coffee, or
recipe. Coffee records include source URLs and the date their public product
information was checked. Recipe records are still fictional examples.
