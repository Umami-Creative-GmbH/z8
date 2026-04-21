# Docs Shell Redesign Design

## Summary

Redesign the `apps/docs` Fumadocs shell so the site has explicit top-level scope switching, a real `/docs` overview page, and a branded Z8 tech-blue theme that feels clearer and more product-aligned than the default Fumadocs presentation.

## Context

- The docs app already uses Fumadocs with three top-level content roots: `guide`, `desktop`, and `tech`.
- Those roots are already marked with `root: true`, which means Fumadocs can expose them as layout tabs.
- The current docs shell does not use Fumadocs layout tabs correctly. It configures `sidebar.tabs`, which decorates sidebar items but does not provide the intended layout-level tab dropdown behavior.
- `/docs` currently redirects into one section instead of helping users choose the right scope.
- The visual styling is almost entirely the stock Fumadocs default with only a minimal global CSS file.
- The result is usable but unclear: scope boundaries are weak, the docs entry is poor, and the site does not feel like part of the main Z8 product.

## Goals

- Add clear top-level scoping with Fumadocs layout tabs for `Product`, `Desktop`, and `Technical`.
- Make `/docs` a real overview page that explains the three scopes and routes readers intentionally.
- Keep the existing content tree stable while improving the user-facing information architecture.
- Introduce a restrained Z8-aligned blue theme with stronger visual hierarchy than the default theme.
- Preserve Fumadocs-native layout behavior so the shell remains maintainable.
- Keep light and dark themes working through Fumadocs `RootProvider` and theme variables.

## Non-Goals

- No broad rewrite of doc page content outside top-level landing and index clarity work.
- No migration of content between `guide`, `desktop`, and `tech` trees.
- No custom docs rendering system replacing `DocsLayout`, `DocsPage`, or `DocsBody`.
- No custom search implementation.
- No versioning system or multi-app docs split.

## Approved Direction

Use a `Product Operations Blue` docs shell.

This should feel like an extension of the Z8 product rather than a generic help center or developer-template docs site. The aesthetic should stay restrained, precise, and operationally trustworthy.

The shell will rely on Fumadocs primitives rather than replacing them:

- use layout-level tabs and tab mode in `DocsLayout`
- keep the standard page tree and MDX flow
- improve clarity through structure, naming, and theme tokens
- keep custom logic minimal and localized

## Information Architecture

### Top-level scopes

Expose three top-level scopes in the docs shell:

1. `Product`
   - maps to the current `guide` tree
   - audience: employees, managers, administrators
   - purpose: task-oriented product usage documentation

2. `Desktop`
   - maps to the current `desktop` tree
   - audience: desktop app users and IT support
   - purpose: installation, app behavior, troubleshooting, platform-specific guidance

3. `Technical`
   - maps to the current `tech` tree
   - audience: developers, operators, implementers
   - purpose: architecture, deployment, integrations, technical behavior

### User-facing naming

Retitle the root folders so the shell uses explicit scope names:

- `guide` -> `Product`
- `desktop` -> `Desktop`
- `tech` -> `Technical`

This preserves the file structure while making the navigation labels clear.

### Docs entry page

`/docs` becomes a real overview page instead of a redirect.

That page should:

- explain the three scopes in one screen
- give readers a clean starting point based on audience and task
- provide quick entry links for common journeys
- visually reinforce the distinction between product docs, desktop docs, and technical docs

### Sidebar scoping

The sidebar should reflect the active top-level scope rather than feeling like one mixed docs tree.

Design intent:

- the active scope is obvious
- readers see only the relevant navigation for the selected scope
- one or two levels open by default so structure is visible without extra clicks

## Page Shell

### Header

Keep the Fumadocs header, but make it feel like a product shell:

- brand it as `Z8 Docs`
- make the active scope easy to identify
- keep theme controls visible but visually integrated
- include only stable, high-value quick links that improve navigation clarity

### Scope switcher

Use Fumadocs layout tabs at the layout level, not `sidebar.tabs`.

Expected behavior:

- desktop: active scope is shown clearly in the docs shell
- mobile: the same top-level scoping remains visible through the Fumadocs mobile header/dropdown model
- the tab trigger behaves like a mode switcher for the whole docs experience, not a decorative folder icon set

