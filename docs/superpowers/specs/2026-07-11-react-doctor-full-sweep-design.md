# React Doctor Full Sweep Design

## Scope

Resolve the 41 diagnostics in the supplied full React Doctor report on `dev`.
The report contains 12 rule groups: no-giant-component (19), no-locale-format-in-render (10), no-derived-state (2), prefer-useReducer (2), and eight single-site groups. The calendar date-reset effect is one root cause reported by both `no-derived-state` and `set-state-in-effect`.

## Delivery

Apply fixes directly on `dev`. Commit each independently validated rule group. Do not stage, revert, or modify unrelated concurrent changes.

## Refactoring Boundaries

- Confirm every diagnostic against the canonical rule validation prompt before editing. Do not suppress rules or edit the false-positive list.
- Split oversized components only at coherent responsibility boundaries: headers, content sections, dialogs, navigation sections, and focused hooks. Keep behavior and public component APIs unchanged unless a rule requires an API change.
- Replace `AppSidebar` feature-toggle booleans with an explicit navigation capabilities input, updating callers and focused tests.
- Remove state that is entirely calculated from props or other state during an effect. Keep state that represents data loaded asynchronously from the server.
- Apply the canonical mechanical remedies for the remaining rules, minimizing changes and preserving organization scoping, authorization, and explicit time zones.

## Testing And Validation

For each behavior-affecting change, create or adapt a focused test first and observe the intended failure before implementation. Run the relevant test file, webapp typecheck, and the appropriate React Doctor scan before the corresponding commit.

After the full sweep, run `npx react-doctor@latest --verbose` from `apps/webapp`, inspect the real remaining diagnostics, and run the project-level validation commands supported by the repository.

## User Impact

These warnings are predominantly maintainability and render-efficiency work. They are not known production crashes. The one calendar state effect causes an unnecessary additional render when initial date inputs change; the remaining fixes reduce future regression risk by making component responsibilities, navigation configuration, effects, and query updates explicit.
