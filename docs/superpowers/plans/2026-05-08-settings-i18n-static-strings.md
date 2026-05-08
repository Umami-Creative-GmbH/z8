# Settings i18n Static Strings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert static user-facing Settings UI strings to Tolgee `t()` calls without editing message JSON files.

**Architecture:** Keep the existing component structure and add translation plumbing at the component boundary. Use static literal Tolgee keys with English fallback values so the Tolgee CLI can extract keys from TypeScript. Group work by settings domain to keep review and testing manageable.

**Tech Stack:** Next.js 16, React 19, TypeScript, Tolgee `@tolgee/react`, Vitest, Testing Library, Biome, React Doctor.

---

## File Structure

Do not create shared i18n registries. Touch only the components that own visible copy.

Files to modify by task:

- Employee settings: `apps/webapp/src/app/[locale]/(app)/settings/employees/**`, `apps/webapp/src/components/settings/role-selector.tsx`, `apps/webapp/src/components/settings/contract-type-selector.tsx`
- Permissions settings: `apps/webapp/src/app/[locale]/(app)/settings/permissions/**`
- Team detail settings: `apps/webapp/src/app/[locale]/(app)/settings/teams/[teamId]/**`
- Vacation employee settings: `apps/webapp/src/app/[locale]/(app)/settings/vacation/employees/**`
- Notification integrations: `apps/webapp/src/app/[locale]/(app)/settings/slack/page.tsx`, `apps/webapp/src/app/[locale]/(app)/settings/discord/page.tsx`, `apps/webapp/src/app/[locale]/(app)/settings/teams-notifications/page.tsx`, `apps/webapp/src/components/settings/notification-channel-settings.tsx`
- Enterprise identity: `apps/webapp/src/components/settings/enterprise/identity-setup-wizard.tsx`, `apps/webapp/src/components/settings/enterprise/domains-branding-tabs.tsx`
- Approval policy settings: `apps/webapp/src/components/settings/approval-policy-management.tsx`, `apps/webapp/src/components/settings/approval-policy-dialog.tsx`, `apps/webapp/src/components/settings/approval-policy-preview.tsx`, `apps/webapp/src/components/settings/employee-group-management.tsx`
- Account/security settings: `apps/webapp/src/components/settings/profile-form.tsx`, `apps/webapp/src/components/settings/two-factor-setup.tsx`, `apps/webapp/src/components/settings/week-start-settings.tsx`, `apps/webapp/src/components/settings/email-templates/email-template-settings-client.tsx`
- Misc settings routes: `apps/webapp/src/app/[locale]/(app)/settings/implementation-checklist/implementation-checklist-client.tsx`, `apps/webapp/src/app/[locale]/(app)/settings/error.tsx`, `apps/webapp/src/app/[locale]/(app)/settings/avv/page.tsx`

Do not modify:

- `apps/webapp/messages/**/*.json`
- Generated schema files
- Non-settings routes/components unless a settings component imports and owns the copy.

## Common Implementation Pattern

Use this pattern in every task:

```tsx
import { useTranslate } from "@tolgee/react";

export function SettingsComponent() {
	const { t } = useTranslate();

	return <CardTitle>{t("settings.area.specificLabel", "Specific Label")}</CardTitle>;
}
```

For module-level option arrays, store keys and fallback values, then resolve inside the component:

```tsx
const statusOptions = [
	{ value: "active", labelKey: "settings.employees.directory.statusActive", label: "Active" },
];

{statusOptions.map((option) => (
	<SelectItem key={option.value} value={option.value}>
		{t(option.labelKey, option.label)}
	</SelectItem>
))}
```

This is acceptable only when `labelKey` values are literal strings in the source file. Do not build keys with template strings or concatenation.

## Task 1: Normalize Employee Detail Work To No-JSON Policy

**Files:**

