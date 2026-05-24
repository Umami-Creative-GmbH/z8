# Personal Command Palette Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the existing `AppSearch` into a translated, permission-aware command palette with route-first action commands.

**Architecture:** Keep `AppSearch` as the only global overlay. Add an `action` result type and a focused static command builder, then wire translated commands through `AppSidebar` into the existing command dialog. V1 commands navigate to existing pages rather than mutating server state or opening dialogs.

**Tech Stack:** Next.js App Router, React, TypeScript, Tolgee `t()`, `@tanstack/react-hotkeys`, shadcn-style `CommandDialog`, Vitest, Testing Library, pnpm.

---

## File Structure

- Modify `apps/webapp/src/lib/app-search/types.ts`: add the `action` result type and a reusable static command input type.
- Create `apps/webapp/src/lib/app-search/static-commands.ts`: define translated route-first command descriptors, visibility rules, and `buildStaticAppCommands`.
- Create `apps/webapp/src/lib/app-search/static-commands.test.ts`: cover translated labels, role/access visibility, feature-flag filtering, and stable action result shape.
- Modify `apps/webapp/src/components/app-search.tsx`: accept `staticCommands`, render an `Actions` group first, update copy through `t()`, and keep selection behavior route-based.
- Modify `apps/webapp/src/components/app-search.test.tsx`: cover action rendering, ordering, navigation, and translated command palette copy.
- Modify `apps/webapp/src/components/app-sidebar.tsx`: build translated commands and pass them to `AppSearch`.
- Modify `apps/webapp/src/components/app-sidebar.test.tsx`: update the `AppSearch` mock signature and assert command data is passed with translated labels.

## Task 1: Add App Search Command Types

**Files:**
- Modify: `apps/webapp/src/lib/app-search/types.ts`

- [ ] **Step 1: Write the failing type-level test through the command builder test file**

Create `apps/webapp/src/lib/app-search/static-commands.test.ts` with this initial test. It intentionally imports a builder that does not exist yet and expects action results to be typed with `type: "action"`.

```ts
import { describe, expect, it } from "vitest";
import { buildStaticAppCommands } from "./static-commands";

const t = (_key: string, defaultValue: string) => defaultValue;

describe("buildStaticAppCommands", () => {
	it("returns translated employee action commands", () => {
		const commands = buildStaticAppCommands({
			t,
			employeeRole: "employee",
			settingsAccessTier: "member",
			billingEnabled: true,
			showComplianceNav: false,
			featureFlags: {
				shiftsEnabled: false,
				projectsEnabled: false,
				surchargesEnabled: false,
				demoDataEnabled: false,
			},
		});

		expect(commands).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					type: "action",
					id: "action:add-manual-time-entry",
					title: "Add manual time entry",
					href: "/time-tracking",
				}),
			]),
		);
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter webapp test src/lib/app-search/static-commands.test.ts`

Expected: FAIL with an import/module error for `./static-commands`.

- [ ] **Step 3: Extend app-search types**

Modify `apps/webapp/src/lib/app-search/types.ts` to include `action` and add a named alias for command builder input.

```ts
import type { FeatureFlagState } from "@/components/settings/settings-config";
import type { SettingsAccessTier } from "@/lib/settings-access";

export type AppSearchResultType = "page" | "setting" | "employee" | "team" | "action";

export interface AppSearchResult {
	type: AppSearchResultType;
	id: string;
	title: string;
	subtitle?: string;
	keywords?: string[];
	href: string;
}

export type AppSearchTranslate = (key: string, defaultValue: string) => string;

export type AppSearchEmployeeRole = "admin" | "manager" | "employee" | null;

export interface StaticAppSearchInput {
	t: AppSearchTranslate;
	employeeRole: AppSearchEmployeeRole;
	settingsAccessTier: SettingsAccessTier;
	billingEnabled: boolean;
	showComplianceNav: boolean;
	featureFlags?: FeatureFlagState;
}

export type StaticAppCommandInput = StaticAppSearchInput;

export interface LiveAppSearchResults {
	employees: AppSearchResult[];
	teams: AppSearchResult[];
}
```

