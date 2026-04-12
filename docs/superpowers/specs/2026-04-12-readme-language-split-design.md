# README Language Split Design

## Goal

Make German the primary repository README while preserving the current English README content as an easy-to-find fallback.

## Why

The current top-level `README.md` is already written in English, but the requested documentation direction is to make German the default landing page for the repository.

At the same time, the existing English content should remain available as a first-class fallback rather than being removed or buried deeper in the docs tree. Readers need a clear way to switch between both languages from either file.

## Recommended Change

Use a two-file top-level README structure:

- `README.md` becomes the primary German README
- `README.en.md` becomes the English fallback README

Both files should include a compact language switcher at the top so users can move between the German and English versions immediately.

## File Layout

- Rename the current English `README.md` content into `README.en.md`
- Replace `README.md` with a German translation of the same content

This keeps the repository landing page fully informative while making the language policy explicit and easy to maintain.

## Cross-Linking

Add a short language selector at the very top of both files:

- In `README.md`: `Deutsch | [English](README.en.md)`
- In `README.en.md`: `[Deutsch](README.md) | English`

The switcher should appear before the main title so it is visible immediately on GitHub.

## Content Expectations

The German `README.md` should be a faithful translation of the current English README rather than a rewritten marketing variant.

That means:

- preserve the existing section structure
- preserve the linked files and relative paths
- preserve the meaning of product claims and compliance statements
- keep the WIP notice and fair usage guidance aligned between languages

Minor wording adjustments are acceptable where direct translation would sound unnatural in German, but the scope and promises should stay equivalent.

## Non-Goals

- No broader documentation reorganization
- No move to `README.de.md`
- No placeholder translation with partial English leftovers unless required by a proper noun or product name
- No content expansion beyond what is already in the English README

## Validation

Validation for this change is lightweight:

- confirm `README.md` is German and `README.en.md` is English
- confirm both files link to each other correctly
- confirm the main sections and linked documentation references stay aligned
- confirm GitHub-visible top-of-file language switching is present in both files

## Implementation Shape

This should stay a minimal documentation-only change touching two top-level files.

The safest implementation is:

1. copy the existing English README into `README.en.md`
2. replace `README.md` with the German equivalent
3. add mirrored language switch links to both files
