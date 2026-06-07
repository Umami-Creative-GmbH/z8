# Radix to Base UI Migration Design

## Context

The webapp currently depends on many Radix packages in `apps/webapp/package.json` and imports them almost exclusively through the shared UI wrapper layer in `apps/webapp/src/components/ui`. Product screens generally import Z8 wrappers such as `@/components/ui/dialog`, `@/components/ui/select`, and `@/components/ui/dropdown-menu` rather than importing Radix directly.

Base UI is available as the single tree-shakable `@base-ui/react` package. Its components are unstyled and align with the current Tailwind/shadcn-style wrapper approach, but its composition, data attributes, and CSS variables differ from Radix.

## Goal

Remove Radix from the webapp if Base UI can cover every existing wrapper.

The target end state is:

- `apps/webapp` depends on `@base-ui/react` instead of `@radix-ui/react-*` and `radix-ui`.
- `apps/webapp/src` has no `@radix-ui` imports.
- Existing product code keeps importing Z8 UI wrappers from `@/components/ui/*`.
- Existing UI behavior, accessibility expectations, styling, light/dark theme support, and mobile behavior are preserved.

## Non-Goals

- Do not redesign the product UI.
- Do not rewrite product screens unless wrapper compatibility cannot preserve an existing usage.
- Do not migrate unrelated forms, data fetching, authorization, or timekeeping logic.
- Do not remove historical docs that mention Radix unless they are active implementation docs for this migration.

## Approach

Use a staged wrapper-first migration.

The UI wrapper layer is the migration boundary. Each Radix-backed wrapper should be converted to Base UI while preserving its exported names and common props where practical. This avoids changing hundreds of product call sites at once and gives each primitive a focused verification path.

## Base UI Differences To Handle

Base UI uses `render` for composition where Radix wrappers commonly expose `asChild`. Z8 wrappers should preserve their public `asChild` ergonomics where they are widely used, translating internally to Base UI `render` or to a small local non-Radix slot helper for simple non-Base components.

Base UI state styling uses attributes such as `data-popup-open`, `data-highlighted`, `data-checked`, `data-unchecked`, `data-starting-style`, and `data-ending-style`. Existing Radix-oriented selectors such as `data-[state=open]`, `data-[state=closed]`, `data-[state=checked]`, and `focus:`-based menu item styling must be converted where the underlying component changes.

Base UI CSS variables differ from Radix variables. Current usages like `--radix-accordion-content-height`, `--radix-collapsible-content-height`, `--radix-select-trigger-width`, and `--radix-dropdown-menu-content-transform-origin` must move to their Base UI equivalents such as `--accordion-panel-height`, `--collapsible-panel-height`, `--anchor-width`, `--available-height`, `--transform-origin`, and component-specific popup variables.

Base UI portals should render above the app shell. The app layout should provide the recommended stacking isolation and global body positioning where needed for portaled backdrops.

## Migration Phases

### Phase 1: Dependency And Compatibility Scaffold

- Add `@base-ui/react` to `apps/webapp`.
- Add a local composition helper only if needed to replace simple `@radix-ui/react-slot` usage in non-Base wrappers.
- Establish shared helper patterns for translating `asChild` to Base UI `render`.
- Keep Radix dependencies temporarily during conversion.

### Phase 2: Simple Wrappers

Migrate wrappers with minimal behavior first:

- `separator`
- `aspect-ratio`
- `progress`
- `avatar`
- `label`

These provide early confidence in import patterns and type compatibility.

### Phase 3: Form And Control Wrappers

Migrate interactive controls:

- `checkbox`
- `radio-group`
- `switch`
- `slider`
- `toggle`
- `toggle-group`
- `tabs`

Preserve controlled and uncontrolled props used by product code. Pay close attention to form integration, hidden inputs, accessible names, disabled states, and test assertions that depend on DOM roles or state attributes.

### Phase 4: Disclosure Wrappers

Migrate:

- `accordion`
- `collapsible`