- [ ] **Step 4: Run test again to confirm the remaining failure is the missing builder**

Run: `pnpm --filter webapp test src/lib/app-search/static-commands.test.ts`

Expected: FAIL with an import/module error for `./static-commands`, not a TypeScript union error.

- [ ] **Step 5: Keep the test red for Task 2**

Do not commit this task by itself. The test still fails because the builder is intentionally missing. Task 2 adds the builder and creates the first passing commit.

## Task 2: Build Translated Static Commands

**Files:**
- Create: `apps/webapp/src/lib/app-search/static-commands.ts`
- Modify: `apps/webapp/src/lib/app-search/static-commands.test.ts`

- [ ] **Step 1: Expand failing tests for translation and visibility**

Replace `apps/webapp/src/lib/app-search/static-commands.test.ts` with the full test set.

```ts
import { describe, expect, it } from "vitest";
import { buildStaticAppCommands } from "./static-commands";

const t = (_key: string, defaultValue: string) => defaultValue;

const enabledFeatures = {
	shiftsEnabled: true,
	projectsEnabled: true,
	surchargesEnabled: true,
	demoDataEnabled: true,
};

describe("buildStaticAppCommands", () => {
	it("returns translated employee action commands", () => {
		const commands = buildStaticAppCommands({
			t,
			employeeRole: "employee",
			settingsAccessTier: "member",
			billingEnabled: true,
			showComplianceNav: false,
			featureFlags: enabledFeatures,
		});

		expect(commands).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					type: "action",
					id: "action:add-manual-time-entry",
					title: "Add manual time entry",
					subtitle: "Record work time for a past or current day",
					href: "/time-tracking",
					keywords: expect.arrayContaining(["time", "manual", "Zeiteintrag"]),
				}),
				expect.objectContaining({
					id: "action:request-absence",
					href: "/absences",
				}),
				expect.objectContaining({
					id: "action:submit-travel-expense",
					href: "/travel-expenses",
				}),
				expect.objectContaining({
					id: "action:open-settings",
					href: "/settings",
				}),
			]),
		);
	});

	it("uses t() for command titles, subtitles, and keyword strings", () => {
		const commands = buildStaticAppCommands({
			t: (key, defaultValue) => `${key}:${defaultValue}`,
			employeeRole: "employee",
			settingsAccessTier: "member",
			billingEnabled: true,
			showComplianceNav: false,
			featureFlags: enabledFeatures,
		});

		expect(commands.find((command) => command.id === "action:add-manual-time-entry")).toMatchObject({
			title: "appSearch.actions.addManualTimeEntry.title:Add manual time entry",
			subtitle:
				"appSearch.actions.addManualTimeEntry.subtitle:Record work time for a past or current day",
		});
		expect(
			commands
				.find((command) => command.id === "action:request-absence")
				?.keywords?.some((keyword) => keyword.startsWith("appSearch.actions.requestAbsence.keyword")),
		).toBe(true);
	});

	it("shows manager commands only for managers and admins", () => {
		const employeeCommands = buildStaticAppCommands({
			t,
			employeeRole: "employee",
			settingsAccessTier: "member",
			billingEnabled: true,
			showComplianceNav: false,
			featureFlags: enabledFeatures,
		});
		const managerCommands = buildStaticAppCommands({
			t,
			employeeRole: "manager",
			settingsAccessTier: "manager",
			billingEnabled: true,
			showComplianceNav: false,
			featureFlags: enabledFeatures,
		});

		expect(employeeCommands.some((command) => command.id === "action:open-approvals-inbox")).toBe(
			false,
		);
		expect(managerCommands.some((command) => command.id === "action:open-approvals-inbox")).toBe(
			true,
		);
	});

	it("filters admin setting commands by settings access tier and feature flags", () => {
		const managerCommands = buildStaticAppCommands({
			t,
			employeeRole: "manager",
			settingsAccessTier: "manager",
			billingEnabled: true,
			showComplianceNav: false,
			featureFlags: enabledFeatures,
		});
		const adminCommands = buildStaticAppCommands({
			t,
			employeeRole: "admin",
			settingsAccessTier: "orgAdmin",
			billingEnabled: true,
			showComplianceNav: false,
			featureFlags: enabledFeatures,
		});

		expect(managerCommands.some((command) => command.id === "action:open-payroll-readiness")).toBe(
			false,
		);
		expect(managerCommands.some((command) => command.id === "action:create-project")).toBe(false);
		expect(adminCommands.some((command) => command.id === "action:open-payroll-readiness")).toBe(
			true,
		);
		expect(adminCommands.some((command) => command.id === "action:create-project")).toBe(true);
	});

	it("returns globally unique command ids", () => {
		const commands = buildStaticAppCommands({
			t,
			employeeRole: "admin",
			settingsAccessTier: "orgAdmin",
			billingEnabled: true,
			showComplianceNav: true,
			featureFlags: enabledFeatures,
		});

		const ids = commands.map((command) => command.id);
		expect(new Set(ids).size).toBe(ids.length);
	});
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter webapp test src/lib/app-search/static-commands.test.ts`