### Overview and section index pages

The overview page and each scope landing page should move away from sparse prose and toward structured orientation.

Each should include:

- short explanation of the area
- intended audience
- quick-start links
- selected highlight links rather than only raw tree traversal

### Doc pages

Keep the standard `DocsPage`, `DocsTitle`, `DocsDescription`, and `DocsBody` components.

Improve clarity mostly through layout and styling, not through custom page logic.

## Visual Design

### Aesthetic

Name: `Product Operations Blue`

Tone:

- restrained
- modern
- precise
- trustworthy

### Differentiation anchor

The docs should feel like an extension of the Z8 application shell. The strongest visible differentiator is not decorative hero content, but explicit scope context and a calm branded surface system.

### Color world

Use a blue-led system inspired by the product brand:

- control-room blue
- slate panel surfaces
- cool white content fields
- quiet cyan-blue interactive accents
- dark steel for dark mode surfaces

### Theme strategy

Replace the current stock stylesheet setup with the Fumadocs theme import pattern and custom `--color-fd-*` tokens.

The theme should:

- keep neutral structure dominant
- use blue as the identity signal
- give active states more clarity than stock gray treatments
- maintain good contrast in both light and dark themes
- slightly widen the layout using `--fd-layout-width`

### Surface and depth model

Use calm layered surfaces:

- background: soft cool neutral
- cards and popovers: slightly lifted blue-gray surfaces
- active states: blue-tinted accent treatments
- borders: subtle and low-contrast, never harsh

### Scope accents

Use subtle scope accents to reinforce orientation:

- `Product`: brand blue
- `Desktop`: cooler steel-indigo tint
- `Technical`: deeper blue-slate tint

These accents should appear in active tabs, badges, or section cues, not as heavy per-page theming.

## File-Level Plan

### Core shell files

- `apps/docs/src/app/docs/layout.tsx`
  - move from `sidebar.tabs` decoration to layout-level `tabs`
  - configure clearer `nav`
  - tune sidebar defaults and scoped behavior

- `apps/docs/src/app/layout.tsx`
  - keep `RootProvider`
  - make only the minimal changes needed to support the upgraded theme shell

- `apps/docs/src/app/globals.css`
  - replace the current import-only setup with theme imports plus custom tokens and shell styling

- `apps/docs/src/app/page.tsx`
  - keep the root redirect from `/` to `/docs`

- `apps/docs/src/app/docs/[[...slug]]/page.tsx`
  - replace the current `/docs` redirect behavior with a real overview page when no slug is selected

### Content metadata

- `apps/docs/content/docs/meta.json`
  - keep the three root areas in the order `guide`, `desktop`, `tech`

- `apps/docs/content/docs/guide/meta.json`
  - rename the displayed root title to `Product`

- `apps/docs/content/docs/desktop/meta.json`
  - keep `Desktop` and align the description with the new scoped shell language

- `apps/docs/content/docs/tech/meta.json`
  - rename the displayed root title to `Technical`

### Optional additions

Do not add new shared helpers by default. Add a lightweight presentational component only if the `/docs` overview page becomes materially clearer from extraction.

## Verification

### Required outcomes

- The layout tabs appear as the intended Fumadocs scope switch for `Product`, `Desktop`, and `Technical`.
- `/docs` renders a clear overview page.
- The visible sidebar matches the active scope.
- Light and dark themes both preserve contrast and orientation.
- Mobile header and scope switching remain usable.

### Verification steps

- run `pnpm build` in `apps/docs`
- confirm `/docs` overview renders
- confirm the top-level tab dropdown shows `Product`, `Desktop`, and `Technical`
- confirm switching tabs changes the visible navigation tree
- spot-check desktop and mobile shell behavior

## Risks And Constraints

- The redesign should stay close to Fumadocs conventions so future upgrades are low-risk.
- Styling should remain token-driven in `globals.css`, not fragmented across many ad hoc overrides.
- Scope clarity must improve without creating duplicate navigation concepts that compete with the page tree.
- The docs app should not become visually louder than the main Z8 product.

## Open Decision Resolved In Brainstorming

- top-level scoping: `Product / Desktop / Technical`
- `/docs` behavior: real overview page
- theme intensity: moderately custom, not near-default and not aggressively stylized