- Modify: `apps/webapp/messages/settings/de.json`
- Modify: `apps/webapp/messages/settings/en.json`
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/employees/[employeeId]/employee-detail-page-client.tsx`
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/employees/[employeeId]/page-sections.tsx`
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/employees/[employeeId]/page-sections.test.tsx`
- Modify: `apps/webapp/src/components/settings/role-selector.tsx`
- Modify: `apps/webapp/src/components/settings/contract-type-selector.tsx`

- [ ] **Step 1: Remove manual locale JSON edits**

Run:

```bash
git diff -- apps/webapp/messages/settings/de.json apps/webapp/messages/settings/en.json
```

Expected: only employee detail keys are changed. Remove those added keys so the locale JSON files have no diff for this task.

- [ ] **Step 2: Keep employee components using `t()` with fallbacks**

Confirm code still follows this shape in `page-sections.tsx`:

```tsx
<CardTitle>{t("settings.employees.detailView.editTitle", "Edit Employee")}</CardTitle>
```

Confirm selector labels stay passed as translated props:

```tsx
<RoleSelector
	value={field.state.value}
	onChange={field.handleChange}
	disabled={!canEditOrgAdminFields || isUpdating}
	labels={{
		admin: {
			label: t("settings.employees.detailView.roleAdmin", "Admin"),
			description: t("settings.employees.detailView.roleAdminDescription", "Full system access"),
		},
	}}
/>
```

- [ ] **Step 3: Keep the regression test independent of message JSON**

Ensure `page-sections.test.tsx` stubs `t()` directly:

```tsx
const t = (key: string, defaultValue: string, values?: Record<string, string | number>) => {
	let value = translations.get(key) ?? defaultValue;
	for (const [name, replacement] of Object.entries(values ?? {})) {
		value = value.replace(`{${name}}`, String(replacement));
	}
	return value;
};
```

- [ ] **Step 4: Verify employee detail test passes**

Run:

```bash
pnpm test "src/app/[locale]/(app)/settings/employees/[employeeId]/page-sections.test.tsx"
```

Expected: `2 passed`.

## Task 2: Employee Directory And Permissions Settings

**Files:**

- Modify: `apps/webapp/src/app/[locale]/(app)/settings/employees/employees-page-client.tsx`
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/employees/columns.tsx`
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/permissions/page-sections.tsx`
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/permissions/permissions-page-client.tsx`

- [ ] **Step 1: Write or update a permissions regression test**

If no test exists, create `apps/webapp/src/app/[locale]/(app)/settings/permissions/page-sections.test.tsx` with a minimal render of the page sections that passes a stub `t()` or mocks Tolgee. It must assert representative translated labels:

```tsx
expect(screen.getByText("Mitarbeiterberechtigungen")).toBeTruthy();
expect(screen.queryByText("Employee Permissions")).toBeNull();
```

- [ ] **Step 2: Add `useTranslate()` to employee directory**

In `employees-page-client.tsx`, wrap visible strings:

```tsx
const { t } = useTranslate();

<span className="sr-only">{t("settings.employees.directory.refresh", "Refresh")}</span>
<CardTitle>{t("settings.employees.directory.title", "Employee Directory")}</CardTitle>
<Input placeholder={t("settings.employees.directory.searchPlaceholder", "Search by name, email, or position...")} />
```

Wrap role/status filter labels:

```tsx
<SelectValue placeholder={t("settings.employees.directory.filterByRole", "Filter by role")} />
<SelectItem value="all">{t("settings.employees.directory.allRoles", "All Roles")}</SelectItem>
<SelectItem value="admin">{t("settings.employees.directory.roleAdmin", "Admin")}</SelectItem>
```

- [ ] **Step 3: Localize employee table actions**

In `columns.tsx`, avoid module-level translated JSX. Convert the column factory to accept `t` if needed, or add a small client cell component using `useTranslate()`:

```tsx
function EmployeeActionsCell({ employeeId }: { employeeId: string }) {
	const { t } = useTranslate();
	return <Link href={`/settings/employees/${employeeId}`}>{t("settings.employees.directory.viewDetails", "View Details")}</Link>;
}
```

- [ ] **Step 4: Localize permissions page sections**

In `permissions/page-sections.tsx`, wrap static copy:

```tsx
const { t } = useTranslate();

<p className="text-sm text-muted-foreground">{t("settings.permissions.adminRequired", "Admin access required")}</p>
<CardTitle>{t("settings.permissions.employeePermissions", "Employee Permissions")}</CardTitle>
<TableHead>{t("settings.permissions.table.employee", "Employee")}</TableHead>
```

- [ ] **Step 5: Localize permissions toasts**

In `permissions-page-client.tsx`:

```tsx
const { t } = useTranslate();
toast.error(t("settings.permissions.adminOnly", "You must be an admin to manage permissions"));
```

- [ ] **Step 6: Run focused checks**

Run the permissions test if added and existing employee query tests:

```bash
pnpm test "src/app/[locale]/(app)/settings/permissions/page-sections.test.tsx" "src/lib/query/use-employees.test.ts"
```

