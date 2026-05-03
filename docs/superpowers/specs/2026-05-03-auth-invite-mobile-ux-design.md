# Auth And Invite Mobile UX Design

## Context

The localized auth route group lives under `apps/webapp/src/app/[locale]/(auth)`. The shared auth layout already resolves request-scoped domain auth configuration, cookie consent script injection, theme controls, language controls, and footer rendering. The recent auth layout redesign introduced a desktop split layout with a decorative image panel and a mobile single-column auth shell.

Invite functionality spans two contexts:

- Public/auth invite redemption through `apps/webapp/src/app/[locale]/(auth)/join/[code]/page.tsx` and `apps/webapp/src/components/join-organization-form.tsx`.
- Organization settings invite management through `apps/webapp/src/components/organization/invite-code-management.tsx`, `invite-code-dialog.tsx`, `invite-code-qr-dialog.tsx`, and `invite-member-dialog.tsx`.

The current invite management table is too dense for narrow viewports. The join-code form and invite creation panels also contain side-by-side controls and dense helper text that can feel squeezed on mobile.

## Scope

Apply a full invite flow UX redesign with mobile as a first-class target, while preserving existing behavior and permissions.

In scope:

- Improve auth route mobile layout where it affects auth and invite comfort.
- Redesign invite code management for responsive desktop and mobile use.
- Redesign the invite code create/edit action panel for clearer mobile form flow.
- Redesign the QR code action panel to avoid squeezed URLs and oversized fixed content on mobile.
- Improve the public join-code route states for mobile readability and action clarity.
- Keep the existing desktop operational density where it works well.

Out of scope:

- Changing auth routes, redirects, social login, passkey login, 2FA, Turnstile, callback URL handling, or onboarding redirects.
- Changing invite code validation, redemption, generation, QR generation, delete behavior, or server action contracts.
- Changing organization scoping, role checks, RBAC, or data access rules.
- Adding new organization-specific settings or environment variables.

## Recommended Approach

Use a responsive redesign that keeps existing components and server actions, but changes presentation and layout around them. This gives the invite flow a substantially better mobile experience without rewriting the invite system.

Alternatives considered:

- A targeted polish pass would fix the immediate squeezing issues faster, but would leave the invite management model table-first and less suitable for mobile.
- A full route and component architecture rewrite would allow cleaner composition, but it is unnecessarily risky because the current actions and state flows already work.

## Design Direction

The visual stance is operational clarity with restrained blue product polish. The interface should feel like a reliable workforce operations tool: calm hierarchy, readable status signals, generous touch targets, and no decorative excess.

DFII score: 12/15.

- Aesthetic impact: 3. Stronger mobile invite cards and access-token styling create a recognizable product pattern without overdesigning.
- Context fit: 5. Dense invite administration benefits from structured, compliance-friendly clarity.
- Implementation feasibility: 4. Existing table, card, badge, button, action panel, and form controls are enough.
- Performance safety: 5. CSS responsive rendering and existing components avoid heavy client behavior.
- Consistency risk: 5. Dual table/card rendering adds some maintenance risk, but the shared data remains simple.

Differentiation anchor: invite codes should read as managed access tokens on mobile, not compressed table rows. Each mobile card should make the code visually prominent, show status and approval state clearly, and keep copy/QR actions easy to reach.

## Auth Route Layout

The auth shell should keep the desktop split image layout, but mobile should behave as a forgiving document layout rather than a cramped fixed-height viewport.

Changes:

- Prefer `min-h-svh` and natural document scrolling on mobile instead of forcing the left panel to `h-svh` with its own scroll container.
- Keep the theme and language controls visible, but reduce their vertical footprint on small screens.
- Let auth content use the full available mobile width with safe side padding.
- Keep the `InfoFooter` below content without creating a competing fixed footer feel.
- Preserve the desktop image aside and existing `DomainAuthProvider` behavior.

## Auth Form Wrapper

`AuthFormWrapper` should remain the shared wrapper for login, reset, sign-up, and join-code forms. It should receive small responsive polish only.

Changes:

- Reduce the visual weight of the card on the smallest screens by using less shadow and tighter-but-comfortable padding.
- Keep the card treatment on `sm` and larger screens.
- Preserve organization branding logo/name support and custom primary color variables.
- Do not change form submission behavior.

## Join-Code Flow

The join-code page should be invitation-first and readable on narrow screens.

Changes:

