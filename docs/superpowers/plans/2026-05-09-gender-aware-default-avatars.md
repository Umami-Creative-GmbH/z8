# Gender-Aware Default Avatars Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate gender-aware DiceBear fallback avatars for users who selected male or female, while preserving current deterministic fallback behavior for other or missing gender.

**Architecture:** Keep avatar generation centralized in `apps/webapp/src/lib/avatar/dicebear.ts`. Add an optional `gender` field to the generator and `UserAvatar`, then pass gender through from avatar call sites that already have it.

**Tech Stack:** React, TypeScript, DiceBear Lorelei, Vitest, pnpm.

---

## File Structure

- Modify: `apps/webapp/src/lib/avatar/dicebear.ts` — add the shared `UserAvatarGender` type and apply DiceBear's `sex` option for `male` and `female` only.
- Create: `apps/webapp/src/lib/avatar/dicebear.test.ts` — verify the generator passes the correct DiceBear options.
- Modify: `apps/webapp/src/components/user-avatar.tsx` — accept optional `gender` and include it in fallback avatar generation.
- Modify call sites that already have gender data, starting with `apps/webapp/src/components/settings/profile-form.tsx` and employee/member list contexts where the rendered model exposes `gender`.
- Run focused tests with `pnpm --filter webapp test -- apps/webapp/src/lib/avatar/dicebear.test.ts` if the workspace supports filtered test arguments; otherwise use the repository's existing `pnpm test` command.

### Task 1: Avatar Generator

**Files:**
- Modify: `apps/webapp/src/lib/avatar/dicebear.ts`
- Create: `apps/webapp/src/lib/avatar/dicebear.test.ts`

- [ ] **Step 1: Write the failing tests**

Add `apps/webapp/src/lib/avatar/dicebear.test.ts`:

```ts
import { createAvatar } from "@dicebear/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { generateAvatarDataUri } from "./dicebear";

vi.mock("@dicebear/core", () => ({
	createAvatar: vi.fn(() => ({
		toDataUri: () => "data:image/svg+xml;base64,test",
	})),
}));

vi.mock("@dicebear/collection", () => ({
	lorelei: {},
}));

describe("generateAvatarDataUri", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("sets DiceBear sex to male for male users", () => {
		generateAvatarDataUri({ seed: "user-1", gender: "male" });

		expect(createAvatar).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({ sex: ["male"] }),
		);
	});

	it("sets DiceBear sex to female for female users", () => {
		generateAvatarDataUri({ seed: "user-2", gender: "female" });

		expect(createAvatar).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({ sex: ["female"] }),
		);
	});

	it("keeps seeded random variants for other or missing gender", () => {
		generateAvatarDataUri({ seed: "user-3", gender: "other" });
		generateAvatarDataUri({ seed: "user-4" });

		expect(vi.mocked(createAvatar).mock.calls[0]?.[1]).not.toHaveProperty("sex");
		expect(vi.mocked(createAvatar).mock.calls[1]?.[1]).not.toHaveProperty("sex");
	});
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
pnpm --filter webapp test -- apps/webapp/src/lib/avatar/dicebear.test.ts
```

Expected: FAIL because `DiceBearAvatarOptions` does not accept `gender` yet and the generator does not pass `sex`.

- [ ] **Step 3: Implement the generator change**

Update `apps/webapp/src/lib/avatar/dicebear.ts`:

```ts
import { lorelei } from "@dicebear/collection";
import { createAvatar } from "@dicebear/core";

export type UserAvatarGender = "male" | "female" | "other";

export interface DiceBearAvatarOptions {
	seed: string;
	size?: number;
	gender?: UserAvatarGender | null;
}

function getDiceBearSex(gender: UserAvatarGender | null | undefined): ["male"] | ["female"] | undefined {
	if (gender === "male") return ["male"];
	if (gender === "female") return ["female"];
	return undefined;
}

/**
 * Generate a DiceBear Lorelei avatar as a data URI
 * Uses deterministic seed (user.id recommended) for consistent avatars
 */
export function generateAvatarDataUri({ seed, size = 128, gender }: DiceBearAvatarOptions): string {
	const sex = getDiceBearSex(gender);
	const avatar = createAvatar(lorelei, {
		seed,
		size,
		backgroundColor: ["b6e3f4", "c0aede", "d1d4f9", "ffd5dc", "ffdfbf"],
		backgroundType: ["solid"],
		radius: 50,
		...(sex ? { sex } : {}),
	});

	return avatar.toDataUri();
}

/**
 * Extract initials from a name for accessibility/alt text
 * Returns up to 2 characters
 */
export function getInitials(name: string | null | undefined): string {
	if (!name) return "?";
	return name
		.split(" ")
		.map((n) => n[0])
		.join("")
		.toUpperCase()
		.slice(0, 2);
}
```