Expected: all selected tests pass. If `use-employees.test.ts` is unrelated and absent in this workspace, run only the new permissions test.

## Task 3: Team Detail Settings

**Files:**

- Modify: `apps/webapp/src/app/[locale]/(app)/settings/teams/[teamId]/page.tsx`
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/teams/[teamId]/page-sections.tsx`
- Test: add `apps/webapp/src/app/[locale]/(app)/settings/teams/[teamId]/page-sections.test.tsx` if no focused test exists.

- [ ] **Step 1: Write a failing team detail i18n test**

Test representative strings:

```tsx
expect(screen.getByText("Teaminformationen")).toBeTruthy();
expect(screen.getByText("Teammitglieder")).toBeTruthy();
expect(screen.queryByText("Team Information")).toBeNull();
```

- [ ] **Step 2: Localize team detail section strings**

In `page-sections.tsx`, add `useTranslate()` or accept a `t` prop from the route client and wrap:

```tsx
<CardTitle>{t("settings.teams.detail.teamInformation", "Team Information")}</CardTitle>
<Label>{t("settings.teams.detail.teamName", "Team Name")}</Label>
<Input placeholder={t("settings.teams.detail.teamNamePlaceholder", "Enter team name")} />
<CardTitle>{t("settings.teams.detail.teamMembers", "Team Members")}</CardTitle>
```

- [ ] **Step 3: Localize add/remove/delete dialogs**

Wrap ActionPanel and AlertDialog copy:

```tsx
<ActionPanelTitle>{t("settings.teams.detail.addMember", "Add Team Member")}</ActionPanelTitle>
<ActionPanelDescription>{t("settings.teams.detail.addMemberDescription", "Select an employee to add to this team")}</ActionPanelDescription>
<AlertDialogTitle>{t("settings.teams.detail.removeMember", "Remove Team Member")}</AlertDialogTitle>
<AlertDialogTitle>{t("settings.teams.detail.deleteTeam", "Delete Team")}</AlertDialogTitle>
```

- [ ] **Step 4: Localize team detail toasts and validation**

In `page.tsx`:

```tsx
toast.success(t("settings.teams.detail.updateSuccess", "Team updated successfully"));
toast.success(t("settings.teams.detail.memberAdded", "Team member added successfully"));
toast.error(t("settings.teams.detail.selectEmployee", "Please select an employee"));
```

- [ ] **Step 5: Verify team detail test**

Run:

```bash
pnpm test "src/app/[locale]/(app)/settings/teams/[teamId]/page-sections.test.tsx"
```

Expected: test fails before implementation and passes after implementation.

## Task 4: Vacation Employee Settings

**Files:**

- Modify: `apps/webapp/src/app/[locale]/(app)/settings/vacation/employees/page.tsx`
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/vacation/employees/[employeeId]/page.tsx`

- [ ] **Step 1: Localize vacation employee list**

Wrap table headers and empty states:

```tsx
<h3 className="mt-4 text-lg font-semibold">{t("settings.vacation.employees.empty", "No employees found")}</h3>
<TableHead>{t("settings.vacation.employees.table.employee", "Employee")}</TableHead>
<TableHead className="text-right">{t("settings.vacation.employees.table.defaultDays", "Default Days")}</TableHead>
```

- [ ] **Step 2: Localize vacation employee detail toasts**

In `[employeeId]/page.tsx`:

```tsx
toast.success(t("settings.vacation.employees.detail.updateSuccess", "Employee allowance updated successfully"));
toast.error(t("settings.vacation.employees.detail.unexpectedError", "An unexpected error occurred"));
```

- [ ] **Step 3: Localize vacation employee detail cards and form**

Wrap labels and placeholders:

```tsx
<CardTitle>{t("settings.vacation.employees.detail.employeeInformation", "Employee Information")}</CardTitle>
<Label>{t("settings.vacation.employees.detail.assignedPolicy", "Assigned Policy")}</Label>
<SelectValue placeholder={t("settings.vacation.employees.detail.useDefaultPolicy", "Use organization/team default")} />
<h3 className="text-lg font-semibold">{t("settings.vacation.employees.detail.addManualAdjustment", "Add Manual Adjustment")}</h3>
```

- [ ] **Step 4: Run focused vacation checks**

Run any existing vacation settings tests. If none exist, run TypeScript and manually inspect the two files for remaining hardcoded strings with:

```bash
pnpm exec tsc --noEmit --pretty false
```

Expected: type check passes.

## Task 5: Notification Integration Settings

**Files:**