Expected: FAIL with an import/module error for `./static-commands`.

- [ ] **Step 3: Implement static command builder**

Create `apps/webapp/src/lib/app-search/static-commands.ts`.

```ts
import type { FeatureFlag } from "@/components/settings/settings-config";
import { hasSettingsAccessTier, type SettingsAccessTier } from "@/lib/settings-access";
import type { AppSearchResult, StaticAppCommandInput } from "./types";

type CommandRole = "employee" | "manager" | "admin";

interface StaticAppCommandDefinition {
	id: string;
	titleKey: string;
	titleDefault: string;
	subtitleKey: string;
	subtitleDefault: string;
	keywordKeys: string[];
	keywordDefaults: string[];
	href: string;
	minimumRole?: CommandRole;
	minimumSettingsTier?: SettingsAccessTier;
	requiredFeature?: FeatureFlag;
}

const ROLE_RANK: Record<CommandRole, number> = {
	employee: 0,
	manager: 1,
	admin: 2,
};

const COMMAND_DEFINITIONS: StaticAppCommandDefinition[] = [
	{
		id: "add-manual-time-entry",
		titleKey: "appSearch.actions.addManualTimeEntry.title",
		titleDefault: "Add manual time entry",
		subtitleKey: "appSearch.actions.addManualTimeEntry.subtitle",
		subtitleDefault: "Record work time for a past or current day",
		keywordKeys: [
			"appSearch.actions.addManualTimeEntry.keyword.time",
			"appSearch.actions.addManualTimeEntry.keyword.manual",
			"appSearch.actions.addManualTimeEntry.keyword.germanTimeEntry",
		],
		keywordDefaults: ["time", "manual", "Zeiteintrag"],
		href: "/time-tracking",
	},
	{
		id: "request-absence",
		titleKey: "appSearch.actions.requestAbsence.title",
		titleDefault: "Request absence",
		subtitleKey: "appSearch.actions.requestAbsence.subtitle",
		subtitleDefault: "Create a vacation, sick leave, or time off request",
		keywordKeys: [
			"appSearch.actions.requestAbsence.keyword.absence",
			"appSearch.actions.requestAbsence.keyword.vacation",
			"appSearch.actions.requestAbsence.keyword.germanVacation",
			"appSearch.actions.requestAbsence.keyword.germanAbsence",
		],
		keywordDefaults: ["absence", "vacation", "Urlaub", "Abwesenheit"],
		href: "/absences",
	},
	{
		id: "submit-travel-expense",
		titleKey: "appSearch.actions.submitTravelExpense.title",
		titleDefault: "Submit travel expense",
		subtitleKey: "appSearch.actions.submitTravelExpense.subtitle",
		subtitleDefault: "Start a travel expense claim",
		keywordKeys: [
			"appSearch.actions.submitTravelExpense.keyword.expense",
			"appSearch.actions.submitTravelExpense.keyword.receipt",
			"appSearch.actions.submitTravelExpense.keyword.germanExpense",
		],
		keywordDefaults: ["expense", "receipt", "Reisekosten"],
		href: "/travel-expenses",
	},
	{
		id: "open-my-requests",
		titleKey: "appSearch.actions.openMyRequests.title",
		titleDefault: "Open my requests",
		subtitleKey: "appSearch.actions.openMyRequests.subtitle",
		subtitleDefault: "Review your submitted requests and decisions",
		keywordKeys: [
			"appSearch.actions.openMyRequests.keyword.requests",
			"appSearch.actions.openMyRequests.keyword.status",
		],
		keywordDefaults: ["requests", "status"],
		href: "/my-requests",
	},
	{
		id: "open-approvals-inbox",
		titleKey: "appSearch.actions.openApprovalsInbox.title",
		titleDefault: "Open approvals inbox",
		subtitleKey: "appSearch.actions.openApprovalsInbox.subtitle",
		subtitleDefault: "Review requests waiting for a decision",
		keywordKeys: [
			"appSearch.actions.openApprovalsInbox.keyword.approvals",
			"appSearch.actions.openApprovalsInbox.keyword.inbox",
			"appSearch.actions.openApprovalsInbox.keyword.germanApprovals",
		],
		keywordDefaults: ["approvals", "inbox", "Freigaben"],
		href: "/approvals/inbox",
		minimumRole: "manager",
	},
	{
		id: "invite-teammate",
		titleKey: "appSearch.actions.inviteTeammate.title",
		titleDefault: "Invite teammate",
		subtitleKey: "appSearch.actions.inviteTeammate.subtitle",
		subtitleDefault: "Open organization management to invite a colleague",
		keywordKeys: [
			"appSearch.actions.inviteTeammate.keyword.invite",
			"appSearch.actions.inviteTeammate.keyword.member",
			"appSearch.actions.inviteTeammate.keyword.germanInvite",
		],
		keywordDefaults: ["invite", "member", "Einladung"],
		href: "/organization",
		minimumRole: "manager",
	},
	{
		id: "create-project",
		titleKey: "appSearch.actions.createProject.title",
		titleDefault: "Create project",
		subtitleKey: "appSearch.actions.createProject.subtitle",
		subtitleDefault: "Open project settings to add project work",
		keywordKeys: [
			"appSearch.actions.createProject.keyword.project",
			"appSearch.actions.createProject.keyword.customer",
		],
		keywordDefaults: ["project", "customer"],
		href: "/settings/projects",
		minimumSettingsTier: "orgAdmin",
		requiredFeature: "projectsEnabled",
	},
	{
		id: "open-payroll-readiness",
		titleKey: "appSearch.actions.openPayrollReadiness.title",
		titleDefault: "Open payroll readiness",
		subtitleKey: "appSearch.actions.openPayrollReadiness.subtitle",
		subtitleDefault: "Check whether a payroll period is ready for export",
		keywordKeys: [
			"appSearch.actions.openPayrollReadiness.keyword.payroll",
			"appSearch.actions.openPayrollReadiness.keyword.export",
			"appSearch.actions.openPayrollReadiness.keyword.germanPayroll",
		],
		keywordDefaults: ["payroll", "export", "Lohnabrechnung"],
		href: "/settings/payroll-readiness",
		minimumSettingsTier: "orgAdmin",
	},
	{
		id: "open-settings",
		titleKey: "appSearch.actions.openSettings.title",
		titleDefault: "Open settings",
		subtitleKey: "appSearch.actions.openSettings.subtitle",
		subtitleDefault: "Manage your profile, security, and organization settings",
		keywordKeys: [
			"appSearch.actions.openSettings.keyword.settings",
			"appSearch.actions.openSettings.keyword.preferences",
			"appSearch.actions.openSettings.keyword.germanSettings",
		],
		keywordDefaults: ["settings", "preferences", "Einstellungen"],
		href: "/settings",
	},
];

function canUseRole(
	employeeRole: StaticAppCommandInput["employeeRole"],
	minimumRole: CommandRole | undefined,
): boolean {
	if (!minimumRole) {
		return true;
	}

	if (!employeeRole) {
		return false;
	}

	return ROLE_RANK[employeeRole] >= ROLE_RANK[minimumRole];
}

function canUseCommand(
	definition: StaticAppCommandDefinition,
	input: Omit<StaticAppCommandInput, "t">,
): boolean {
	if (!canUseRole(input.employeeRole, definition.minimumRole)) {
		return false;
	}

	if (
		definition.minimumSettingsTier &&
		!hasSettingsAccessTier(input.settingsAccessTier, definition.minimumSettingsTier)
	) {
		return false;
	}

	if (definition.requiredFeature && !input.featureFlags?.[definition.requiredFeature]) {
		return false;
	}

	return true;
}

export function buildStaticAppCommands({
	t,
	employeeRole,
	settingsAccessTier,
	billingEnabled,
	showComplianceNav,
	featureFlags,
}: StaticAppCommandInput): AppSearchResult[] {
	return COMMAND_DEFINITIONS.filter((definition) =>
		canUseCommand(definition, {
			employeeRole,
			settingsAccessTier,
			billingEnabled,
			showComplianceNav,
			featureFlags,
		}),
	).map((definition) => ({
		type: "action",
		id: `action:${definition.id}`,
		title: t(definition.titleKey, definition.titleDefault),
		subtitle: t(definition.subtitleKey, definition.subtitleDefault),
		keywords: definition.keywordKeys.map((key, index) =>
			t(key, definition.keywordDefaults[index] ?? key),
		),
		href: definition.href,
	}));
}
```

