# Auth Name Field Consolidation Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the duplicate editable `name` field from sign-up and profile, make `firstName` / `lastName` the only user-facing inputs, and keep Better Auth `user.name` as a derived compatibility field.

**Architecture:** Add account-level `firstName` and `lastName` fields to Better Auth, centralize name derivation in a shared auth helper, split profile writes into structured-details and image-only paths, and migrate the touched forms to `@tanstack/react-form`. Keep existing `session.user.name` consumers unchanged while new writes always derive that value from structured fields.

**Tech Stack:** Next.js App Router, React, TypeScript, Better Auth, Drizzle, Effect, `@tanstack/react-form`, Zod, Vitest, Testing Library

---

## File Structure

- Create: `apps/webapp/src/lib/auth/derived-user-name.ts`
  - Shared helpers for trimming first/last name values and building the compatibility `user.name` payload.
- Create: `apps/webapp/src/lib/auth/derived-user-name.test.ts`
  - Locks the shared derivation rules before signup/profile start using them.
- Create: `apps/webapp/src/lib/auth-helpers.test.ts`
  - Verifies the auth context exposes Better Auth `firstName` / `lastName` after schema generation and helper updates.
- Modify: `apps/webapp/src/lib/auth.ts`
  - Add Better Auth user additional fields for `firstName` and `lastName`.
- Modify (generated): `apps/webapp/src/db/auth-schema.ts`
  - Regenerated auth schema after Better Auth config changes.
- Modify: `apps/webapp/src/lib/auth-helpers.ts`
  - Expose auth-level `firstName` / `lastName` on `AuthContext.user` for profile fallback.
- Modify: `apps/webapp/src/lib/effect/services/auth.service.ts`
  - Extend the session user type with `firstName` / `lastName` while keeping `name` for compatibility.
- Create: `apps/webapp/src/app/[locale]/(app)/settings/profile/actions.test.ts`
  - Verifies profile write paths send structured Better Auth fields and derived `name`.
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/profile/actions.ts`
  - Split the current contract into a structured profile-details action plus an image-only action, and sync the active-org employee record on the server when it exists.
- Modify: `apps/webapp/src/lib/validations/profile.ts`
  - Replace raw editable `name` validation with structured profile schemas.
- Create: `apps/webapp/src/components/settings/profile-form.test.tsx`
  - Locks removal of the duplicate name input and verifies the new submit path.
- Modify: `apps/webapp/src/components/settings/profile-form.tsx`
  - Migrate to `@tanstack/react-form`, remove editable `name`, and wire the new actions.
- Modify: `apps/webapp/src/components/signup-form.test.tsx`
  - Update coverage for first/last name validation and Better Auth signup payload.
- Modify: `apps/webapp/src/components/signup-form.tsx`
  - Migrate to `@tanstack/react-form`, replace `name` with `firstName` / `lastName`, and send the derived Better Auth payload.

## Scope Guards

- Do not remove `session.user.name` from existing app consumers in this plan.
- Do not manually edit `apps/webapp/src/db/auth-schema.ts`; regenerate it.
- Do not change onboarding profile behavior in this plan unless a compile fix is required by shared helper/type extraction.
- Keep avatar upload/removal working without forcing the user to re-enter first/last name.
- Keep sign-up password, social auth, invite-code, and Turnstile behavior unchanged apart from the name-field swap.

## Implementation Notes Before Starting

- Follow @test-driven-development for each behavior change.
- Run commands from the repo root with `pnpm --dir apps/webapp ...`.
- Reuse the existing onboarding `@tanstack/react-form` patterns in `apps/webapp/src/app/[locale]/onboarding/profile/page.tsx` for first/last name fields.
- Keep Tolgee inline defaults in touched components.
- Before final handoff, validate touched UI code against:
  - `/vercel-react-best-practices`
  - `/web-design-guidelines`
  - `/vercel-composition-patterns`
- If the execution environment does not have usable DB env vars, stop after `pnpm --dir apps/webapp run auth:generate` and leave `pnpm --dir apps/webapp run auth:migrate` for an env-enabled session.

### Task 1: Add the shared derived-name helper and Better Auth structured fields

**Files:**
- Create: `apps/webapp/src/lib/auth/derived-user-name.test.ts`
- Create: `apps/webapp/src/lib/auth-helpers.test.ts`
- Create: `apps/webapp/src/lib/auth/derived-user-name.ts`
- Modify: `apps/webapp/src/lib/auth.ts`
- Modify: `apps/webapp/src/lib/auth-helpers.ts`
- Modify: `apps/webapp/src/lib/effect/services/auth.service.ts`
- Modify (generated): `apps/webapp/src/db/auth-schema.ts`
- Test: `apps/webapp/src/lib/auth/derived-user-name.test.ts`
- Test: `apps/webapp/src/lib/auth-helpers.test.ts`

- [ ] **Step 1: Write the failing shared-helper test**

Create `apps/webapp/src/lib/auth/derived-user-name.test.ts` with this exact coverage:

```ts
import { describe, expect, it } from "vitest";
import { buildDerivedUserName, toAuthStructuredName } from "./derived-user-name";

