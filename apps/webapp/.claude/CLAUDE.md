# Better Auth Schema Instructions

## CRITICAL: Do NOT Manually Edit auth-schema.ts

The file `src/db/auth-schema.ts` is **auto-generated** by Better Auth CLI and will be overwritten on every:
- Better Auth package update
- Running `pnpm dlx @better-auth/cli generate`
- Running `pnpm dlx @better-auth/cli migrate`

**Never manually add, modify, or remove fields from this file.**

---

## How to Add Custom Fields

### For User/Session tables

Add `additionalFields` in `src/lib/auth.ts`:

```typescript
export const auth = betterAuth({
  user: {
    additionalFields: {
      myCustomField: {
        type: "string",
        required: false,
        defaultValue: "default",
        input: false, // false = system-managed, true = user can provide
      },
    },
  },
  session: {
    additionalFields: {
      // session custom fields here
    },
  },
});
```

### For Organization/Invitation/Member tables

Add `schema.additionalFields` to the organization plugin:

```typescript
organization({
  schema: {
    organization: {
      additionalFields: {
        country: { type: "string", required: false, input: true },
      },
    },
    invitation: {
      additionalFields: {
        canCreateOrganizations: { type: "boolean", required: false, defaultValue: false },
      },
    },
  },
});
```

---

## After Adding/Changing Fields

1. Run CLI to regenerate schema (use `--output` to specify location):
   ```bash
   pnpm dlx @better-auth/cli generate -y --output src/db/auth-schema.ts
   ```

2. Add FK constraint and indexes to ssoProvider (CLI doesn't generate these):
   - Add `organizationId` FK reference to `organization.id`
   - Add indexes for `organizationId` and `domain`
   - Add `organization` relation to `ssoProviderRelations`

3. Push schema to database:
   ```bash
   pnpm drizzle-kit push
   ```

---

## What's Provided by Better Auth Plugins

These fields are automatically included when their plugins are enabled - do NOT add them manually:

| Plugin | Fields Provided |
|--------|-----------------|
| **Core** | `id`, `name`, `email`, `emailVerified`, `image`, `createdAt`, `updatedAt` (user); `ipAddress`, `userAgent` (session) |
| **Admin** | `role`, `banned`, `banReason`, `banExpires` (user); `impersonatedBy` (session) |
| **TwoFactor** | `twoFactorEnabled` (user) |
| **Organization** | `activeOrganizationId` (session); organization, member, invitation tables |
| **SSO** | `ssoProvider` table with `domainVerified` flag (verification token is returned via API, not stored in DB) |

---

## Current Custom Fields (defined in auth.ts)

### User table
- `canCreateOrganizations` - Permission to create organizations
- `invitedVia` - Tracks which invitation was used
- `onboardingComplete` - Onboarding completion status
- `onboardingStep` - Current onboarding step
- `onboardingStartedAt` - When onboarding started
- `onboardingCompletedAt` - When onboarding finished
- `timezone` - User's timezone preference (e.g., "UTC", "America/New_York")

### Organization table
- `country` - ISO 3166-1 alpha-2 country code (e.g., "DE", "US")
- `region` - ISO 3166-2 subdivision code (e.g., "BY" for Bavaria)

### Invitation table
- `canCreateOrganizations` - Permission grant during invitation

---

## Type Inference

The auth-client.ts uses `inferAdditionalFields` and `inferOrgAdditionalFields` to automatically infer types for custom fields. This ensures TypeScript knows about all custom fields when using `useSession`, `signUp`, organization methods, etc.

```typescript
import { inferAdditionalFields, inferOrgAdditionalFields } from "better-auth/client/plugins";
import type { auth } from "./auth";

export const authClient = createAuthClient({
  plugins: [
    inferAdditionalFields<typeof auth>(),
    organizationClient({
      schema: inferOrgAdditionalFields<typeof auth>(),
    }),
  ],
});
```

---

# Development Commands

## Package Manager

This project uses **pnpm** as the package manager. Do not use bun for running scripts.

## Dev Server

```bash
pnpm dev
```

## Testing

Tests use **vitest**. Run tests with:

```bash
pnpm test           # Run all tests once
pnpm test:watch     # Run tests in watch mode
pnpm test:coverage  # Run tests with coverage
```

## Database

```bash
pnpm drizzle-kit push    # Push schema changes to database
pnpm db:seed             # Seed the database
```

## Build

```bash
pnpm build    # Build for production
pnpm start    # Start production server
```

---

# Form Library: @tanstack/react-form

For new features requiring forms, use `@tanstack/react-form` instead of `react-hook-form`.

## Why TanStack Form?

- **SSR compatible** - Serializable state, no proxy magic
- **React compiler ready** - Works with React's upcoming compiler
- **Granular re-renders** - Signals-like patterns for performance
- **Native Zod integration** - Standard Schema support (Zod 3.24+)

## Basic Usage

```typescript
import { useForm } from '@tanstack/react-form'

// Define default values with explicit types
const defaultValues = {
  name: '',
  email: '',
  role: undefined as 'admin' | 'user' | undefined,
}

function MyForm() {
  const form = useForm({
    defaultValues,
    onSubmit: async ({ value }) => {
      // Handle form submission
      console.log(value)
    },
  })

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        form.handleSubmit()
      }}
    >
      <form.Field name="name">
        {(field) => (
          <input
            value={field.state.value}
            onChange={(e) => field.handleChange(e.target.value)}
            onBlur={field.handleBlur}
          />
        )}
      </form.Field>

      {/* Dirty state detection for submit button */}
      <form.Subscribe selector={(state) => [state.isDirty, state.isSubmitting]}>
        {([isDirty, isSubmitting]) => (
          <button type="submit" disabled={!isDirty || isSubmitting}>
            Save Changes
          </button>
        )}
      </form.Subscribe>
    </form>
  )
}
```

## Form UI Components

Use components from `src/components/ui/tanstack-form.tsx`:

- `TFormItem` - Wrapper with ID context for accessibility
- `TFormLabel` - Label with error state styling
- `TFormControl` - Input wrapper with aria attributes
- `TFormDescription` - Help text
- `TFormMessage` - Error display
- `fieldHasError` - Helper to check field errors

## Key Differences from react-hook-form

| react-hook-form | @tanstack/react-form |
|-----------------|----------------------|
| `useForm({ resolver: zodResolver(schema) })` | `useForm({ defaultValues })` |
| `<Controller render={({ field }) => ...} />` | `<form.Field children={(field) => ...} />` |
| `field.value` | `field.state.value` |
| `field.onChange(e)` | `field.handleChange(e.target.value)` |
| `form.formState.isDirty` | `<form.Subscribe selector={s => s.isDirty}>` |

## Migration Status

### Migrated to @tanstack/react-form
- `src/app/[locale]/(app)/settings/employees/[employeeId]/page.tsx`

### Pending Migration (use @tanstack/react-form for new work)
- Export feature forms (`src/components/settings/export/`)
- Break-rule feature (new feature to be implemented)
- Other forms as they need updates