- [ ] **Step 4: Run static command tests**

Run: `pnpm --filter webapp test src/lib/app-search/static-commands.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/webapp/src/lib/app-search/types.ts apps/webapp/src/lib/app-search/static-commands.ts apps/webapp/src/lib/app-search/static-commands.test.ts
git commit -m "feat: build static app commands"
```

## Task 3: Render Actions In AppSearch

**Files:**
- Modify: `apps/webapp/src/components/app-search.tsx`
- Modify: `apps/webapp/src/components/app-search.test.tsx`

- [ ] **Step 1: Update component tests for command palette behavior**

Modify `apps/webapp/src/components/app-search.test.tsx` with these focused changes.

Update the static test data and render helper near the top:

```ts
const staticResults: AppSearchResult[] = [
	{
		type: "page",
		id: "dashboard",
		title: "Dashboard",
		subtitle: "Overview",
		href: "/dashboard",
	},
	{
		type: "setting",
		id: "employees",
		title: "Employees",
		subtitle: "Manage people",
		href: "/settings/employees",
	},
];

const staticCommands: AppSearchResult[] = [
	{
		type: "action",
		id: "action:add-manual-time-entry",
		title: "Add manual time entry",
		subtitle: "Record work time for a past or current day",
		keywords: ["time", "manual", "Zeiteintrag"],
		href: "/time-tracking",
	},
];

const searchPlaceholder = "Search pages, people, teams, settings, or actions…";

function renderAppSearch(results = staticResults, commands = staticCommands) {
	return render(
		<SidebarProvider>
			<AppSearch staticCommands={commands} staticResults={results} />
		</SidebarProvider>,
	);
}
```

