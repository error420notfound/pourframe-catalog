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
    daybreak-demo/
      index.json
      coffees/
        monsoon-orchard.json
  recipes/
    index.json
    example-v60.json
schemas/
  coffee.schema.json
  recipe.schema.json
  roastery-index.schema.json
scripts/
  validate-catalog.mjs
```

All IDs and filenames use lowercase kebab-case. Index entries contain only the
fields required for search and discovery; detail files contain the complete
record. Dates use ISO 8601 (`YYYY-MM-DD`).

## Validate locally

```sh
node scripts/validate-catalog.mjs
```

See [CONTRIBUTING.md](CONTRIBUTING.md) before adding a roastery, coffee, or
recipe. The records currently included are fictional dummy data and should be
replaced with verified catalog data.