describe("derived-user-name", () => {
  it("joins trimmed first and last name into Better Auth's compatibility field", () => {
    expect(buildDerivedUserName("  Ada  ", "  Lovelace ")).toBe("Ada Lovelace");
  });

  it("returns the full structured Better Auth payload", () => {
    expect(toAuthStructuredName({ firstName: " Ada ", lastName: " Lovelace " })).toEqual({
      firstName: "Ada",
      lastName: "Lovelace",
      name: "Ada Lovelace",
    });
  });
});
```

Create `apps/webapp/src/lib/auth-helpers.test.ts` with mocks for `@/lib/auth`, `next/headers`, and `@/db`, then add this exact assertion:

```ts
it("surfaces structured auth names on the auth context user", async () => {
  getSessionMock.mockResolvedValue({
    user: {
      id: "user-1",
      email: "ada@example.com",
      name: "Ada Lovelace",
      firstName: "Ada",
      lastName: "Lovelace",
    },
    session: { activeOrganizationId: null },
  });

  const context = await getAuthContext();

  expect(context?.user.firstName).toBe("Ada");
  expect(context?.user.lastName).toBe("Lovelace");
});
```

- [ ] **Step 2: Run the helper test to verify it fails**

Run: `pnpm --dir apps/webapp exec vitest run src/lib/auth/derived-user-name.test.ts src/lib/auth-helpers.test.ts`
Expected: FAIL because the helper module does not exist yet and `AuthContext.user` does not expose structured auth names.

- [ ] **Step 3: Implement the helper and auth field support**

Create `apps/webapp/src/lib/auth/derived-user-name.ts` with this core implementation:

```ts
type StructuredName = {
  firstName: string;
  lastName: string;
};

function trimNamePart(value: string) {
  return value.trim();
}

export function buildDerivedUserName(firstName: string, lastName: string) {
  return [trimNamePart(firstName), trimNamePart(lastName)].filter(Boolean).join(" ");
}