Update the first test to expect the new trigger label and static navigation still works:

```ts
it("opens from the trigger button and navigates to a static result", async () => {
	renderAppSearch();

	fireEvent.click(screen.getByRole("button", { name: /search or run command/i }));
	fireEvent.click(screen.getByText("Dashboard"));

	expect(pushMock).toHaveBeenCalledWith("/dashboard");
	expect(screen.queryByPlaceholderText(searchPlaceholder)).toBeNull();
});
```

Add these new tests after the static keyword test:

```ts
it("renders actions before live results, pages, and settings", async () => {
	searchAppRecordsActionMock.mockResolvedValue({
		success: true,
		data: {
			employees: [
				{
					type: "employee",
					id: "employee-1",
					title: "Alex Morgan",
					href: "/settings/employees/employee-1",
				},
			],
			teams: [
				{
					type: "team",
					id: "team-1",
					title: "Operations",
					href: "/settings/teams/team-1",
				},
			],
		},
	});
	renderAppSearch();

	fireEvent.click(screen.getByRole("button", { name: /search or run command/i }));
	fireEvent.change(screen.getByPlaceholderText(searchPlaceholder), {
		target: { value: "op" },
	});
	await act(async () => {
		await vi.advanceTimersByTimeAsync(250);
	});

	const groupHeadings = screen
		.getAllByText(/^(Actions|People|Teams|Pages|Settings)$/)
		.map((heading) => heading.textContent);

	expect(groupHeadings).toEqual(["Actions", "People", "Teams", "Pages", "Settings"]);
});

it("navigates when selecting an action command", () => {
	renderAppSearch();

	fireEvent.click(screen.getByRole("button", { name: /search or run command/i }));
	fireEvent.click(screen.getByText("Add manual time entry"));

	expect(pushMock).toHaveBeenCalledWith("/time-tracking");
	expect(screen.queryByPlaceholderText(searchPlaceholder)).toBeNull();
});
```