- Stack the invite code input and validate button on mobile, switching to inline layout from `sm` upward.
- Make the code input monospace or strongly code-like enough to support accurate entry.
- Keep primary action full-width.
- Present valid organization state as a clear confirmation block with the organization name and next action.
- Present invalid/error, pending approval, success, and already-member states with consistent spacing, full mobile width, and readable status icons.
- Preserve unauthenticated redirect behavior to sign-in with callback URL.

## Invite Code Management

Invite code management should use different layouts for different viewports.

Desktop:

- Keep the table because it supports scanability and operational density.
- Preserve existing columns: code, label, status, usage, expires, approval, and actions.
- Improve action grouping so copy URL and QR are recognizable primary quick actions.

Mobile:

- Hide the table and render a stacked card list.
- Each card includes code, label, optional description, status, usage, expiration, approval mode, and actions.
- The code should be visually prominent as an access token with a nearby copy-code action.
- Copy invite URL and QR should be visible as primary actions.
- Edit and delete should remain in overflow to avoid crowding.
- Empty and loading states should align with the card layout and avoid excess vertical compression.

The component can duplicate a small amount of markup between desktop rows and mobile cards if that keeps the change straightforward. Avoid introducing a broad invite management abstraction unless repeated logic becomes hard to read.

## Invite Code Create/Edit Panel

The create/edit panel should remain an `ActionPanel`, but the content should be grouped and spaced for mobile.

Changes:

- Use a task-oriented form structure: code identity, usage rules, assignment, and approval/status.
- Stack code input and generate button below `sm`; keep them inline from `sm` upward.
- Keep helper text close to fields but avoid negative margins that tighten mobile spacing.
- Ensure `ActionPanelFooter` actions stack full-width on mobile and align right on larger screens.
- Keep the existing generated-code query, draft state, create mutation, and update mutation behavior.
- Do not migrate this form to a different form library as part of this UX pass.

## Invite Member Panel

The invite member panel should receive matching mobile polish so invite experiences feel consistent.

Changes:

- Keep the existing email, role, and owner-only organization creation fields.
- Improve body spacing and footer stacking on mobile through shared `ActionPanel` behavior where possible.
- Preserve current mutation, refresh, and query invalidation behavior.

## QR Code Panel

The QR panel should avoid squeezing long URLs and fixed-size QR content on mobile.

Changes:

- Let the displayed join URL wrap or break safely instead of relying only on truncation.
- Constrain QR previews with responsive sizing so they fit within narrow panels.
- Keep PNG/SVG tabs and download behavior unchanged.
- Keep reset-on-close behavior unchanged.

## Action Panel Shared Behavior

The shared `ActionPanel` component can be improved if it benefits all invite panels without harming other settings panels.

Changes:

- Keep right-side sheet behavior on desktop.
- Use nearly full-width mobile panels with safe margins.
- Stack footer buttons full-width on mobile, switching to horizontal alignment on `sm` and larger screens.
- Keep body scrolling inside the panel so long forms remain usable.

If shared changes appear too broad during implementation, apply local class overrides in invite components instead.

## Data Flow

No data flow changes are planned.

Existing client queries continue to load invite codes, teams, generated codes, and invite base URLs. Existing mutations continue to create, update, delete, redeem, and generate QR codes. Existing server actions continue enforcing organization scoping and permissions.

## Error Handling

Existing toast errors, validation errors, invalid code messages, pending approval states, and destructive delete confirmation stay intact.

The redesign must ensure error and status messages do not get clipped, overlap footers, or require horizontal scrolling on mobile.

## Accessibility And Responsiveness

The redesigned invite flow must preserve keyboard navigation, labels, focus states, and screen reader names. Buttons that are icon-only must keep meaningful `aria-label` values. Mobile touch targets should be comfortable, especially copy, QR, overflow, and submit actions.

Responsive behavior should avoid horizontal scrolling at narrow widths. Long translated text, invite URLs, organization names, labels, and descriptions should wrap or truncate intentionally depending on context.

## Verification

Verification should cover:

- Auth shell renders cleanly on mobile and desktop.
- Sign-in still renders core auth methods and 2FA state without behavior changes.
- Join-code route renders manual code entry and code-from-URL states on mobile.
- Join-code success, pending approval, invalid/error, and already-member states remain readable.
- Invite code management table renders on desktop.
- Invite code mobile cards render without horizontal squeeze.
- Copy code, copy URL, QR open, edit, and delete actions remain reachable.
- Create/edit invite code panel is usable on mobile and desktop.
- Invite member panel footer actions are usable on mobile.
- QR code panel fits mobile width and download behavior remains available.

Run focused webapp validation for changed components and broader checks if practical in the local environment.
