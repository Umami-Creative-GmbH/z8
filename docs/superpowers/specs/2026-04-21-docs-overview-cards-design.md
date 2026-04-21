# Docs Overview Cards Design

## Summary

Refine the `/docs` overview cards so the three top-level scopes feel more polished and product-like, while also fixing the current metadata mismatch in the overview page implementation.

## Context

- The docs shell now exposes the intended top-level scopes: `Product`, `Desktop`, and `Technical`.
- The main shell and theme are in a better state after removing the incorrect top-tab and transparent-header behavior.
- The `/docs` overview page currently works as an entry point, but its cards are visually weak and read more like plain link boxes than intentional scope-entry surfaces.
- The current overview page implementation also has a real data-shape bug: it reads `docsScopes` with mismatched property names relative to the shared shell metadata.

## Goals

- Make the three overview cards feel clearer, more deliberate, and more aligned with the Z8 product shell.
- Preserve the calm tech-blue product aesthetic rather than introducing louder marketing-style visuals.
- Improve hierarchy inside each card so readers can scan scope, audience, description, primary action, and quick links in a clear order.
- Fix the shared metadata usage so the overview page and docs shell consume the same field names consistently.

## Non-Goals

- No changes to the docs shell layout structure.
- No theme-token rewrite.
- No changes to the content tree or top-level scope model.
- No rewrite of the Product, Desktop, or Technical landing pages.

## Approved Direction

Use `Product Console Cards`.

This direction should make the overview cards feel more like product entry surfaces than generic documentation cards. The design should stay restrained, technical, and operationally trustworthy.

## Card Design

Each of the three cards should use the same layout structure with scope-specific accents.

### Card hierarchy

Each card should present content in this order:

1. compact scope label
2. title
3. audience line
4. short description
5. primary CTA
6. quick links

This ordering gives the card one clear reading path instead of treating all links equally.

### Visual treatment

- increase vertical breathing room slightly
- add a subtle accent wash at the top of the card
- keep the card body mostly neutral for readability
- use a contained icon tile near the top-left as the main visual anchor
- keep border and shadow treatment quiet and product-like

### Scope accents

- `Product`: blue accent wash
- `Desktop`: indigo/steel accent wash
- `Technical`: cyan/slate accent wash

These accents should be soft and localized to the card header area rather than turning the whole card into a colored surface.

### CTA treatment

The primary “Open …” action should feel like the main path into the scope.

It should:

- read as a primary action rather than a plain text link
- remain visually restrained
- sit above the quick links so the secondary links do not compete with the card’s main action

### Quick links

Quick links should remain visible, but clearly secondary.

They should:

- sit in a lighter-weight list beneath the primary action
- preserve direct access to high-value sections
- avoid overpowering the title and primary CTA

## Shared Metadata Contract

The overview page should use the same property names as the shared `docsScopes` metadata.

Implementation intent:

- remove the current mismatch between the overview-page destructuring and the actual metadata shape
- keep the metadata model simple and shared
- only adjust `docs-shell.tsx` if a minimal cleanup materially improves consistency

## File-Level Scope

### Primary file

- `apps/docs/src/app/docs/page.tsx`
  - redesign the overview cards
  - fix the incorrect field destructuring
  - improve the CTA and quick-link hierarchy

### Supporting file

- `apps/docs/src/lib/docs-shell.tsx`
  - make only the minimal metadata adjustments required so the overview page and layout share one clean contract

No other files should change unless a very small related fix is strictly required.

## Verification

- run `pnpm build` in `apps/docs`
- confirm `/docs` renders with the redesigned cards
- confirm all card links still point to valid scope routes and quick-link destinations
- confirm the overview page consumes `docsScopes` without field-name mismatches

## Risks And Constraints

- The redesign should not drift into a marketing style that conflicts with the docs shell.
- The overview page should stay easy to scan on both desktop and mobile.
- Any metadata cleanup should stay minimal so the layout tab system is unaffected.

## Approved Preferences

- desired direction: more polished and product-like
- keep the current shell intact
- focus only on `/docs` overview cards and shared metadata consistency
