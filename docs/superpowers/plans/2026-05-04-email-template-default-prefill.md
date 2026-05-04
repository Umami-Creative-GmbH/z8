# Email Template Default Prefill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the email template default/custom toggle and make every organization template editor start from the system template, with a clear reset-to-system action.

**Architecture:** Keep persistence sparse: no organization row exists until an admin saves a customization. The server action returns editor-ready system draft fields for templates without overrides, the client removes `isEnabled` as a user-controlled draft field, and reset continues deleting the org-scoped override.

**Tech Stack:** Next.js server actions, React 19 client components, Drizzle ORM, Vitest, Testing Library, `@react-email/editor`, pnpm.

---

## File Structure

- Modify `apps/webapp/src/lib/email/template-settings.ts`: make `isEnabled` optional in action input validation so the UI no longer has to send it.
- Modify `apps/webapp/src/app/[locale]/(app)/settings/email-templates/actions.ts`: return system-prefilled editor drafts and always persist saved templates as enabled.
- Modify `apps/webapp/src/components/settings/email-templates/email-template-settings-client.tsx`: remove the switch, remove draft enabled state, update reset copy and local draft reset behavior.
- Modify `apps/webapp/src/app/[locale]/(app)/settings/email-templates/actions.test.ts`: cover system-prefilled listing and enabled save default.
- Modify `apps/webapp/src/components/settings/email-templates/email-template-settings-client.test.tsx`: cover toggle removal, system-prefilled editor, save input without `isEnabled`, and reset label.
- Optionally modify `docs/superpowers/specs/2026-05-04-email-template-default-prefill-design.md` only if implementation reveals a spec mismatch.

## Task 1: Server Input Contract

**Files:**
- Modify: `apps/webapp/src/lib/email/template-settings.ts`
- Test: `apps/webapp/src/app/[locale]/(app)/settings/email-templates/actions.test.ts`

- [ ] **Step 1: Write the failing validation test**

Add this test after `it("accepts valid template input", ...)` in `apps/webapp/src/app/[locale]/(app)/settings/email-templates/actions.test.ts`:

```ts
it("accepts valid template input without an enabled state", () => {
	const result = validateEmailTemplateInput({
		templateKey: "password-reset",
		subject: "Reset your password, {{userName}}",
		html: "<p>{{resetUrl}}</p>",
		editorDocument: { root: { type: "email" } },
	});

	expect(result).toEqual({ success: true, errors: [] });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --dir apps/webapp vitest run src/app/[locale]/\(app\)/settings/email-templates/actions.test.ts`

Expected: FAIL because `Enabled state must be a boolean` is still required.

- [ ] **Step 3: Make `isEnabled` optional in the input type and validator**

In `apps/webapp/src/lib/email/template-settings.ts`, change the input interface and validator block to:

```ts
export interface SaveEmailTemplateInput {
	templateKey: EmailTemplateKey;
	subject: string;
	html: string;
	editorDocument: unknown;
	plainText?: string;
	isEnabled?: boolean;
}
```

```ts
if (input.isEnabled !== undefined && typeof input.isEnabled !== "boolean") {
	errors.push("Enabled state must be a boolean");
}
```

Leave the malformed runtime input test unchanged; it should still fail when `isEnabled: "yes"` is passed.

- [ ] **Step 4: Run validation tests**

Run: `pnpm --dir apps/webapp vitest run src/app/[locale]/\(app\)/settings/email-templates/actions.test.ts`

Expected: PASS for the new optional-input test and the existing malformed-input test.

- [ ] **Step 5: Commit**

Only commit if the user explicitly requested commits. If commits are requested, run:

```bash
git add apps/webapp/src/lib/email/template-settings.ts apps/webapp/src/app/[locale]/\(app\)/settings/email-templates/actions.test.ts
git commit -m "fix: simplify email template save input"
```

## Task 2: Server-Side System Draft Prefill

