# Avatar Storage Cleanup Design

## Goal

Store temporary uploads under a clear temporary prefix, store new avatars under per-user immutable keys, and remove old Z8-hosted avatar objects when users replace or remove avatars.

## Design

- TUS temporary uploads use `.tmp/tus/{base64url(userId)}-{uuid}` in `S3_PUBLIC_BUCKET`.
- Processing APIs continue to require ownership validation before reading temporary objects.
- Client upload hooks extract the full TUS key from `/api/tus/...` URLs instead of taking only the last path segment.
- Final avatar uploads use `avatars/{session.user.id}/{nanoid}.webp` and return `{S3_PUBLIC_URL}/avatars/{userId}/{nanoid}.webp`.
- Avatar object deletion only applies to URLs owned by this deployment and user.
- Deletion supports the new `avatars/{userId}/{id}.webp` shape and the legacy `avatars/{userId}-{timestamp}.webp` shape.
- S3 delete failures are logged and do not block profile updates after Better Auth succeeds.

## Security And Data Boundaries

- The `.tmp/` prefix is an operational boundary, not a security boundary. Public serving of `.tmp/*` should be blocked by bucket/CDN policy when infrastructure is updated.
- Avatar deletion parses URLs relative to `S3_PUBLIC_URL`; arbitrary external URLs are ignored.
- User ownership is enforced by only deleting keys under the authenticated user's avatar namespace or matching that user's legacy filename prefix.

## Files

- `apps/webapp/src/lib/upload/tus-ownership.ts`: temp key shape and sanitizer.
- `apps/webapp/src/lib/upload/tus-ownership.test.ts`: ownership and traversal tests.
- `apps/webapp/src/lib/upload/tus-url.ts`: shared client helper for full key extraction.
- `apps/webapp/src/hooks/use-image-upload.ts`: use full key extraction.
- `apps/webapp/src/hooks/use-travel-expense-file-upload.ts`: use full key extraction.
- `apps/webapp/src/app/api/upload/process/route.ts`: avatar final key shape and old avatar deletion on replacement.
- `apps/webapp/src/app/[locale]/(app)/settings/profile/actions.ts`: old avatar deletion on explicit removal.

## Testing

- Unit-test TUS key ownership and traversal rejection.
- Unit-test URL-to-key extraction for nested TUS keys.
- Run focused upload tests and type/lint checks where available.
