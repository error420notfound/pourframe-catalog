# Contributing

## General rules

- Use lowercase kebab-case for IDs, directories, and filenames.
- Keep search indexes small; put full metadata in detail files.
- Use UTF-8 JSON with two-space indentation and a trailing newline.
- Record where facts came from in each detail record's `source` object.
- Never include user inventory, roast dates for a purchased bag, or other
  personal information.
- Run `node scripts/validate-catalog.mjs` before opening a pull request.

## Add a roastery and coffee

1. Add the roastery to `catalogue/roasteries/index.json`.
2. Create `catalogue/roasteries/<roastery-id>/index.json`.
3. Add one detail file per coffee under that roastery's `coffees/` directory.
4. Add every coffee to the roastery index using its exact relative path.

## Add a recipe

1. Create `catalogue/recipes/<recipe-id>.json`.
2. Add its searchable summary to `catalogue/recipes/index.json`.

Catalog records must describe publicly documented information. Do not copy
marketing descriptions verbatim unless their license allows redistribution.