export function toAuthStructuredName({ firstName, lastName }: StructuredName) {
  const trimmedFirstName = trimNamePart(firstName);
  const trimmedLastName = trimNamePart(lastName);

  return {
    firstName: trimmedFirstName,
    lastName: trimmedLastName,
    name: buildDerivedUserName(trimmedFirstName, trimmedLastName),
  };
}
```

Then update `apps/webapp/src/lib/auth.ts` user additional fields to include:

```ts
firstName: {
  type: "string",
  required: false,
  input: true,
},
lastName: {
  type: "string",
  required: false,
  input: true,
},
```

Then:

- run `pnpm --dir apps/webapp run auth:generate`
- extend `AuthContext.user` in `apps/webapp/src/lib/auth-helpers.ts` with `firstName?: string | null` and `lastName?: string | null`
- return `session.user.firstName ?? null` and `session.user.lastName ?? null` from `getAuthContext()`
- extend `Session["user"]` in `apps/webapp/src/lib/effect/services/auth.service.ts` with the same optional fields while preserving `name`

- [ ] **Step 4: Re-run the helper test to verify it passes**

Run: `pnpm --dir apps/webapp exec vitest run src/lib/auth/derived-user-name.test.ts src/lib/auth-helpers.test.ts`
Expected: PASS

- [ ] **Step 5: Commit the helper and auth-schema support**

```bash
git add apps/webapp/src/lib/auth/derived-user-name.ts apps/webapp/src/lib/auth/derived-user-name.test.ts apps/webapp/src/lib/auth-helpers.test.ts apps/webapp/src/lib/auth.ts apps/webapp/src/db/auth-schema.ts apps/webapp/src/lib/auth-helpers.ts apps/webapp/src/lib/effect/services/auth.service.ts
git commit -m "feat(auth): add structured user name fields"
```

### Task 2: Lock the profile server contract and split details from avatar updates

**Files:**
- Create: `apps/webapp/src/app/[locale]/(app)/settings/profile/actions.test.ts`
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/profile/actions.ts`
- Modify: `apps/webapp/src/lib/validations/profile.ts`
- Test: `apps/webapp/src/app/[locale]/(app)/settings/profile/actions.test.ts`

- [ ] **Step 1: Write the failing profile-action tests**

Create `apps/webapp/src/app/[locale]/(app)/settings/profile/actions.test.ts` with focused mocks for `@/lib/auth`, `next/headers`, `@/lib/effect/result`, and the employee-table access used by the action, then add these exact assertions:

```ts
it("derives Better Auth name from first and last name on profile save", async () => {
  await updateProfileDetails({
    firstName: "Ada",
    lastName: "Lovelace",
    gender: undefined,
    birthday: undefined,
  });

  expect(updateUserMock).toHaveBeenCalledWith(
    expect.objectContaining({
      body: expect.objectContaining({
        firstName: "Ada",
        lastName: "Lovelace",
        name: "Ada Lovelace",
      }),
    }),
  );
});

it("uses the stored structured names when only the profile image changes", async () => {
  getSessionMock.mockResolvedValue({
    user: {
      id: "user-1",
      email: "ada@example.com",
      firstName: "Ada",
      lastName: "Lovelace",
      name: "Ada Lovelace",
    },
  });

  await updateProfileImage({ image: null });

  expect(updateUserMock).toHaveBeenCalledWith(
    expect.objectContaining({
      body: expect.objectContaining({
        image: null,
        firstName: "Ada",
        lastName: "Lovelace",
        name: "Ada Lovelace",
      }),
    }),
  );
});

it("syncs the active-organization employee record when profile details change", async () => {
  employeeLookupMock.mockResolvedValue({ id: "emp-1" });

  await updateProfileDetails({
    firstName: "Grace",
    lastName: "Hopper",
    gender: undefined,
    birthday: undefined,
  });

  expect(employeeUpdateMock).toHaveBeenCalledWith(
    expect.objectContaining({ firstName: "Grace", lastName: "Hopper" }),
  );
});
```

- [ ] **Step 2: Run the profile-action tests to verify they fail**

Run: `pnpm --dir apps/webapp exec vitest run "src/app/[locale]/(app)/settings/profile/actions.test.ts"`
Expected: FAIL because the structured actions and schemas do not exist yet.

- [ ] **Step 3: Implement the split profile actions and schemas**

In `apps/webapp/src/lib/validations/profile.ts`, replace the raw `name` schema with two shapes:

```ts
export const profileDetailsUpdateSchema = z.object({
  firstName: z.string().trim().min(1, "First name is required"),
  lastName: z.string().trim().min(1, "Last name is required"),
  gender: z.enum(["male", "female", "other"]).optional(),
  birthday: z.date().max(new Date(), "Birthday must be in the past").optional().nullable(),
});

export const profileImageUpdateSchema = z.object({
  image: imageFieldSchema,
});
```