Update existing test selectors that click the trigger or placeholder to use `searchPlaceholder` and `/search or run command/i`. The existing ordering test should now expect `Actions` first:

```ts
expect(groupHeadings).toEqual(["Actions", "People", "Teams", "Pages", "Settings"]);
```

- [ ] **Step 2: Run component test to verify it fails**

Run: `pnpm --filter webapp test src/components/app-search.test.tsx`

Expected: FAIL because `AppSearch` does not accept `staticCommands`, the placeholder still references search only, and no `Actions` group renders.

- [ ] **Step 3: Update AppSearch implementation**

Modify `apps/webapp/src/components/app-search.tsx`.

Replace `getGroupLabel` with this version:

```ts
function getGroupLabel(type: AppSearchResult["type"], t: ReturnType<typeof useTranslate>["t"]) {
	switch (type) {
		case "action":
			return t("appSearch.groups.actions", "Actions");
		case "page":
			return t("appSearch.groups.pages", "Pages");
		case "setting":
			return t("appSearch.groups.settings", "Settings");
		case "employee":
			return t("appSearch.groups.people", "People");
		case "team":
			return t("appSearch.groups.teams", "Teams");
	}
}
```

Change the component signature and add action filtering:

```ts
export function AppSearch({
	staticCommands,
	staticResults,
}: {
	staticCommands?: AppSearchResult[];
	staticResults: AppSearchResult[];
}) {
	const { t } = useTranslate();
	const router = useRouter();
	const [open, setOpen] = useState(false);
	const [query, setQuery] = useState("");
	const [liveResults, setLiveResults] = useState<LiveAppSearchResults>(EMPTY_LIVE_RESULTS);
	const [liveError, setLiveError] = useState<string | null>(null);

	const searchShortcutLabel = formatForDisplay(SEARCH_HOTKEY);
	const actionResults = staticCommands?.filter((result) => result.type === "action") ?? [];
	const pageResults = staticResults.filter((result) => result.type === "page");
	const settingResults = staticResults.filter((result) => result.type === "setting");
```

Remove the old `const pageResults` and `const settingResults` declarations later in the component to avoid duplicates.

Update trigger and dialog copy:

```tsx
<SidebarMenuButton
	onClick={() => setOpen(true)}
	tooltip={t("appSearch.searchOrRunCommand", "Search or run command")}
	type="button"
>
	<IconSearch />
	<span>{t("appSearch.searchOrRunCommand", "Search or run command")}</span>
	<Kbd className="ml-auto hidden bg-sidebar-accent text-sidebar-accent-foreground group-data-[collapsible=icon]:hidden sm:inline-flex">
		{searchShortcutLabel}
	</Kbd>
</SidebarMenuButton>
```