**Files:**
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/email-templates/actions.ts`
- Test: `apps/webapp/src/app/[locale]/(app)/settings/email-templates/actions.test.ts`

- [ ] **Step 1: Replace the listing test expectation**

In `apps/webapp/src/app/[locale]/(app)/settings/email-templates/actions.test.ts`, replace `it("lists registry entries with active organization overrides only", ...)` with:

```ts
it("lists registry entries with system-prefilled drafts when no override exists", async () => {
	const templates = await listEmailTemplates();
	const passwordReset = templates.find((entry) => entry.key === "password-reset");

	expect(mocks.requireAccess).toHaveBeenCalledTimes(1);
	expect(mocks.conditions).toContainEqual({ eq: ["organizationId", "org_1"] });
	expect(passwordReset?.override).toBeNull();
	expect(passwordReset?.starterDraftPlainText).toContain("{{userName}}");
	expect(passwordReset?.starterDraftPlainText).toContain("{{resetUrl}}");
	expect(passwordReset?.starterDraftPlainText).not.toContain("Alex Morgan");
	expect(passwordReset?.starterDraftHtml).toContain("{{resetUrl}}");
	expect(passwordReset?.starterDraftHtml).not.toContain("/reset-password?token=preview");
});

it("lists registry entries with organization overrides when they exist", async () => {
	mocks.templates = [{ templateKey: "password-reset", subject: "Override" }];

	const templates = await listEmailTemplates();

	expect(templates.find((entry) => entry.key === "password-reset")?.override).toEqual({
		templateKey: "password-reset",
		subject: "Override",
	});
});
```

- [ ] **Step 2: Run test to verify the system-prefill test fails**

Run: `pnpm --dir apps/webapp vitest run src/app/[locale]/\(app\)/settings/email-templates/actions.test.ts`

Expected: FAIL because the current `createStarterDraft` uses description/list placeholder content, not system template content.

- [ ] **Step 3: Implement system draft generation without preview values**

In `apps/webapp/src/app/[locale]/(app)/settings/email-templates/actions.ts`, replace `createStarterDraft` with this implementation:

```ts
function createSystemDraft(definition: EmailTemplateDefinition) {
	let starterDraftHtml = definition.renderDefault(definition.previewData as never) as unknown as string;

	for (const variable of definition.variables) {
		const previewValue = String(definition.previewData[variable.name] ?? "");
		if (previewValue) {
			starterDraftHtml = starterDraftHtml.split(previewValue).join(`{{${variable.name}}}`);
		}
	}

	const starterDraftPlainText = definition.variables
		.map((variable) => `${variable.label}: {{${variable.name}}}`)
		.join("\n");

	return { starterDraftHtml, starterDraftPlainText };
}
```

Then update `listEmailTemplates` to pass the full definition before omitting `renderDefault`:

```ts
return EMAIL_TEMPLATE_REGISTRY.map((definition) => {
	const { renderDefault: _renderDefault, ...publicDefinition } = definition;

	return {
		...publicDefinition,
		...createSystemDraft(definition),
		override: overridesByTemplateKey.get(definition.key) ?? null,
	};
});
```

If TypeScript reports `renderDefault` is async for any template, make `createSystemDraft` async and use `await Promise.all(EMAIL_TEMPLATE_REGISTRY.map(async ...))` in `listEmailTemplates`.

- [ ] **Step 4: Run action tests**

Run: `pnpm --dir apps/webapp vitest run src/app/[locale]/\(app\)/settings/email-templates/actions.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

Only commit if the user explicitly requested commits. If commits are requested, run:

```bash
git add apps/webapp/src/app/[locale]/\(app\)/settings/email-templates/actions.ts apps/webapp/src/app/[locale]/\(app\)/settings/email-templates/actions.test.ts
git commit -m "fix: prefill email templates from system drafts"
```

## Task 3: Save Custom Templates As Enabled

**Files:**
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/email-templates/actions.ts`
- Test: `apps/webapp/src/app/[locale]/(app)/settings/email-templates/actions.test.ts`

- [ ] **Step 1: Tighten the save test**

In `apps/webapp/src/app/[locale]/(app)/settings/email-templates/actions.test.ts`, update `it("saves sanitized templates scoped to the active organization", ...)` so the input omits `isEnabled` and the expectation asserts enabled persistence:

```ts
const result = await saveEmailTemplate({
	templateKey: "password-reset",
	subject: "Reset {{userName}}",
	html: '<p>{{resetUrl}}</p><script>alert("x")</script>',
	editorDocument: { root: { type: "email" } },
});