In `apps/webapp/src/app/[locale]/(app)/settings/profile/actions.ts`:

- rename the current structured save path to `updateProfileDetails`
- create a separate `updateProfileImage`
- use `toAuthStructuredName()` for the details path
- in the image path, call `auth.api.getSession()` first and rebuild the payload from stored `firstName` / `lastName`
- in the details path, resolve the active organization and update the matching employee record in the same server action when one exists
- keep existing image normalization semantics (`""` and `null` become `null`)

Core body construction should look like:

```ts
const structured = toAuthStructuredName({
  firstName: validatedData.firstName,
  lastName: validatedData.lastName,
});

const activeOrganizationId = session.session?.activeOrganizationId ?? null;
if (activeOrganizationId) {
  const existingEmployee = await db.query.employee.findFirst({
    where: and(eq(employee.userId, session.user.id), eq(employee.organizationId, activeOrganizationId)),
  });

  if (existingEmployee) {
    await db.update(employee).set({
      firstName: structured.firstName,
      lastName: structured.lastName,
      gender: validatedData.gender ?? null,
      birthday: validatedData.birthday ?? null,
    }).where(eq(employee.id, existingEmployee.id));
  }
}

await auth.api.updateUser({
  body: {
    ...structured,
    ...(normalizedImage !== undefined ? { image: normalizedImage } : {}),
  },
  headers: await headers(),
});
```

- [ ] **Step 4: Re-run the profile-action tests to verify they pass**

Run: `pnpm --dir apps/webapp exec vitest run "src/app/[locale]/(app)/settings/profile/actions.test.ts"`
Expected: PASS

- [ ] **Step 5: Commit the profile server contract changes**

```bash
git add apps/webapp/src/app/[locale]/(app)/settings/profile/actions.ts apps/webapp/src/app/[locale]/(app)/settings/profile/actions.test.ts apps/webapp/src/lib/validations/profile.ts
git commit -m "refactor(profile): derive auth name from structured fields"
```

### Task 3: Migrate the profile form to `@tanstack/react-form` and remove the duplicate name input

**Files:**
- Create: `apps/webapp/src/components/settings/profile-form.test.tsx`
- Modify: `apps/webapp/src/components/settings/profile-form.tsx`
- Test: `apps/webapp/src/components/settings/profile-form.test.tsx`

- [ ] **Step 1: Write the failing profile-form tests**

Create `apps/webapp/src/components/settings/profile-form.test.tsx` with mocked `updateProfileDetails`, `updateProfileImage`, `getCurrentEmployee`, and `useImageUpload`, then add these exact checks:

```tsx
it("renders first and last name fields without the old duplicate name field", async () => {
  render(<ProfileForm user={{ id: "user-1", email: "ada@example.com", image: null, name: "Ada Lovelace", firstName: "Ada", lastName: "Lovelace" }} />);

  expect(screen.queryByLabelText("Name")).toBeNull();
  expect(await screen.findByLabelText("First Name")).toHaveValue("Ada");
  expect(screen.getByLabelText("Last Name")).toHaveValue("Lovelace");
});

it("submits structured names through the details action", async () => {
  render(<ProfileForm user={{ id: "user-1", email: "ada@example.com", image: null, name: "Ada Lovelace", firstName: "Ada", lastName: "Lovelace" }} />);

  fireEvent.change(await screen.findByLabelText("First Name"), { target: { value: "Grace" } });
  fireEvent.change(screen.getByLabelText("Last Name"), { target: { value: "Hopper" } });
  fireEvent.click(screen.getByRole("button", { name: "Update Profile" }));

  await waitFor(() => {
    expect(updateProfileDetailsMock).toHaveBeenCalledWith(
      expect.objectContaining({ firstName: "Grace", lastName: "Hopper" }),
    );
  });
});

it("falls back to auth-level structured names when no employee record exists", async () => {
  getCurrentEmployeeMock.mockResolvedValue(null);

  render(<ProfileForm user={{ id: "user-1", email: "ada@example.com", image: null, name: "Ada Lovelace", firstName: "Ada", lastName: "Lovelace" }} />);

  expect(await screen.findByLabelText("First Name")).toHaveValue("Ada");
  expect(screen.getByLabelText("Last Name")).toHaveValue("Lovelace");
});
```