- Modify: `apps/webapp/src/app/[locale]/(app)/settings/slack/page.tsx`
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/discord/page.tsx`
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/teams-notifications/page.tsx`
- Modify: `apps/webapp/src/components/settings/notification-channel-settings.tsx`

- [ ] **Step 1: Localize integration route headings where needed**

Wrap non-product explanatory headings/descriptions. Product names can remain literal when they are pure names:

```tsx
<h1 className="text-2xl font-semibold">Slack</h1>
```

Keep pure product names unchanged.

- [ ] **Step 2: Localize notification channel settings**

In `notification-channel-settings.tsx`, wrap status and feature labels:

```tsx
const statusLabel = config
	? isActive
		? t("settings.notifications.status.active", "Active")
		: config.setupStatus
	: t("settings.notifications.status.notConfigured", "Not configured");

<CardTitle>{t("settings.notifications.featureSettings", "Feature Settings")}</CardTitle>
<Label htmlFor="digestTime">{t("settings.notifications.digestTime", "Digest time")}</Label>
<Label htmlFor="digestTimezone">{t("settings.notifications.timezone", "Timezone")}</Label>
```

- [ ] **Step 3: Localize notification toasts**

Use interpolation for channel name:

```tsx
toast.success(
	t("settings.notifications.saved", "{channelName} notification settings saved", { channelName }),
);
```

- [ ] **Step 4: Run notification settings tests**

Run:

```bash
pnpm test "src/components/settings/notification-channel-settings.test.tsx"
```

Expected: tests pass after updating expectations to fallback strings where necessary.

## Task 6: Enterprise Identity Settings

**Files:**

- Modify: `apps/webapp/src/components/settings/enterprise/identity-setup-wizard.tsx`
- Modify: `apps/webapp/src/components/settings/enterprise/identity-setup-wizard.test.tsx`
- Modify: `apps/webapp/src/components/settings/enterprise/domains-branding-tabs.tsx`

- [ ] **Step 1: Write failing i18n assertions for the wizard**

Extend `identity-setup-wizard.test.tsx` to mock German copy for representative strings and assert previous English does not appear:

```tsx
expect(screen.getByText("Enterprise-Identität")).toBeTruthy();
expect(screen.getByText("Betriebliche Checkliste")).toBeTruthy();
expect(screen.queryByText("Operational command checklist")).toBeNull();
```

- [ ] **Step 2: Convert wizard step and badge labels**

Change static step definitions from display labels to keys/defaults:

```tsx
const STEPS = [
	{
		id: "provider",
		labelKey: "settings.enterprise.identity.steps.provider",
		label: "Provider",
	},
];

<span>{t(step.labelKey, step.label)}</span>
```

Convert badges:

```tsx
if (status === "complete") return <Badge variant="secondary">{t("settings.enterprise.identity.ready", "Ready")}</Badge>;
if (status === "current") return <Badge>{t("settings.enterprise.identity.now", "Now")}</Badge>;
return <Badge variant="outline">{t("settings.enterprise.identity.queued", "Queued")}</Badge>;
```

- [ ] **Step 3: Convert wizard toasts, labels, placeholders, and cards**

Wrap representative copy:

```tsx
toast.success(t("settings.enterprise.identity.providerSaved", "Identity provider saved"));
<p className="font-medium text-primary text-sm">{t("settings.enterprise.identity.eyebrow", "Enterprise identity")}</p>
<Label htmlFor="identity-provider-preset">{t("settings.enterprise.identity.providerPreset", "Provider preset")}</Label>
<SelectValue placeholder={t("settings.enterprise.identity.selectProvider", "Select provider")} />
```

- [ ] **Step 4: Convert enterprise domains guided setup copy**

In `domains-branding-tabs.tsx`:

```tsx
<h3 className="font-medium">{t("settings.enterprise.domains.guidedSetup", "Guided setup")}</h3>
<Link href="/settings/enterprise/identity-setup">{t("settings.enterprise.domains.guidedSetup", "Guided setup")}</Link>
```

- [ ] **Step 5: Run wizard tests**

Run:

```bash
pnpm test "src/components/settings/enterprise/identity-setup-wizard.test.tsx"
```

Expected: all wizard tests pass.

## Task 7: Approval Policy Settings

**Files:**

- Modify: `apps/webapp/src/components/settings/approval-policy-management.tsx`
- Modify: `apps/webapp/src/components/settings/approval-policy-dialog.tsx`
- Modify: `apps/webapp/src/components/settings/approval-policy-preview.tsx`
- Modify: `apps/webapp/src/components/settings/employee-group-management.tsx`
- Test: `apps/webapp/src/components/settings/approval-policy-dialog.test.tsx`

