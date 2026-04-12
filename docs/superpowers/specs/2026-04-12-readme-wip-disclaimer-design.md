# README WIP Disclaimer Design

## Goal

Add a clear disclaimer to `README.md` that sets expectations for early adopters without weakening the core product message.

## Why

The current README presents Z8 as a polished and production-capable workforce management platform, which is directionally true, but it does not make the current maturity level explicit. Because the product is already used by several companies of different sizes, the disclaimer should acknowledge that real-world use exists while still being honest that parts of the product remain work in progress.

This is especially important for export-related expectations. Not all export options have been validated in every circumstance yet, so the README should avoid implying exhaustive coverage. The README should also give readers a clear path to report problems by opening a GitHub issue.

## Recommended Change

Insert a compact notice block near the top of `README.md`, directly below the opening product summary and before the first section divider.

The notice should communicate four things:

- Z8 is still a work in progress
- the product is already used by several companies of different sizes
- some behavior, capabilities, and interfaces may still change
- not all export options have been tested in all circumstances yet

The notice should end with a direct call to action asking users to open a GitHub issue if they encounter a bug or unexpected behavior.

## Placement

Place the disclaimer at the top of the README rather than in a later documentation or contribution section.

This is the best trade-off because:

- readers will see it before they interpret the feature list as a complete maturity guarantee
- the change remains small and local
- the rest of the README can stay intact

## Tone

The wording should stay calm, direct, and credible.

It should not sound apologetic or alarmist. The goal is to set expectations clearly while reinforcing that the product already delivers value in production-like environments.

## Non-Goals

- No broader README rewrite
- No changes to feature descriptions outside the new disclaimer block
- No new support workflow beyond pointing users to GitHub issues
- No claim that exports are unsafe or unusable; only that coverage is not fully tested in every scenario

## Content Constraints

The disclaimer should avoid:

- vague language like "beta-ish" or "maybe unstable"
- overpromising support or test coverage
- undercutting the rest of the README with overly negative framing

The disclaimer should include:

- explicit WIP language
- explicit mention of current company usage
- explicit mention of export-testing limits
- explicit GitHub issue reporting guidance

## Validation

Validation for this change is lightweight:

- confirm the disclaimer appears in the intended top-of-file position
- confirm the wording covers all requested expectations
- confirm the GitHub issue call to action is present and readable

## Implementation Shape

This should be a single-file documentation edit in `README.md`.

The safest implementation is to add one short notice block below the intro, preserving the rest of the file structure and content.