```tsx
<CommandDialog
	description={t(
		"appSearch.commandDescription",
		"Search pages, people, teams, settings, or actions",
	)}
	onOpenChange={setOpen}
	open={open}
	title={t("appSearch.searchOrRunCommand", "Search or run command")}
>
	<CommandInput
		aria-label={t(
			"appSearch.commandDescription",
			"Search pages, people, teams, settings, or actions",
		)}
		onValueChange={setQuery}
		placeholder={t(
			"appSearch.commandPlaceholder",
			"Search pages, people, teams, settings, or actions…",
		)}
		value={query}
	/>
```

Render the action group before live results:

```tsx
<CommandList>
	<CommandEmpty>{t("appSearch.empty", "No results found.")}</CommandEmpty>
	<ResultGroup
		label={getGroupLabel("action", t)}
		onSelect={handleSelect}
		results={actionResults}
	/>
	<ResultGroup
		label={getGroupLabel("employee", t)}
		onSelect={handleSelect}
		results={liveResults.employees}
	/>
```

- [ ] **Step 4: Run component test**

Run: `pnpm --filter webapp test src/components/app-search.test.tsx`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/webapp/src/components/app-search.tsx apps/webapp/src/components/app-search.test.tsx
git commit -m "feat: render app command actions"
```

## Task 4: Wire Commands Through AppSidebar

**Files:**
- Modify: `apps/webapp/src/components/app-sidebar.tsx`
- Modify: `apps/webapp/src/components/app-sidebar.test.tsx`

- [ ] **Step 1: Update sidebar tests for command wiring**

In `apps/webapp/src/components/app-sidebar.test.tsx`, update the mock to capture both props:

```ts
vi.mock("@/components/app-search", () => ({
	AppSearch: ({
		staticCommands,
		staticResults,
	}: {
		staticCommands: Array<{ href: string; title: string; type: string }>;
		staticResults: Array<{ href: string; title: string }>;
	}) => {
		appSearchSpy({ staticCommands, staticResults });
		return <button type="button">Search or run command</button>;
	},
}));
```

Update the employee search test expectation:

```ts
expect(screen.getByRole("button", { name: "Search or run command" })).toBeTruthy();
expect(appSearchSpy).toHaveBeenLastCalledWith(
	expect.objectContaining({
		staticResults: expect.arrayContaining([
			expect.objectContaining({ title: "Dashboard", href: "/" }),
			expect.objectContaining({ title: "Profile", href: "/settings/profile" }),
		]),
		staticCommands: expect.arrayContaining([
			expect.objectContaining({
				type: "action",
				title: "Add manual time entry",
				href: "/time-tracking",
			}),
		]),
	}),
);
expect(appSearchSpy).toHaveBeenLastCalledWith(
	expect.objectContaining({
		staticResults: expect.not.arrayContaining([
			expect.objectContaining({ href: "/settings/employees" }),
			expect.objectContaining({ href: "/settings/organizations" }),
		]),
	}),
);
```

Add a manager/admin command visibility assertion near the existing manager navigation tests:

```ts
it("passes manager command actions to search for managers", () => {
	render(<AppSidebar employeeRole="manager" settingsAccessTier="manager" />);

	expect(appSearchSpy).toHaveBeenLastCalledWith(
		expect.objectContaining({
			staticCommands: expect.arrayContaining([
				expect.objectContaining({ title: "Open approvals inbox", href: "/approvals/inbox" }),
			]),
		}),
	);
});
```

- [ ] **Step 2: Run sidebar test to verify it fails**

Run: `pnpm --filter webapp test src/components/app-sidebar.test.tsx`

Expected: FAIL because `AppSidebar` still passes only `staticResults`.

- [ ] **Step 3: Wire static commands into AppSidebar**

Modify `apps/webapp/src/components/app-sidebar.tsx`.

Add the import:

```ts
import { buildStaticAppCommands } from "@/lib/app-search/static-commands";
```

Build commands after `staticSearchResults`:

```ts
const staticSearchResults = buildStaticAppSearchResults({
	t: (key, defaultValue) => t(key, defaultValue),
	employeeRole,
	settingsAccessTier,
	billingEnabled,
	showComplianceNav,
	featureFlags,
});
const staticCommands = buildStaticAppCommands({
	t: (key, defaultValue) => t(key, defaultValue),
	employeeRole,
	settingsAccessTier,
	billingEnabled,
	showComplianceNav,
	featureFlags,
});
```

Pass commands into `AppSearch`:

```tsx
<AppSearch staticCommands={staticCommands} staticResults={staticSearchResults} />
```

- [ ] **Step 4: Run sidebar test**

Run: `pnpm --filter webapp test src/components/app-sidebar.test.tsx`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/webapp/src/components/app-sidebar.tsx apps/webapp/src/components/app-sidebar.test.tsx
git commit -m "feat: wire app commands into sidebar search"
```

