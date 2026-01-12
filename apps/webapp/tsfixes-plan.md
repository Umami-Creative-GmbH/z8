# TypeScript Fixes Plan

## Completed Today

### Server Action Files
- [x] `work-schedules/actions.ts` - Added null guard for `data.days` insert
- [x] `work-schedules/assignment-actions.ts` - Added `return` before `yield*` for type narrowing, `emp!` assertions

### API Routes
- [x] `api/admin/holidays/import/route.ts` - Zod 4: `.errors` → `.issues`
- [x] `api/analytics/export/route.ts` - Buffer type: `new Uint8Array(buffer)`
- [x] `api/upload/process/route.ts` - Added null check for S3 byte array

### Components
- [x] `app-sidebar.tsx` - `image ?? undefined` (null to undefined)
- [x] `forgot-password-form.tsx` - Zod 4: `.errors` → `.issues`
- [x] `login-form.tsx` - Zod 4 fix + `as any` for Better Auth SSO API
- [x] `managed-employees-widget.tsx` - Fixed ServerActionResult pattern
- [x] `time-correction-approvals-table.tsx` - `(approval as any).reason`
- [x] `team-calendar-widget.tsx` - Fixed `isSameDay` + Day component props
- [x] `create-organization-dialog.tsx` - Removed `validatorAdapter`

---

## Remaining Tasks

### Priority 1: Form Error Display Pattern
These files show `StandardSchemaV1Issue` not assignable to `ReactNode`. Fix by extracting the message:

```tsx
// Before
{field.state.meta.errors[0]}

// After
{typeof field.state.meta.errors[0] === 'string'
  ? field.state.meta.errors[0]
  : (field.state.meta.errors[0] as any)?.message || 'Invalid'}
```

Files:
- [ ] `create-organization-dialog.tsx` (lines 182, 229)
- [ ] `onboarding/holiday-setup/page.tsx`
- [ ] `onboarding/organization/page.tsx`
- [ ] `onboarding/profile/page.tsx`
- [ ] `onboarding/vacation-policy/page.tsx`
- [ ] `onboarding/work-schedule/page.tsx`
- [ ] `onboarding/work-templates/page.tsx`
- [ ] `onboarding/notifications/page.tsx`

### Priority 2: Remove validatorAdapter from Forms
Remove `validatorAdapter: zodValidator()` and the import from these files:

- [ ] `onboarding/holiday-setup/page.tsx`
- [ ] `onboarding/organization/page.tsx`
- [ ] `onboarding/profile/page.tsx`
- [ ] `onboarding/vacation-policy/page.tsx`
- [ ] `onboarding/work-schedule/page.tsx`
- [ ] `onboarding/work-templates/page.tsx`
- [ ] `onboarding/notifications/page.tsx`

### Priority 3: Circular Type References
Fix `team` variable name conflicting with schema import:

```tsx
// Before
import type { team } from "@/db/schema";
onSuccess?: (team: typeof team.$inferSelect) => void;

// After - rename parameter
onSuccess?: (createdTeam: typeof team.$inferSelect) => void;
```

Files:
- [ ] `create-team-dialog.tsx` (line 26)
- [ ] `edit-team-dialog.tsx` (line 26)
- [ ] `teams-tab.tsx` (lines 97, 103, 114)

### Priority 4: ServerActionResult Error Pattern
Fix accessing `.error` without checking `!result.success` first:

```tsx
// Before
if (result.error) { toast.error(result.error); }

// After
if (!result.success) { toast.error(result.error); }
```

Files:
- [ ] `create-team-dialog.tsx` (line 50)
- [ ] `edit-team-dialog.tsx` (line 54)
- [ ] `project-reports-container.tsx` (lines 54, 58, 91, 97)
- [ ] `onboarding/work-schedule/page.tsx` (lines 51, 67)

### Priority 5: Members Table Issues
File: `members-table.tsx`

- [ ] Line 183: `boolean | null` → `boolean | undefined` (use `?? undefined`)
- [ ] Lines 317, 324: Function call expects 1 argument but got 2
- [ ] Lines 337, 339: Comparison between function and string (likely missing `()` call)

### Priority 6: Team Members Dialog
File: `team-members-dialog.tsx`

- [ ] Line 136: `string | undefined` not assignable to `string` (add fallback or assertion)
- [ ] Line 215: Same issue with argument

### Priority 7: Other Component Issues

- [ ] `project-team-breakdown.tsx` (line 146): `percent` possibly undefined - add null check
- [ ] `shift-scheduler.tsx` (line 265): Calendar event `start` type mismatch (string vs PlainDate/ZonedDateTime)
- [ ] `notification-settings.tsx` (line 106): Missing notification type keys - add the missing project notification types

### Priority 8: Onboarding Service Provider Issue
Multiple onboarding action files have `OnboardingService` not assignable to `never`. This requires fixing the Effect service provider chain:

Files in `onboarding/*/actions.ts`:
- [ ] `complete/actions.ts`
- [ ] `holiday-setup/actions.ts`
- [ ] `notifications/actions.ts`
- [ ] `organization/actions.ts`
- [ ] `profile/actions.ts`
- [ ] `vacation-policy/actions.ts`
- [ ] `welcome/actions.ts`
- [ ] `work-schedule/actions.ts`
- [ ] `work-templates/actions.ts`

### Skip (Per User Request)
- `layout.tsx` - Tolgee type conversion (skip for now)
- Vacation-related files (another agent handling)

---

## Common Fix Patterns Reference

### Zod 4 API Change
```tsx
// Old
validationResult.error.errors[0]?.message

// New
validationResult.error.issues[0]?.message
```

### Effect-TS Type Narrowing
```tsx
// Add return before yield* to narrow types after null checks
if (!existingRecord) {
  return yield* _(Effect.fail(new NotFoundError({...})));
}
// Now existingRecord is narrowed to non-null
```

### TanStack Form validatorAdapter Removal
```tsx
// Remove this import
import { zodValidator } from "@tanstack/zod-form-adapter";

// Remove from useForm
const form = useForm({
  defaultValues: {...},
  // validatorAdapter: zodValidator(),  // DELETE THIS LINE
  onSubmit: ...
});
```

### ServerActionResult Type
```tsx
type ServerActionResult<T> =
  | { success: true; data: T }
  | { success: false; error: string; code?: string };

// Always check success first
if (result.success) {
  // result.data is available
} else {
  // result.error is available
}
```