- [ ] **Step 4: Run the generator test to verify it passes**

Run:

```bash
pnpm --filter webapp test -- apps/webapp/src/lib/avatar/dicebear.test.ts
```

Expected: PASS.

### Task 2: UserAvatar Prop Wiring

**Files:**
- Modify: `apps/webapp/src/components/user-avatar.tsx`
- Modify: `apps/webapp/src/components/settings/profile-form.tsx`

- [ ] **Step 1: Update `UserAvatar` to accept gender**

Update `apps/webapp/src/components/user-avatar.tsx` imports and props:

```ts
import { generateAvatarDataUri, getInitials, type UserAvatarGender } from "@/lib/avatar";

export interface UserAvatarProps {
	image?: string | null;
	seed: string;
	name?: string | null;
	gender?: UserAvatarGender | null;
	size?: UserAvatarSize;
	shape?: UserAvatarShape;
	className?: string;
	bordered?: boolean;
}
```

Update the component parameter and memoized fallback:

```ts
export function UserAvatar({
	image,
	seed,
	name,
	gender,
	size = "sm",
	shape = "circle",
	className,
	bordered = false,
}: UserAvatarProps) {
	const [isLoading, setIsLoading] = useState(true);
	const { class: sizeClass, pixels, spinner: spinnerClass } = sizeConfig[size];
	const shapeClass = shapeConfig[shape];

	const dicebearAvatar = useMemo(
		() => generateAvatarDataUri({ seed, size: pixels * 2, gender }),
		[seed, pixels, gender],
	);
```

- [ ] **Step 2: Pass selected profile gender into profile preview**

Update `apps/webapp/src/components/settings/profile-form.tsx` near the existing profile picture preview:

```tsx
<UserAvatar
	seed={user.id}
	image={previewUrl || avatarImage || undefined}
	name={displayName}
	gender={selectedGender || null}
	size="xl"
/>
```

- [ ] **Step 3: Run typecheck or focused tests**

Run:

```bash
pnpm --filter webapp test -- apps/webapp/src/lib/avatar/dicebear.test.ts apps/webapp/src/components/settings/profile-form.test.tsx
```

Expected: PASS. If the test runner does not accept multiple file paths after `--`, run each file separately.

### Task 3: Pass Gender Through Existing Employee Avatar Call Sites

**Files:**
- Modify only `UserAvatar` call sites where the local data model already exposes `gender` in the same object being rendered.

- [ ] **Step 1: Search call sites before editing**

Run:

```bash
rg "<UserAvatar" apps/webapp/src -n
```

Expected: a list of current `UserAvatar` call sites.

- [ ] **Step 2: Add `gender` props only where data is already present**

Examples of expected edits:

```tsx
<UserAvatar
	image={row.original.user.image}
	seed={row.original.user.id}
	name={row.original.user.name}
	gender={row.original.gender}
	size="sm"
/>
```

```tsx
<UserAvatar
	seed={employee.userId}
	image={employee.user.image}
	name={name}
	gender={employee.gender}
	size="sm"
/>
```

Do not add database query changes in this task. If a call site does not already have gender in its local data shape, leave it unchanged so it preserves current behavior.

- [ ] **Step 3: Run TypeScript-aware verification**

Run:

```bash
pnpm --filter webapp test -- apps/webapp/src/lib/avatar/dicebear.test.ts
```

Expected: PASS. If type errors are reported for a call site, remove that `gender` prop unless the local type clearly has `gender` available.

### Task 4: Final Verification

**Files:**
- No additional files unless verification exposes a concrete issue.

- [ ] **Step 1: Run the repository test command**

Run:

```bash
pnpm test
```

Expected: PASS, or a clear pre-existing/environmental failure unrelated to avatar changes.

- [ ] **Step 2: Review changed files**

Run:

```bash
git diff -- apps/webapp/src/lib/avatar/dicebear.ts apps/webapp/src/lib/avatar/dicebear.test.ts apps/webapp/src/components/user-avatar.tsx apps/webapp/src/components/settings/profile-form.tsx
```

Expected: changes are limited to gender-aware avatar fallback behavior and the spec/plan documents.

- [ ] **Step 3: Commit only if explicitly requested**

Do not create a git commit unless the user explicitly asks for one. If requested, stage only relevant files and commit with:

```bash
git commit -m "feat: add gender-aware default avatars"
```

## Self-Review

- Spec coverage: The plan covers uploaded image preservation, optional gender-aware fallback generation, deterministic other/missing behavior, profile preview wiring, and existing data-only call-site propagation.
- Placeholder scan: No TBD/TODO/later placeholders remain.
- Type consistency: `UserAvatarGender`, `gender`, and `DiceBearAvatarOptions` are consistently named across tasks.
