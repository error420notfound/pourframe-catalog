# Contributing

## General rules

- Use lowercase kebab-case for IDs, directories, and filenames.
- Keep search indexes small; put full metadata in detail files.
- Use UTF-8 JSON with two-space indentation and a trailing newline.
- Record where facts came from in each detail record's `source` object.
- Never include user inventory, roast dates for a purchased bag, or other
  personal information.
- Install Node.js 22+ dependencies with `npm ci --ignore-scripts`. Run
  `npm run generate` and `node scripts/validate-catalog.mjs` before opening a PR.

## Add a roastery and coffee

1. Add authored metadata to `content/roasteries/<roastery-id>.json`, matching the
   `roastery` object in `schemas/roastery-index.schema.json`.
2. Add one coffee detail file under `catalogue/roasteries/<roastery-id>/coffees/`.
3. Run `npm run generate:cms` for a new roastery and `npm run generate` for indexes.
4. Commit authored records and generated changes together. Never hand-edit indexes.

## Add a recipe

1. Create `catalogue/recipes/<recipe-id>.json`.
2. Run `npm run generate` and commit the generated recipe index with the record.

IDs must match filenames. Keep existing IDs stable when renaming display names.
Delete a detail record in a PR and regenerate indexes before merging. Removing a
roastery requires removing its coffees first. For CMS login, drafts, review,
deletion limitations, and hosting setup, see [CMS setup](docs/cms-setup.md).

Catalog records must describe publicly documented information. Do not copy
marketing descriptions verbatim unless their license allows redistribution.
