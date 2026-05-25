# Organization Logo Handling Design

## Goal

Make organization logos work reliably with public S3 URLs, store new organization-logo uploads under immutable per-organization keys, and let owners clear the current organization logo from settings without deleting S3 objects.

## Scope

- Replace `next/image` usage for organization logos in the main sidebar with plain image rendering.
- Add a reusable `OrganizationLogo` component for organization logo display and fallback behavior.
- Change processed `org-logo` uploads from `org-logos/{orgId}-{timestamp}.webp` to `org-logos/{orgId}/{nanoid}.webp`.
- Add a remove-logo control to `/settings/organizations` that clears the organization `logo` database value.
- Do not delete old S3 logo objects automatically. Old objects are intentionally left in place for manual cleanup.

## Architecture

`OrganizationLogo` will live in `apps/webapp/src/components/organization/organization-logo.tsx`. It will be a small client component that wraps the existing avatar primitives, renders the uploaded logo through the primitive's underlying plain image element, and falls back to the building icon when no logo URL is present or the image cannot load. Callers pass `logo`, `name`, `size`, and optional `className` values.

The sidebar organization switcher will stop importing `next/image` and use `OrganizationLogo` for both the active organization and dropdown organization rows. The organization settings details card will also use `OrganizationLogo`, preserving the existing upload overlay and camera button behavior.

Upload processing will add a focused `createOrganizationLogoStorageKey(organizationId, id = nanoid())` helper. The existing process route will call it for `uploadType === "org-logo"`, while keeping avatar, branding logo, and branding background behavior unchanged.

## Data Flow

1. Owner uploads a logo in `/settings/organizations`.
2. `useImageUpload` processes the upload as `org-logo`.
3. The process route validates ownership, optimizes the image, writes it to `org-logos/{orgId}/{nanoid}.webp`, and updates Better Auth organization `logo` with the public URL.
4. The settings card updates local `logoUrl`; the sidebar sees the new org logo after cache invalidation or refresh.
5. Owner clicks the remove-logo button in settings.
6. A server action validates owner permissions and updates Better Auth organization `logo` to `null`.
7. The settings card updates local `logoUrl` to `null`; S3 objects are not touched.

## Permissions And Safety

Only organization owners can upload or clear organization logos. Existing owner checks in the upload process remain in place. The new clear-logo action will reuse the same organization owner authorization pattern as `updateOrganizationDetails`.

## UI Behavior

The organization settings logo area keeps the current upload affordance. When a logo exists and the owner is not uploading, a trash/remove button appears on the logo. The trash icon uses white foreground color. Removing the logo shows success and error toasts consistent with the profile picture removal pattern.

## Testing

- Unit test the storage-key helper to verify `org-logos/{orgId}/{id}.webp` output.
- Update the upload process test to expect the new nested organization-logo key shape.
- Add tests for `OrganizationLogo` fallback and image rendering.
- Add a component test for the organization details card remove-logo button, mocking the server action and asserting the local logo is cleared.

## Non-Goals

- No automatic deletion of previous organization-logo S3 objects.
- No migration of existing logo URLs.
- No changes to branding login-page logo/background storage.
