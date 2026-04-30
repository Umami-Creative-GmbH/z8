# Auth Layout Redesign Design

## Context

The current localized auth route group lives under `apps/webapp/src/app/[locale]/(auth)`. Its shared layout already handles request-scoped domain auth configuration, cookie-consent script injection, theme switching, language switching, and the info footer. The login page delegates behavior to `apps/webapp/src/components/login-form.tsx`, which includes email/password login, 2FA, passkeys, social providers, Turnstile, callback URL handling, and post-login redirects.

The redesign should improve the auth route presentation without changing auth behavior.

## Scope

Apply one modern shared auth layout to every route in `(auth)`, including sign-in, sign-up, password reset, verification, 2FA, invitations, and join-code flows.

In scope:

- Replace the existing centered muted auth shell with a shadcn `login-02`-style split layout.
- Preserve all existing auth providers, request-scoped domain configuration, cookie-consent script behavior, theme controls, language controls, and footer content.
- Use a right-side Unsplash image panel on desktop and a simplified single-column layout on smaller screens.
- Make only minimal page/component adjustments where existing wrappers visually conflict with the new shell.

Out of scope:

- Rewriting login, sign-up, reset, invitation, 2FA, or verification business logic.
- Changing routes, redirects, auth providers, Turnstile behavior, social provider behavior, or callback URL handling.
- Adding new organization-specific settings or environment configuration.

## Recommended Approach

Use a shared split-shell layout in `(auth)/layout.tsx` and keep page internals largely intact. This gives all auth routes the requested modern visual treatment while minimizing risk to complex auth flows.

Alternatives considered:

- A reusable `AuthShell` with explicit title/body slots would create cleaner long-term composition, but requires touching many auth pages and increases regression risk.
- A full auth component-system rewrite would improve consistency, but is too broad for this change because the existing login form has substantial behavior.

## Layout

The auth layout will render a full-height page with two regions on medium and larger screens:

- Left panel: primary auth content, top controls, and footer.
- Right panel: decorative visual image with brand overlay.

The left panel should remain operational and restrained: a compact top bar for theme/language controls, a centered content column for child auth pages, and the `InfoFooter` below the page content. The right panel should be hidden on smaller screens so mobile users get a focused single-column auth experience.

The existing dynamic behavior in the layout remains unchanged. The layout continues to call `connection()`, read domain headers, resolve custom-domain config, create the fallback main-domain auth context, fetch the cookie-consent script, and wrap children with `DomainAuthProvider`.

## Visual Direction

Use the shadcn `login-02` template as the reference: a clean split screen, generous spacing, crisp form region, and a photographic side panel. Adapt the styling to Z8's product-first brand direction with restrained neutrals, strong readability, and a blue-tinted overlay.

The Unsplash image should be a calm modern workplace or operations-oriented scene with cool or neutral tones and no distracting face as the central focal point. It should be used through a direct `images.unsplash.com` URL with crop and sizing parameters appropriate for the panel. The image is decorative, so it should use an empty alt attribute.

## Components

The main implementation target is `apps/webapp/src/app/[locale]/(auth)/layout.tsx`.

If the image panel makes the layout hard to read, add a small local or shared component such as `AuthVisualPanel`. Keep the component focused on presentation only: image, overlay, and optional restrained brand copy. Do not move auth logic into it.

Keep `LoginForm` as the behavior owner for sign-in. Preserve its 2FA, passkey, social login, Turnstile, callback URL, onboarding redirect, and error handling behavior.

Adjust child route components only if they contain layout assumptions that conflict with the new shell, such as excessive width constraints, duplicated page backgrounds, or margins that break centering.

## Data Flow

No auth data flow changes are planned.

The route layout still resolves domain auth context on the server before rendering children. Client auth components continue using the existing domain auth context and auth client hooks. Server actions for invite and join flows stay route-scoped and unchanged unless a visual wrapper requires a minimal import or class adjustment.

## Error Handling

Existing form-level, action-level, provider-level, and Turnstile error handling remain unchanged. The redesign must not obscure error messages, field validation states, disabled states, loading indicators, or 2FA prompts.

The layout should keep enough vertical space and responsive behavior for long translated strings, provider skeletons, and error messages without clipping.

## Accessibility And Responsiveness

The redesign must preserve keyboard navigation, visible focus states, theme contrast, and localized text rendering. The decorative image should not add screen reader noise. Mobile layout should avoid horizontal scrolling and keep form controls large enough for touch use.

The theme toggle and language switcher remain available on auth routes. The layout should work in both light and dark themes.

## Verification

Verification should cover:

- Desktop split layout renders correctly.
- Mobile layout renders as a focused single-column auth page.
- Dark and light themes remain readable.
- Theme toggle, language switcher, and info footer remain visible and functional.
- Sign-in page still renders email/password, passkey, social provider, Turnstile, loading, error, and 2FA states.
- Sign-up, reset-password, forgot-password, verify-email, verify-email-pending, verify-2fa, accept-invitation, and join-code routes render inside the new shell.

Run the repo's available focused validation for the changed webapp files, plus broader checks if practical in the local environment.