Update global animation CSS from Radix variables to Base UI variables. Preserve opening and closing animations and reduced-motion behavior.

### Phase 5: Overlay Wrappers

Migrate:

- `dialog`
- `alert-dialog`
- `popover`
- `hover-card`
- `tooltip`

Preserve portal behavior, focus management, accessible title/description patterns, close buttons, side offsets, collision behavior, and mobile/touch expectations. Tooltips must remain supplementary only, with accessible trigger labels where used.

### Phase 6: Sheet Strategy

Current `sheet` is a side-positioned Radix Dialog wrapper. Base UI offers both Dialog and Drawer.

Default strategy: implement `Sheet` with Base UI Dialog to preserve current no-gesture side-panel behavior and minimize behavioral change.

Use Base UI Drawer only for a future enhancement where swipe dismissal, snap points, or drawer indentation is explicitly required.

### Phase 7: Menu And Select Wrappers

Migrate the highest-risk primitives last:

- `dropdown-menu`
- `context-menu`
- `menubar`
- `navigation-menu`
- `select`

These wrappers need careful mapping of item highlighting, checkbox and radio indicators, submenu behavior, scroll arrows, collision positioning, and keyboard navigation. Styling should move from Radix `focus:`/`data-state` hooks to Base UI `data-highlighted`, `data-popup-open`, `data-starting-style`, and `data-ending-style` hooks.

### Phase 8: Slot-Dependent Non-Primitive Wrappers

Remove remaining `@radix-ui/react-slot` usage from:

- `button`
- `badge`
- `breadcrumb`
- `button-group`
- `item`
- `sidebar`
- `tanstack-form`

Where these wrappers render links or custom elements, avoid applying button semantics to links unless the existing wrapper already does so and changing it would be a product behavior change.

### Phase 9: Dependency Removal

- Remove all `@radix-ui/react-*` and `radix-ui` dependencies from `apps/webapp/package.json`.
- Update the lockfile with pnpm.
- Regenerate `apps/webapp/src/data/licenses.json` if dependency/license data is committed in this repo.
- Confirm no active source import of `@radix-ui` remains.

## Verification

Run verification incrementally after meaningful wrapper groups and fully at the end.

Required checks:

- `rg '@radix-ui' apps/webapp/src apps/webapp/package.json`
- `pnpm --filter webapp test`
- `CI=true pnpm --filter webapp build`

Focused manual or test coverage should include:

- Dialogs and alert dialogs open, close, trap focus, restore focus, and expose titles/descriptions.
- Sheets render correctly from every side on desktop and mobile.
- Dropdown menu, context menu, menubar, and navigation menu keyboard behavior still works.
- Select opens, highlights, selects values, handles placeholders, and remains labeled.
- Tooltip triggers have accessible names and tooltips remain non-critical visual aids.
- Checkbox, radio, switch, slider, tabs, accordion, and collapsible controlled/uncontrolled states still work.
- Existing `data-slot` attributes remain available where tests and styling use them.
- Light and dark themes preserve current visual language.

## Risks

The biggest risk is assuming Base UI props are Radix-compatible. The wrapper exports can remain stable, but implementation details need explicit mapping.

The second risk is CSS state drift. Many current classes are Radix-state-specific and will silently stop applying if not converted.

The third risk is composition drift around `asChild`. Some Base UI parts support `render`, but simple wrappers such as `Button` need a non-Radix approach that does not introduce invalid link/button semantics.

The fourth risk is overlay behavior. Portals, focus handling, scroll locking, stacking, and mobile backdrops must be checked rather than assumed.

## Success Criteria

- No active source imports from `@radix-ui` remain.
- Radix dependencies are removed from `apps/webapp/package.json`.
- Webapp tests and build pass.
- UI wrappers preserve their existing exported component names.
- Product screens do not require broad import rewrites.
- Core overlay, menu, select, form-control, and disclosure interactions behave correctly on desktop and mobile.