- [ ] **Step 2: Run the profile-form tests to verify they fail**

Run: `pnpm --dir apps/webapp exec vitest run src/components/settings/profile-form.test.tsx`
Expected: FAIL because the current form still renders `Name` and does not use the new action contract.

- [ ] **Step 3: Implement the profile form migration**

In `apps/webapp/src/components/settings/profile-form.tsx`:

- change `ProfileFormProps.user` to accept optional `firstName` / `lastName`
- initialize `useForm` with:

```tsx
const form = useForm({
  defaultValues: {
    firstName: user.firstName ?? "",
    lastName: user.lastName ?? "",
    gender: "",
    birthday: null as Date | null,
  },
  onSubmit: async ({ value }) => {
    const profileResult = await updateProfileDetails({
      firstName: value.firstName,
      lastName: value.lastName,
      gender: value.gender ? (value.gender as "male" | "female" | "other") : undefined,
      birthday: value.birthday ?? undefined,
    });
  },
});
```

- remove the editable top-level `Name` field entirely
- when employee data loads, prefer employee first/last name and fall back to `user.firstName` / `user.lastName`
- move avatar upload and removal to `updateProfileImage`
- preserve the existing email, avatar, gender, birthday, toast, query invalidation, and refresh behavior

- [ ] **Step 4: Re-run the profile-form tests to verify they pass**

Run: `pnpm --dir apps/webapp exec vitest run src/components/settings/profile-form.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit the profile form migration**

```bash
git add apps/webapp/src/components/settings/profile-form.tsx apps/webapp/src/components/settings/profile-form.test.tsx
git commit -m "refactor(profile): remove duplicate name field"
```

### Task 4: Migrate the signup form to `@tanstack/react-form` and send structured Better Auth names

**Files:**
- Modify: `apps/webapp/src/components/signup-form.test.tsx`
- Modify: `apps/webapp/src/components/signup-form.tsx`
- Test: `apps/webapp/src/components/signup-form.test.tsx`

- [ ] **Step 1: Replace the old single-name assertions with failing first/last-name tests**

Update `apps/webapp/src/components/signup-form.test.tsx` so the current invalid-submit test becomes:

```tsx
it("focuses firstName first and associates its error on submit", () => {
  render(<SignupForm />);

  fireEvent.click(screen.getByRole("button", { name: "Sign up" }));

  const firstNameInput = screen.getByLabelText("First Name");
  expect(document.activeElement).toBe(firstNameInput);
  expect(firstNameInput.getAttribute("aria-describedby")).toContain("firstName-error");
  expect(screen.getByText("First name is required").id).toBe("firstName-error");
});
```

Add this exact payload test in the same file:

```tsx
it("passes firstName, lastName, and derived name to Better Auth sign-up", async () => {
  signUpEmailMock.mockResolvedValue({ data: {}, error: null });
  render(<SignupForm />);

  fireEvent.change(screen.getByLabelText("First Name"), { target: { value: "Ada" } });
  fireEvent.change(screen.getByLabelText("Last Name"), { target: { value: "Lovelace" } });
  fireEvent.change(screen.getByLabelText("Email"), { target: { value: "ada@example.com" } });
  fireEvent.change(screen.getByLabelText("Password"), { target: { value: "Password1!" } });
  fireEvent.change(screen.getByLabelText("Confirm Password"), { target: { value: "Password1!" } });
  fireEvent.click(screen.getByRole("button", { name: "Sign up" }));

  await waitFor(() => {
    expect(signUpEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({
        firstName: "Ada",
        lastName: "Lovelace",
        name: "Ada Lovelace",
        email: "ada@example.com",
      }),
    );
  });
});

