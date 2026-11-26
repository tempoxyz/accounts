# Writing Docs

The pack checks English prose in Markdown files and writes one item per file to the `documentation` category. The textlint parser joins text across emphasis and link labels. The checks exclude link destinations, URL text, Markdown code, and comments.

## Limits

Each sentence permits 25 words. Each paragraph permits 50 words and six sentences. A heading permits three words. Words are whitespace-delimited tokens with a letter or digit. A length failure reports the source line, count, limit, and an excerpt.

`sentence-splitter` recognizes boundaries even before lowercase names, as in `npm exits. npm starts.` The `productNames` list in the script preserves exact heading spellings, including `npm` and `GitHub`.

## Editorial Checks

The voice and word-choice checks report matches from write-good and the script's word lists. The tense check uses compromise's part-of-speech tags and the Brill lexicon. A pass means no listed pattern matched, not that the grammar or wording is correct.

For example, `has run` matches a perfect-tense pattern. `The record is missing.` does not match the progressive pattern: the tagger reads `missing` as an adjective. The report names the phrase for review.

## Requirements

- **Bun:** Runs the script and installs the tools from the pack's lockfile.

## Add

```sh
# Pin the pack, and approve the install of its dependencies.
uphill add wevm/uphill/packs/writing-docs@main
```