- [ ] **Step 1: Localize management headings, toasts, and table headers**

```tsx
toast.success(t("settings.approvalPolicies.created", "Approval policy created"));
toast.error(t("settings.approvalPolicies.saveFailed", "Approval policy could not be saved."));
<h1 className="text-2xl font-semibold tracking-tight">{t("settings.approvalPolicies.title", "Approval Policies")}</h1>
<TableHead>{t("settings.approvalPolicies.table.priority", "Priority")}</TableHead>
```

- [ ] **Step 2: Localize dialog option arrays**

For arrays containing labels like `Absence requests`, `Time entry changes`, `Direct manager`, and `Organization admin`, store key/default pairs and resolve inside render:

```tsx
const requestTypeOptions = [
	{
		value: "absence",
		labelKey: "settings.approvalPolicies.requestTypes.absence",
		label: "Absence requests",
	},
];
```

- [ ] **Step 3: Localize preview and employee groups**

```tsx
<CardTitle>{t("settings.approvalPolicies.preview.title", "Preview chain summary")}</CardTitle>
<CardTitle>{t("settings.employeeGroups.title", "Employee Groups")}</CardTitle>
<TableHead>{t("settings.employeeGroups.table.members", "Members")}</TableHead>
```

- [ ] **Step 4: Run approval policy tests**

Run:

```bash
pnpm test "src/components/settings/approval-policy-dialog.test.tsx"
```

Expected: tests pass after expectation updates.

## Task 8: Account And Security Settings

**Files:**

- Modify: `apps/webapp/src/components/settings/profile-form.tsx`
- Modify: `apps/webapp/src/components/settings/profile-form.test.tsx`
- Modify: `apps/webapp/src/components/settings/two-factor-setup.tsx`
- Modify: `apps/webapp/src/components/settings/session-management.tsx` if hardcoded settings copy is found during the sweep
- Modify: `apps/webapp/src/components/settings/week-start-settings.tsx`
- Modify: `apps/webapp/src/components/settings/email-templates/email-template-settings-client.tsx`

- [ ] **Step 1: Localize profile form visible copy**

```tsx
<h3 className="text-lg font-medium">{t("settings.profile.personalInformation", "Personal Information")}</h3>
<TFormLabel hasError={hasError}>{t("settings.profile.firstName", "First Name")}</TFormLabel>
<Label id="gender-label">{t("settings.profile.gender", "Gender")}</Label>
<span className="text-sm font-medium">{t("settings.profile.genderMale", "Male")}</span>
```

- [ ] **Step 2: Localize 2FA toasts and headings**

```tsx
toast.error(t("settings.security.twoFactor.passwordRequired", "Password required"));
toast.success(t("settings.security.twoFactor.enabled", "Two-factor authentication enabled"));
<CardTitle>{t("settings.security.twoFactor.title", "Two-Factor Authentication")}</CardTitle>
```

- [ ] **Step 3: Localize week start settings**

```tsx
toast.error(t("settings.weekStart.updateError", "An error occurred while updating week start day"));
toast.success(t("settings.weekStart.updateSuccess", "Week start day updated successfully"));
<CardTitle>{t("settings.weekStart.title", "Week Starts On")}</CardTitle>
```

- [ ] **Step 4: Localize email template settings**

```tsx
toast.error(t("settings.emailTemplates.editBodyBeforeSave", "Edit the email body before saving a first custom template."));
<p className="font-medium text-primary text-sm">{t("settings.emailTemplates.operationalCommunications", "Operational communications")}</p>
<CardTitle className="text-base">{t("settings.emailTemplates.systemTemplates", "System templates")}</CardTitle>
```

- [ ] **Step 5: Run focused account/security tests**

Run:

```bash
pnpm test "src/components/settings/profile-form.test.tsx" "src/components/settings/session-management.test.tsx" "src/components/settings/email-templates/email-template-settings-client.test.tsx"
```

Expected: all selected tests pass. If a listed test file is not affected by the final diff, it can still run as a guard.

## Task 9: Miscellaneous Settings Routes

**Files:**

- Modify: `apps/webapp/src/app/[locale]/(app)/settings/implementation-checklist/implementation-checklist-client.tsx`
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/error.tsx`
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/avv/page.tsx`

- [ ] **Step 1: Localize implementation checklist copy**