expect(mocks.insertValues).toMatchObject({
	organizationId: "org_1",
	templateKey: "password-reset",
	createdByUserId: "user_1",
	updatedByUserId: "user_1",
	isEnabled: true,
});
```

- [ ] **Step 2: Run test to verify it fails if save still depends on input enabled state**

Run: `pnpm --dir apps/webapp vitest run src/app/[locale]/\(app\)/settings/email-templates/actions.test.ts`

Expected: FAIL if `isEnabled` is stored as `undefined`.

- [ ] **Step 3: Persist saved custom templates as enabled**

In `apps/webapp/src/app/[locale]/(app)/settings/email-templates/actions.ts`, change both insert and conflict update `isEnabled` assignments:

```ts
isEnabled: true,
```

The two locations are inside `.values({ ... })` and `.onConflictDoUpdate({ set: { ... } })`.

- [ ] **Step 4: Run action tests**

Run: `pnpm --dir apps/webapp vitest run src/app/[locale]/\(app\)/settings/email-templates/actions.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

Only commit if the user explicitly requested commits. If commits are requested, run:

```bash
git add apps/webapp/src/app/[locale]/\(app\)/settings/email-templates/actions.ts apps/webapp/src/app/[locale]/\(app\)/settings/email-templates/actions.test.ts
git commit -m "fix: save email template customizations enabled"
```

## Task 4: Remove The Client Toggle

**Files:**
- Modify: `apps/webapp/src/components/settings/email-templates/email-template-settings-client.tsx`
- Test: `apps/webapp/src/components/settings/email-templates/email-template-settings-client.test.tsx`

- [ ] **Step 1: Update the render test for no toggle**

In `apps/webapp/src/components/settings/email-templates/email-template-settings-client.test.tsx`, update `it("renders the template list and initial editor", ...)` to assert the switch is gone:

```ts
expect(screen.queryByRole("switch", { name: "Use custom template" })).toBeNull();
expect(screen.queryByText("Custom template")).toBeNull();
expect(screen.queryByText("System default")).toBeNull();
expect(screen.getByText("Default")).toBeTruthy();
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --dir apps/webapp vitest run src/components/settings/email-templates/email-template-settings-client.test.tsx`

Expected: FAIL because the switch and mode labels are still rendered.

- [ ] **Step 3: Remove enabled state from the client draft and payload**

In `apps/webapp/src/components/settings/email-templates/email-template-settings-client.tsx`:

Remove this import:

```ts
import { Switch } from "@/components/ui/switch";
```

Change `EmailTemplateOverride` to keep `isEnabled` only for existing server data:

```ts
export interface EmailTemplateOverride {
	subject: string;
	editorDocument: EmailTemplateEditorDocument;
	html: string;
	plainText: string | null;
	isEnabled: boolean;
}
```

Change `Draft` to:

```ts
type Draft = {
	subject: string;
	html: string;
	plainText: string;
	editorDocument: EmailTemplateEditorDocument;
};
```

Remove `isEnabled: override?.isEnabled ?? true,` from `createDraft`.

Change selected status to:

```ts
const selectedStatus = selectedTemplate?.override ? "Customized" : "Default";
```

Remove `isEnabled: draft.isEnabled,` from `actionInput`.

Remove the whole `<label ...>` block that contains `System default`, `Switch`, and `Custom template` from the card header.

- [ ] **Step 4: Run client tests**

Run: `pnpm --dir apps/webapp vitest run src/components/settings/email-templates/email-template-settings-client.test.tsx`

Expected: PASS or only failures related to reset label/save payload covered in later tasks.

- [ ] **Step 5: Commit**

Only commit if the user explicitly requested commits. If commits are requested, run:

```bash
git add apps/webapp/src/components/settings/email-templates/email-template-settings-client.tsx apps/webapp/src/components/settings/email-templates/email-template-settings-client.test.tsx
git commit -m "fix: remove email template mode toggle"
```

## Task 5: Reset To System Template UX

**Files:**
- Modify: `apps/webapp/src/components/settings/email-templates/email-template-settings-client.tsx`
- Test: `apps/webapp/src/components/settings/email-templates/email-template-settings-client.test.tsx`

- [ ] **Step 1: Add reset behavior test**

Add this test near the end of `apps/webapp/src/components/settings/email-templates/email-template-settings-client.test.tsx`:

