# Auth Glass Info Links Design

## Goal

Refresh the localized auth experience to match the provided full-background, glass-card reference while moving legal/trust links to the external marketing site and keeping only open-source licenses inside the webapp.

## Approved Design

The `(auth)` route layout uses the existing auth image as a full-viewport `object-cover` background instead of a split-screen image panel. Theme and language controls stay in the top-right above the image. The footer stays bottom-centered and links to external legal/trust pages on `https://www.z8-time.app`, with `/licenses` remaining local.

The auth form card uses a translucent glass surface: `bg-white/20`, `dark:bg-slate-950/45`, and Tailwind's default `backdrop-blur-md`, which maps to 12px. The build version moves out of the global footer and into the card, positioned at the bottom-right with `right: 12px` and `bottom: 6px`.

Internal `/terms` and `/privacy` pages are removed because the target site owns those documents. The webapp footer links use `https://www.z8-time.app/terms-app`, `https://www.z8-time.app/privacy-app`, `https://www.z8-time.app/imprint`, `https://www.z8-time.app/agb`, and `https://www.z8-time.app/trustcenter`.

The `/licenses` page remains internal and adopts the same glass-panel visual language. Its table gets a reliable bounded scroll region so long license reports scroll inside the card without causing the page layout to overflow.

## Scope

- Modify `apps/webapp/src/app/[locale]/(auth)/layout.tsx`.
- Modify `apps/webapp/src/components/auth-form-wrapper.tsx` and its tests.
- Modify `apps/webapp/src/components/info-footer.tsx`.
- Delete `apps/webapp/src/app/[locale]/(auth)/terms/page.tsx`.
- Delete `apps/webapp/src/app/[locale]/(auth)/privacy/page.tsx`.
- Modify `apps/webapp/src/app/[locale]/(auth)/licenses/page.tsx`.
- Modify `apps/webapp/src/components/licenses/license-table.tsx` if needed for scroll behavior.

## Testing

Update component tests for auth card version placement and footer links. Run targeted Vitest coverage for touched components, then run lint or type checks if available for the webapp package.