```tsx
<p className="font-medium text-muted-foreground text-sm">{t("settings.implementationChecklist.eyebrow", "Customer implementation")}</p>
<h1 className="text-balance font-semibold text-2xl tracking-tight">{t("settings.implementationChecklist.title", "Implementation checklist")}</h1>
<CardDescription>{t("settings.implementationChecklist.setupProgress", "Setup progress")}</CardDescription>
```

- [ ] **Step 2: Localize settings error page**

```tsx
<CardTitle>{t("settings.error.title", "Something went wrong")}</CardTitle>
```

- [ ] **Step 3: Localize AVV page static German copy**

Wrap the German headings because they are still static UI copy:

```tsx
<h1 className="text-2xl font-semibold">
	{t("settings.avv.title", "Auftragsverarbeitungsvertrag (AVV)")}
</h1>
<CardTitle>{t("settings.avv.contractDetails", "Vertragsdetails")}</CardTitle>
```

Do not wrap company names or country names used as legal entity data unless they are labels.

- [ ] **Step 4: Run implementation checklist test**

Run:

```bash
pnpm test "src/app/[locale]/(app)/settings/implementation-checklist/implementation-checklist-client.test.tsx"
```

Expected: test passes after expectation updates.

## Task 10: Static String Sweep And Final Verification

**Files:**

- Inspect all modified settings files.

- [ ] **Step 1: Search settings routes for remaining obvious static strings**

Run:

```bash
pnpm exec biome check "src/app/[locale]/(app)/settings" "src/components/settings"
```

Expected: no Biome errors. Warnings unrelated to this i18n sweep can remain if pre-existing.

- [ ] **Step 2: Run focused grep audit**

Run:

```bash
rg 'toast\.(success|error|info|warning)\("|>[A-Z][A-Za-z ,&'"'"'’/()?-]{2,}<|placeholder="[A-Z]' 'apps/webapp/src/app/[locale]/(app)/settings' apps/webapp/src/components/settings
```

Expected: remaining matches are either `t()` fallback strings, tests, proper nouns, example values, code tokens, or explicitly out-of-scope data values. Manually inspect every remaining match.

- [ ] **Step 3: Confirm message JSON files are untouched**

Run:

```bash
git diff --name-only -- apps/webapp/messages
```

Expected: no output.

- [ ] **Step 4: Run focused test set**

Run all tests touched by this sweep:

```bash
pnpm test \
  "src/app/[locale]/(app)/settings/employees/[employeeId]/page-sections.test.tsx" \
  "src/app/[locale]/(app)/settings/implementation-checklist/implementation-checklist-client.test.tsx" \
  "src/components/settings/notification-channel-settings.test.tsx" \
  "src/components/settings/enterprise/identity-setup-wizard.test.tsx" \
  "src/components/settings/approval-policy-dialog.test.tsx" \
  "src/components/settings/profile-form.test.tsx" \
  "src/components/settings/session-management.test.tsx" \
  "src/components/settings/email-templates/email-template-settings-client.test.tsx"
```

Expected: all selected tests pass. If a newly added test is not listed above, include it in this command.

- [ ] **Step 5: Run TypeScript**

Run:

```bash
pnpm exec tsc --noEmit --pretty false
```

Expected: exit code 0.

- [ ] **Step 6: Run React Doctor diff scan**

Run:

```bash
npx -y react-doctor@latest . --verbose --diff
```

Expected: score does not regress because of this i18n sweep. Fix warnings introduced by touched code when they are small and behavior-preserving. Do not refactor unrelated existing warnings.

- [ ] **Step 7: Summarize remaining intentional static strings**

In the final response, list any remaining static strings in Settings that were intentionally left because they are product names, legal entity data, URLs, IDs, examples, or tests.

## Self-Review

Spec coverage:

- Settings-only scope is implemented by Tasks 1-10.
- No message JSON edits is explicitly enforced by Tasks 1 and 10.
- Static literal Tolgee keys are required in the common pattern and every task example.
- High-risk views have focused test instructions.

Placeholder scan:

- No TBD/TODO placeholders remain.
- Every task includes exact files, code shape, and commands.

Type consistency:

- Translation access consistently uses `useTranslate()` and `t(key, fallback, values?)`.
- Option array examples consistently use `labelKey` and `label` literal properties.

## Execution Notes

Do not commit during implementation unless the user explicitly asks for a commit. The original planning skill recommends frequent commits, but repository instructions prohibit unsolicited commits.