```ts
it("resets an override back to the system template draft", async () => {
	resetEmailTemplateMock.mockResolvedValue({ success: true });
	const overriddenTemplates = templates.map((template) =>
		template.definition.key === "email-verification"
			? {
					...template,
					override: {
						subject: "Existing custom subject",
						html: "<p>Existing custom body</p>",
						plainText: "Existing custom body",
						editorDocument: { type: "doc" },
						isEnabled: true,
					},
				}
			: template,
	);
	render(<EmailTemplateSettingsClient templates={overriddenTemplates} />);

	expect(screen.getByLabelText("Subject")).toHaveProperty("value", "Existing custom subject");
	fireEvent.click(screen.getByRole("button", { name: "Reset to system template" }));

	await waitFor(() => {
		expect(resetEmailTemplateMock).toHaveBeenCalledWith("email-verification");
	});
	expect(screen.getByLabelText("Subject")).toHaveProperty("value", "Verify your email address");
	expect(screen.getByTestId("editor-html").textContent).toContain("{{userName}}");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --dir apps/webapp vitest run src/components/settings/email-templates/email-template-settings-client.test.tsx`

Expected: FAIL because the button is still labeled `Reset`.

- [ ] **Step 3: Update reset copy and success toast**

In `apps/webapp/src/components/settings/email-templates/email-template-settings-client.tsx`, change the reset toast and button text:

```tsx
toast.success(
	t("settings.emailTemplates.reset", "Email template reset to system template"),
);
```

```tsx
<Button type="button" variant="outline" onClick={handleReset} disabled={isPending}>
	Reset to system template
</Button>
```

- [ ] **Step 4: Run client tests**

Run: `pnpm --dir apps/webapp vitest run src/components/settings/email-templates/email-template-settings-client.test.tsx`

Expected: PASS.

- [ ] **Step 5: Commit**

Only commit if the user explicitly requested commits. If commits are requested, run:

```bash
git add apps/webapp/src/components/settings/email-templates/email-template-settings-client.tsx apps/webapp/src/components/settings/email-templates/email-template-settings-client.test.tsx
git commit -m "fix: clarify email template reset action"
```

## Task 6: Final Verification

**Files:**
- Verify modified test suites and type safety.

- [ ] **Step 1: Run focused action tests**

Run: `pnpm --dir apps/webapp vitest run src/app/[locale]/\(app\)/settings/email-templates/actions.test.ts`

Expected: PASS.

- [ ] **Step 2: Run focused client tests**

Run: `pnpm --dir apps/webapp vitest run src/components/settings/email-templates/email-template-settings-client.test.tsx`

Expected: PASS.

- [ ] **Step 3: Run renderer regression tests**

Run: `pnpm --dir apps/webapp vitest run src/lib/email/template-renderer.test.ts`

Expected: PASS. Runtime fallback behavior should remain unchanged.

- [ ] **Step 4: Run full webapp tests if focused tests pass**

Run: `pnpm --dir apps/webapp test`

Expected: PASS. If unrelated failures appear, record the failing test names and continue only after confirming they are unrelated to email templates.

- [ ] **Step 5: Inspect git diff**

Run: `git diff -- apps/webapp/src/lib/email/template-settings.ts apps/webapp/src/app/[locale]/\(app\)/settings/email-templates/actions.ts apps/webapp/src/components/settings/email-templates/email-template-settings-client.tsx apps/webapp/src/app/[locale]/\(app\)/settings/email-templates/actions.test.ts apps/webapp/src/components/settings/email-templates/email-template-settings-client.test.tsx docs/superpowers/specs/2026-05-04-email-template-default-prefill-design.md docs/superpowers/plans/2026-05-04-email-template-default-prefill.md`

Expected: Diff only contains the approved UX/data-flow changes and plan/spec files.

- [ ] **Step 6: Commit final state**

Only commit if the user explicitly requested commits. If commits are requested, run:

```bash
git add apps/webapp/src/lib/email/template-settings.ts apps/webapp/src/app/[locale]/\(app\)/settings/email-templates/actions.ts apps/webapp/src/components/settings/email-templates/email-template-settings-client.tsx apps/webapp/src/app/[locale]/\(app\)/settings/email-templates/actions.test.ts apps/webapp/src/components/settings/email-templates/email-template-settings-client.test.tsx docs/superpowers/specs/2026-05-04-email-template-default-prefill-design.md docs/superpowers/plans/2026-05-04-email-template-default-prefill.md
git commit -m "fix: clarify email template customization flow"
```

## Self-Review

- Spec coverage: Tasks cover toggle removal, editor-only system prefill, sparse persistence, reset-to-system behavior, enabled saves, and unchanged runtime fallback.
- Placeholder scan: No TBD/TODO/fill-later placeholders remain.
- Type consistency: `SaveEmailTemplateInput.isEnabled` becomes optional; client payload omits it; server save writes `isEnabled: true`; runtime override lookup remains unchanged.