## Task 5: Integration Verification And Cleanup

**Files:**
- Review: `apps/webapp/src/lib/app-search/types.ts`
- Review: `apps/webapp/src/lib/app-search/static-commands.ts`
- Review: `apps/webapp/src/components/app-search.tsx`
- Review: `apps/webapp/src/components/app-sidebar.tsx`

- [ ] **Step 1: Run focused app-search tests**

Run: `pnpm --filter webapp test src/lib/app-search/static-commands.test.ts src/lib/app-search/static-results.test.ts src/components/app-search.test.tsx src/components/app-sidebar.test.tsx`

Expected: PASS for all four test files.

- [ ] **Step 2: Run lint/type-oriented project check through the repo test command**

Run: `pnpm test -- --run apps/webapp/src/lib/app-search/static-commands.test.ts apps/webapp/src/components/app-search.test.tsx apps/webapp/src/components/app-sidebar.test.tsx`

Expected: PASS. If the workspace test runner does not accept explicit file paths after `--run`, use the focused command from Step 1 and record that the workspace-level filtered invocation is unsupported.

- [ ] **Step 3: Inspect command palette strings for hardcoded visible action labels**

Run: `pnpm --filter webapp test src/lib/app-search/static-commands.test.ts`

Expected: PASS, including `uses t() for command titles, subtitles, and keyword strings`.

- [ ] **Step 4: Check git diff**

Run: `git diff -- apps/webapp/src/lib/app-search/types.ts apps/webapp/src/lib/app-search/static-commands.ts apps/webapp/src/lib/app-search/static-commands.test.ts apps/webapp/src/components/app-search.tsx apps/webapp/src/components/app-search.test.tsx apps/webapp/src/components/app-sidebar.tsx apps/webapp/src/components/app-sidebar.test.tsx`

Expected: Diff only contains command palette type, builder, rendering, wiring, and tests. No unrelated files should be changed.

- [ ] **Step 5: Commit verification cleanup if Step 4 found small fixes**

If Step 4 required formatting or small corrections, commit them:

```bash
git add apps/webapp/src/lib/app-search/types.ts apps/webapp/src/lib/app-search/static-commands.ts apps/webapp/src/lib/app-search/static-commands.test.ts apps/webapp/src/components/app-search.tsx apps/webapp/src/components/app-search.test.tsx apps/webapp/src/components/app-sidebar.tsx apps/webapp/src/components/app-sidebar.test.tsx
git commit -m "test: verify app command palette"
```

If Step 4 found no changes after the previous commits, do not create an empty commit.

## Self-Review Notes

- Spec coverage: the plan extends existing `AppSearch`, adds translated static action commands, keeps route-first execution, filters by role/settings/feature flags, renders Actions before other groups, preserves live search, avoids mutations/destructive commands, and adds tests for translation and visibility.
- Placeholder scan: no task relies on unspecified behavior. Dialog-opening actions are explicitly excluded from V1 and represented as route navigation.
- Type consistency: `AppSearchResult.type` includes `action`; command builder returns `AppSearchResult[]`; `AppSearch` accepts `staticCommands?: AppSearchResult[]`; `AppSidebar` passes `staticCommands` and `staticResults` separately.