it("shows the last-name validation message and wiring", async () => {
  render(<SignupForm />);

  fireEvent.change(screen.getByLabelText("First Name"), { target: { value: "Ada" } });
  fireEvent.blur(screen.getByLabelText("Last Name"), { target: { value: "" } });

  expect(screen.getByText("Last name is required").id).toBe("lastName-error");
  expect(screen.getByLabelText("Last Name").getAttribute("aria-describedby")).toContain(
    "lastName-error",
  );
});
```

- [ ] **Step 2: Run the signup-form tests to verify they fail**

Run: `pnpm --dir apps/webapp exec vitest run src/components/signup-form.test.tsx`
Expected: FAIL because the current form still renders a single `Name` field and does not send structured fields.

- [ ] **Step 3: Implement the signup form migration**

In `apps/webapp/src/components/signup-form.tsx`:

- replace local `name` state with `firstName` / `lastName`
- migrate to `useForm` with default values for `firstName`, `lastName`, `email`, `password`, and `confirmPassword`
- use field validators mirroring onboarding for the new name fields
- preserve the existing password guidance, confirmation status, invite handling, Turnstile handling, and redirect behavior
- call Better Auth with the shared helper:

```tsx
const structured = toAuthStructuredName({
  firstName: value.firstName,
  lastName: value.lastName,
});

const signupResult = await authClient.signUp.email({
  email: value.email,
  password: value.password,
  ...structured,
});
```

- replace the rendered input block with separate `First Name` and `Last Name` fields using `autoComplete="given-name"` and `autoComplete="family-name"`

- [ ] **Step 4: Re-run the signup-form tests to verify they pass**

Run: `pnpm --dir apps/webapp exec vitest run src/components/signup-form.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit the signup form migration**

```bash
git add apps/webapp/src/components/signup-form.tsx apps/webapp/src/components/signup-form.test.tsx
git commit -m "refactor(auth): use structured names in signup"
```

### Task 5: Run full verification and finish the branch cleanly

**Files:**
- Verify: `apps/webapp/src/lib/auth/derived-user-name.test.ts`
- Verify: `apps/webapp/src/lib/auth-helpers.test.ts`
- Verify: `apps/webapp/src/app/[locale]/(app)/settings/profile/actions.test.ts`
- Verify: `apps/webapp/src/components/settings/profile-form.test.tsx`
- Verify: `apps/webapp/src/components/signup-form.test.tsx`

- [ ] **Step 1: Run the focused test suite**

Run:

```bash
pnpm --dir apps/webapp exec vitest run src/lib/auth/derived-user-name.test.ts src/lib/auth-helpers.test.ts "src/app/[locale]/(app)/settings/profile/actions.test.ts" src/components/settings/profile-form.test.tsx src/components/signup-form.test.tsx
```

Expected: PASS

- [ ] **Step 2: Run the full webapp test suite**

Run: `pnpm --dir apps/webapp test`
Expected: PASS

- [ ] **Step 3: Run the webapp build**

Run: `pnpm --dir apps/webapp build`
Expected: PASS

- [ ] **Step 4: Run Better Auth migration only if DB env is available**

Run: `pnpm --dir apps/webapp run auth:migrate`
Expected: PASS and DB schema updated for the new Better Auth user fields.

If DB env is unavailable in the execution session, do not force this command. Record that `auth:generate` was completed and leave `auth:migrate` for an env-enabled follow-up.

- [ ] **Step 5: Review the touched code with required quality skills and commit only if verification introduced new fixes**

Use:

- `/vercel-react-best-practices`
- `/web-design-guidelines`
- `/vercel-composition-patterns`

Then commit any final adjustments:

```bash
git status --short
# Only if Step 5 produced new changes:
git add <files changed during verification>
git commit -m "chore(auth): address name-field verification feedback"
```
