# Compliance Command Center Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an org-admin-only top-level compliance overview that summarizes audit evidence, workforce policy compliance, and sensitive control changes from existing systems.

**Architecture:** Keep the implementation thin over current sources by adding a small `lib/compliance-command-center/*` aggregation layer, then render that normalized payload through a dedicated `/compliance` route. Reuse the existing sidebar, org-admin settings access tier, audit export data, audit log data, and compliance tables instead of creating new persistence or workflow engines.

**Tech Stack:** Next.js App Router, TypeScript, React, Luxon, Drizzle ORM, Vitest, React Testing Library.

---

## File Map

- `apps/webapp/src/components/app-sidebar.tsx`
  Adds the top-level `Compliance` nav item behind a server-provided org-admin flag.
- `apps/webapp/src/components/server-app-sidebar.tsx`
  Resolves the existing settings access tier and passes `showComplianceNav` into the client sidebar.
- `apps/webapp/src/components/app-sidebar.test.tsx`
  Locks the sidebar and server-sidebar wiring so the compliance entry only appears behind org-admin visibility.
- `apps/webapp/src/lib/compliance-command-center/types.ts`
  Defines the normalized command-center card, event, summary, and full page payload contract.
- `apps/webapp/src/lib/compliance-command-center/view-model.ts`
  Holds pure helpers for severity rollup, recent-event sorting, and final payload assembly.
- `apps/webapp/src/lib/compliance-command-center/view-model.test.ts`
  Verifies the shared contract math before any database-backed sections exist.
- `apps/webapp/src/lib/compliance-command-center/sections/audit-evidence.ts`
  Builds the audit-and-evidence card from audit export configuration, audit-pack requests, and verification history.
- `apps/webapp/src/lib/compliance-command-center/sections/access-controls.ts`
  Builds the sensitive control-changes card from recent audit-log events.
- `apps/webapp/src/lib/compliance-command-center/sections/workforce-compliance.ts`
  Builds the workforce-compliance card from `workPolicyViolation` and pending `complianceException` records.
- `apps/webapp/src/lib/compliance-command-center/sections/audit-evidence.test.ts`
  Covers section-state selection for audit evidence.
- `apps/webapp/src/lib/compliance-command-center/sections/access-controls.test.ts`
  Covers section-state selection for sensitive control changes.
- `apps/webapp/src/lib/compliance-command-center/sections/workforce-compliance.test.ts`
  Covers section-state selection for workforce policy risk.
- `apps/webapp/src/lib/compliance-command-center/loader.ts`
  Loads all three sections in parallel, derives recent critical events, and returns the normalized page payload.
- `apps/webapp/src/lib/compliance-command-center/loader.test.ts`
  Verifies loader orchestration and cross-section event assembly.
- `apps/webapp/src/app/[locale]/(app)/compliance/page.tsx`
  Top-level org-admin route that fetches the normalized payload and renders the page shell.
- `apps/webapp/src/app/[locale]/(app)/compliance/page.guard.test.ts`
  Source-based guard test that keeps the route on shared org-admin access helpers.
- `apps/webapp/src/components/compliance-command-center/compliance-command-center-page.tsx`
  Client page shell that renders the overview and periodically refreshes for mixed freshness.
- `apps/webapp/src/components/compliance-command-center/risk-summary-header.tsx`
  Displays overall status, headline, and last-refresh context.
- `apps/webapp/src/components/compliance-command-center/compliance-section-card.tsx`
  Displays one normalized section card.
- `apps/webapp/src/components/compliance-command-center/recent-critical-events-list.tsx`
  Renders the short cross-source recent-events list.
- `apps/webapp/src/components/compliance-command-center/coverage-footer.tsx`
  Renders the transparent coverage and freshness notes.
- `apps/webapp/src/components/compliance-command-center/compliance-command-center-page.test.tsx`
  Verifies rendering, unavailable-state copy, and the periodic refresh timer.

## Task 1: Add the org-admin-only top-level nav entry

**Files:**
- Modify: `apps/webapp/src/components/app-sidebar.tsx`
- Modify: `apps/webapp/src/components/server-app-sidebar.tsx`
- Test: `apps/webapp/src/components/app-sidebar.test.tsx`

- [ ] **Step 1: Write a failing sidebar wiring test**

Create `apps/webapp/src/components/app-sidebar.test.tsx` as a source-level guard so the new nav entry cannot drift away from the org-admin access-tier plumbing.

```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("app sidebar compliance navigation", () => {
	it("adds the compliance entry behind an org-admin-only server flag", () => {
		const sidebarSource = readFileSync(new URL("./app-sidebar.tsx", import.meta.url), "utf8");
		const serverSidebarSource = readFileSync(
			new URL("./server-app-sidebar.tsx", import.meta.url),
			"utf8",
		);

		expect(sidebarSource).toContain("showComplianceNav");
		expect(sidebarSource).toContain('url: "/compliance"');
		expect(serverSidebarSource).toContain("getCurrentSettingsAccessTier");
		expect(serverSidebarSource).toContain('showComplianceNav={settingsAccessTier === "orgAdmin"}');
	});
});
```

- [ ] **Step 2: Run the sidebar test to verify the nav entry does not exist yet**

Run: `pnpm test -- --run "apps/webapp/src/components/app-sidebar.test.tsx"`
Expected: FAIL because `app-sidebar.tsx` does not yet contain `showComplianceNav` or `"/compliance"`.

- [ ] **Step 3: Add the new nav prop and conditional item in `app-sidebar.tsx`**

Extend the existing sidebar props and secondary nav array without changing the rest of the app-nav structure.

```tsx
import {
	IconBeach,
	IconCalendar,
	IconCalendarEvent,
	IconClipboardCheck,
	IconClock,
	IconDashboard,
	IconHelp,
	IconReceipt,
	IconReport,
	IconSettings,
	IconShieldCheck,
	IconUsers,
} from "@tabler/icons-react";

interface AppSidebarProps extends React.ComponentProps<typeof Sidebar> {
	organizations?: UserOrganization[];
	currentOrganization?: UserOrganization | null;
	employeeRole?: "admin" | "manager" | "employee" | null;
	shiftsEnabled?: boolean;
	showComplianceNav?: boolean;
}

export function AppSidebar({
	organizations = [],
	currentOrganization = null,
	employeeRole = null,
	shiftsEnabled = false,
	showComplianceNav = false,
	...props
}: AppSidebarProps) {
	const navSecondary = [
		...(showComplianceNav
			? [
					{
						title: t("nav.compliance", "Compliance"),
						url: "/compliance",
						icon: IconShieldCheck,
					},
				]
			: []),
		{
			title: t("nav.settings", "Settings"),
			url: "/settings",
			icon: IconSettings,
			dataTour: "nav-settings",
		},
		{
			title: t("nav.get-help", "Get Help"),
			url: "#",
			icon: IconHelp,
		},
	];

	return (
		<Sidebar collapsible="offcanvas" data-tour="sidebar" {...props}>
			<SidebarHeader>
				<OrganizationSwitcher
					organizations={organizations}
					currentOrganization={currentOrganization}
					canCreateOrganizations={
						session?.user?.canCreateOrganizations || session?.user?.role === "admin"
					}
				/>
			</SidebarHeader>
			<SidebarContent>
				<NavMain items={navPersonal} label="z8 app" />
				{isManagerOrAbove(employeeRole) && <NavTeam items={navTeam} />}
			<NavSecondary className="mt-auto" items={navSecondary} />
			</SidebarContent>
			<SidebarFooter>
				<NavUser
					user={{
						id: session?.user?.id || "",
						name: session?.user?.name || "",
						email: session?.user?.email || "",
						avatar: session?.user?.image ?? undefined,
					}}
					isLoading={isPending}
				/>
			</SidebarFooter>
		</Sidebar>
	);
}
```

- [ ] **Step 4: Resolve the org-admin flag in `server-app-sidebar.tsx`**

Keep the client sidebar simple by resolving org-admin visibility on the server from the already-centralized settings access tier.

```tsx
import { getAuthContext, getCurrentSettingsAccessTier, getUserOrganizations } from "@/lib/auth-helpers";
import { AppSidebar } from "./app-sidebar";

export async function ServerAppSidebar(props: React.ComponentProps<typeof AppSidebar>) {
	const [organizations, authContext, settingsAccessTier] = await Promise.all([
		getUserOrganizations(),
		getAuthContext(),
		getCurrentSettingsAccessTier(),
	]);

	const currentOrganization = authContext?.employee?.organizationId
		? organizations.find((org) => org.id === authContext.employee?.organizationId) || null
		: null;

	return (
		<AppSidebar
			{...props}
			organizations={organizations}
			currentOrganization={currentOrganization}
			employeeRole={authContext?.employee?.role ?? null}
			shiftsEnabled={currentOrganization?.shiftsEnabled ?? false}
			showComplianceNav={settingsAccessTier === "orgAdmin"}
		/>
	);
}
```

- [ ] **Step 5: Re-run the sidebar test**

Run: `pnpm test -- --run "apps/webapp/src/components/app-sidebar.test.tsx"`
Expected: PASS.

- [ ] **Step 6: Commit the nav plumbing**

```bash
git add apps/webapp/src/components/app-sidebar.tsx apps/webapp/src/components/server-app-sidebar.tsx apps/webapp/src/components/app-sidebar.test.tsx
git commit -m "feat(nav): add org-admin compliance entry"
```

## Task 2: Create the shared command-center contract and pure view-model helpers

**Files:**
- Create: `apps/webapp/src/lib/compliance-command-center/types.ts`
- Create: `apps/webapp/src/lib/compliance-command-center/view-model.ts`
- Test: `apps/webapp/src/lib/compliance-command-center/view-model.test.ts`

- [ ] **Step 1: Write the failing view-model tests first**

Create `apps/webapp/src/lib/compliance-command-center/view-model.test.ts` with contract-level tests for severity rollup and recent-event ordering.

```ts
import { DateTime } from "luxon";
import { describe, expect, it } from "vitest";
import { buildComplianceCommandCenterData } from "./view-model";
import type { ComplianceCriticalEvent, ComplianceSectionCard } from "./types";

const now = DateTime.utc();

function makeSection(
	key: ComplianceSectionCard["key"],
	status: ComplianceSectionCard["status"],
): ComplianceSectionCard {
	return {
		key,
		status,
		headline: `${key}-${status}`,
		facts: [],
		updatedAt: now.toISO(),
		primaryLink: { label: "Open", href: "/settings" },
	};
}

describe("buildComplianceCommandCenterData", () => {
	it("rolls the overall summary up to critical when any section is critical", () => {
		const data = buildComplianceCommandCenterData({
			sections: [
				makeSection("auditEvidence", "healthy"),
				makeSection("workforceCompliance", "critical"),
				makeSection("accessControls", "warning"),
			],
			recentCriticalEvents: [],
			coverageNotes: ["Audit evidence uses live export signals."],
			refreshedAt: now.toISO()!,
		});

		expect(data.summary.status).toBe("critical");
		expect(data.summary.topRiskKeys).toEqual(["workforceCompliance"]);
	});

	it("keeps the newest critical events first and drops overflow after five", () => {
		const events: ComplianceCriticalEvent[] = Array.from({ length: 6 }, (_, index) => ({
			id: `evt-${index}`,
			sectionKey: "auditEvidence",
			severity: index % 2 === 0 ? "critical" : "warning",
			title: `Event ${index}`,
			description: "details",
			occurredAt: now.minus({ minutes: index }).toISO()!,
			primaryLink: { label: "Open", href: "/settings/audit-export" },
		}));

		const data = buildComplianceCommandCenterData({
			sections: [
				makeSection("auditEvidence", "warning"),
				makeSection("workforceCompliance", "healthy"),
				makeSection("accessControls", "healthy"),
			],
			recentCriticalEvents: events,
			coverageNotes: ["Access controls only use audit-log events captured today."],
			refreshedAt: now.toISO()!,
		});

		expect(data.recentCriticalEvents).toHaveLength(5);
		expect(data.recentCriticalEvents[0]?.id).toBe("evt-0");
		expect(data.recentCriticalEvents[1]?.id).toBe("evt-2");
	});
});
```

- [ ] **Step 2: Run the contract test to verify the module does not exist yet**

Run: `pnpm test -- --run "apps/webapp/src/lib/compliance-command-center/view-model.test.ts"`
Expected: FAIL because `types.ts` and `view-model.ts` do not exist.

- [ ] **Step 3: Add the shared types in `types.ts`**

Create the normalized contract once so every later section builder and component reuses the same shape.

```ts
export type ComplianceSectionKey = "auditEvidence" | "workforceCompliance" | "accessControls";

export type ComplianceSectionStatus = "healthy" | "warning" | "critical" | "unavailable";

export interface CompliancePrimaryLink {
	label: string;
	href: string;
}

export interface ComplianceSectionCard {
	key: ComplianceSectionKey;
	status: ComplianceSectionStatus;
	headline: string;
	facts: string[];
	updatedAt: string | null;
	primaryLink: CompliancePrimaryLink;
}

export interface ComplianceCriticalEvent {
	id: string;
	sectionKey: ComplianceSectionKey;
	severity: Extract<ComplianceSectionStatus, "warning" | "critical">;
	title: string;
	description: string;
	occurredAt: string;
	primaryLink: CompliancePrimaryLink;
}

export interface ComplianceRiskSummary {
	status: ComplianceSectionStatus;
	headline: string;
	topRiskKeys: ComplianceSectionKey[];
	refreshedAt: string;
}

export interface ComplianceCommandCenterData {
	refreshedAt: string;
	summary: ComplianceRiskSummary;
	sections: ComplianceSectionCard[];
	recentCriticalEvents: ComplianceCriticalEvent[];
	coverageNotes: string[];
}

export interface ComplianceSectionResult {
	card: ComplianceSectionCard;
	recentCriticalEvents: ComplianceCriticalEvent[];
}
```

- [ ] **Step 4: Add the pure assembly helpers in `view-model.ts`**

Keep severity rollup and cross-section event sorting out of the route so loader and UI stay predictable.

```ts
import type {
	ComplianceCommandCenterData,
	ComplianceCriticalEvent,
	ComplianceRiskSummary,
	ComplianceSectionCard,
	ComplianceSectionStatus,
} from "./types";

const STATUS_PRIORITY: Record<ComplianceSectionStatus, number> = {
	unavailable: 3,
	critical: 2,
	warning: 1,
	healthy: 0,
};

function buildRiskSummary(sections: ComplianceSectionCard[], refreshedAt: string): ComplianceRiskSummary {
	const highestPriority = Math.max(...sections.map((section) => STATUS_PRIORITY[section.status]));
	const status = (Object.entries(STATUS_PRIORITY).find(([, value]) => value === highestPriority)?.[0] ??
		"healthy") as ComplianceSectionStatus;
	const topRiskKeys = sections
		.filter((section) => STATUS_PRIORITY[section.status] === highestPriority && highestPriority > 0)
		.map((section) => section.key);

	return {
		status,
		headline:
			status === "critical"
				? "Critical compliance risks need attention"
				: status === "warning"
					? "Compliance signals need review"
					: status === "unavailable"
						? "Some compliance signals are unavailable"
						: "No active issues detected in monitored signals",
		topRiskKeys,
		refreshedAt,
	};
}

function sortRecentCriticalEvents(events: ComplianceCriticalEvent[]): ComplianceCriticalEvent[] {
	return [...events]
		.sort((left, right) => {
			if (left.severity !== right.severity) {
				return left.severity === "critical" ? -1 : 1;
			}

			return right.occurredAt.localeCompare(left.occurredAt);
		})
		.slice(0, 5);
}

export function buildComplianceCommandCenterData(input: {
	sections: ComplianceSectionCard[];
	recentCriticalEvents: ComplianceCriticalEvent[];
	coverageNotes: string[];
	refreshedAt: string;
}): ComplianceCommandCenterData {
	return {
		refreshedAt: input.refreshedAt,
		summary: buildRiskSummary(input.sections, input.refreshedAt),
		sections: input.sections,
		recentCriticalEvents: sortRecentCriticalEvents(input.recentCriticalEvents),
		coverageNotes: input.coverageNotes,
	};
}
```

- [ ] **Step 5: Re-run the shared contract test**

Run: `pnpm test -- --run "apps/webapp/src/lib/compliance-command-center/view-model.test.ts"`
Expected: PASS.

- [ ] **Step 6: Commit the shared contract layer**

```bash
git add apps/webapp/src/lib/compliance-command-center/types.ts apps/webapp/src/lib/compliance-command-center/view-model.ts apps/webapp/src/lib/compliance-command-center/view-model.test.ts
git commit -m "feat(compliance): add shared command center contract"
```

## Task 3: Build the audit-evidence and access-controls section builders

**Files:**
- Create: `apps/webapp/src/lib/compliance-command-center/sections/audit-evidence.ts`
- Create: `apps/webapp/src/lib/compliance-command-center/sections/access-controls.ts`
- Test: `apps/webapp/src/lib/compliance-command-center/sections/audit-evidence.test.ts`
- Test: `apps/webapp/src/lib/compliance-command-center/sections/access-controls.test.ts`

- [ ] **Step 1: Write the failing audit-evidence and access-controls tests**

Create the section tests as pure formatting tests before touching any database-backed implementation.

```ts
import { DateTime } from "luxon";
import { describe, expect, it } from "vitest";
import { deriveAuditEvidenceSection } from "./audit-evidence";
import { deriveAccessControlsSection } from "./access-controls";

describe("deriveAuditEvidenceSection", () => {
	it("marks the section critical when a recent audit-pack request failed", () => {
		const result = deriveAuditEvidenceSection({
			hasConfig: true,
			activeKeyFingerprint: "fp_123",
			recentFailedRequests: 1,
			recentInvalidVerifications: 0,
			latestSuccessAt: DateTime.utc().minus({ hours: 3 }).toISO(),
		});

		expect(result.card.status).toBe("critical");
		expect(result.recentCriticalEvents[0]?.title).toContain("Audit pack generation failed");
	});

	it("marks the section warning when signing is not configured", () => {
		const result = deriveAuditEvidenceSection({
			hasConfig: false,
			activeKeyFingerprint: null,
			recentFailedRequests: 0,
			recentInvalidVerifications: 0,
			latestSuccessAt: null,
		});

		expect(result.card.status).toBe("warning");
		expect(result.card.facts).toContain("Signing keys are not configured yet.");
	});
});

describe("deriveAccessControlsSection", () => {
	it("marks the section critical when recent permission revocations or access denials exist", () => {
		const result = deriveAccessControlsSection({
			recentSensitiveEvents: [
				{
					id: "evt-1",
					action: "permission.revoked",
					timestamp: DateTime.utc().minus({ minutes: 5 }).toISO()!,
					description: "Removed project export permission",
				},
			],
		});

		expect(result.card.status).toBe("critical");
		expect(result.recentCriticalEvents).toHaveLength(1);
	});

	it("stays healthy when there are no recent sensitive control events", () => {
		const result = deriveAccessControlsSection({ recentSensitiveEvents: [] });

		expect(result.card.status).toBe("healthy");
		expect(result.card.facts).toContain("No sensitive control changes were logged in the last 24 hours.");
	});
});
```

- [ ] **Step 2: Run the new section tests to confirm the builders do not exist yet**

Run: `pnpm test -- --run "apps/webapp/src/lib/compliance-command-center/sections/audit-evidence.test.ts" "apps/webapp/src/lib/compliance-command-center/sections/access-controls.test.ts"`
Expected: FAIL because the section modules do not exist.

- [ ] **Step 3: Implement `audit-evidence.ts` with a pure formatter and a thin org-scoped loader**

Use the existing audit export configuration, audit-pack request repository, and verification log data, but keep the status logic pure and testable.

```ts
import { and, desc, eq, gte } from "drizzle-orm";
import { DateTime } from "luxon";
import { db } from "@/db";
import { auditExportPackage, auditVerificationLog } from "@/db/schema";
import { configurationService } from "@/lib/audit-export";
import { auditPackRequestRepository } from "@/lib/audit-pack/application/request-repository";
import type { ComplianceSectionResult } from "../types";

export interface AuditEvidenceSnapshot {
	hasConfig: boolean;
	activeKeyFingerprint: string | null;
	recentFailedRequests: number;
	recentInvalidVerifications: number;
	latestSuccessAt: string | null;
}

export function deriveAuditEvidenceSection(snapshot: AuditEvidenceSnapshot): ComplianceSectionResult {
	const status =
		snapshot.recentFailedRequests > 0 || snapshot.recentInvalidVerifications > 0
			? "critical"
			: !snapshot.hasConfig || !snapshot.activeKeyFingerprint
				? "warning"
				: "healthy";

	const facts = [
		snapshot.activeKeyFingerprint
			? `Active signing key: ${snapshot.activeKeyFingerprint}`
			: "Signing keys are not configured yet.",
		`Recent failed audit-pack jobs: ${snapshot.recentFailedRequests}`,
		`Recent invalid verification attempts: ${snapshot.recentInvalidVerifications}`,
		snapshot.latestSuccessAt
			? `Last successful audit pack: ${snapshot.latestSuccessAt}`
			: "No successful audit pack has been recorded yet.",
	];

	return {
		card: {
			key: "auditEvidence",
			status,
			headline:
				status === "critical"
					? "Audit evidence needs attention"
					: status === "warning"
						? "Audit evidence is only partially ready"
						: "Audit evidence signals look healthy",
			facts,
			updatedAt: DateTime.utc().toISO(),
			primaryLink: { label: "Open Audit Export", href: "/settings/audit-export" },
		},
		recentCriticalEvents:
			status === "critical"
				? [
						{
							id: "audit-pack-failure",
							sectionKey: "auditEvidence",
							severity: "critical",
							title: "Audit pack generation failed",
							description: `Recent failed jobs: ${snapshot.recentFailedRequests}`,
							occurredAt: DateTime.utc().toISO()!,
							primaryLink: { label: "Review audit export", href: "/settings/audit-export" },
						},
					]
				: [],
	};
}

export async function getAuditEvidenceSection(organizationId: string): Promise<ComplianceSectionResult> {
	const [config, requests, invalidVerifications] = await Promise.all([
		configurationService.getConfig(organizationId),
		auditPackRequestRepository.listRequests({ organizationId, limit: 10 }),
		db
			.select({ id: auditVerificationLog.id })
			.from(auditVerificationLog)
			.innerJoin(auditExportPackage, eq(auditVerificationLog.packageId, auditExportPackage.id))
			.where(
				and(
					eq(auditExportPackage.organizationId, organizationId),
					eq(auditVerificationLog.isValid, false),
					gte(auditVerificationLog.verifiedAt, DateTime.utc().minus({ days: 7 }).toJSDate()),
				),
			)
			.orderBy(desc(auditVerificationLog.verifiedAt))
			.limit(10),
	]);

	return deriveAuditEvidenceSection({
		hasConfig: Boolean(config),
		activeKeyFingerprint: config?.signingKeyFingerprint ?? null,
		recentFailedRequests: requests.filter((request) => request.status === "failed").length,
		recentInvalidVerifications: invalidVerifications.length,
		latestSuccessAt:
			requests.find((request) => request.status === "completed")?.completedAt?.toISOString() ?? null,
	});
}
```

- [ ] **Step 4: Implement `access-controls.ts` with explicit sensitive-action filtering**

Keep this section tied to actual logged audit events instead of inventing security analytics that do not exist yet.

```ts
import { DateTime } from "luxon";
import { getRecentAuditLogs } from "@/lib/query/audit.queries";
import type { ComplianceSectionResult } from "../types";

const SENSITIVE_ACTION_PREFIXES = ["permission.", "manager.", "app_access.", "employee.deactivated"];

export interface AccessControlEventSnapshot {
	id: string;
	action: string;
	timestamp: string;
	description: string;
}

export function deriveAccessControlsSection(input: {
	recentSensitiveEvents: AccessControlEventSnapshot[];
}): ComplianceSectionResult {
	const hasCriticalSignals = input.recentSensitiveEvents.some(
		(event) => event.action === "permission.revoked" || event.action === "app_access.denied",
	);
	const status = hasCriticalSignals
		? "critical"
		: input.recentSensitiveEvents.length > 0
			? "warning"
			: "healthy";

	return {
		card: {
			key: "accessControls",
			status,
			headline:
				status === "critical"
					? "Sensitive control changes need review"
					: status === "warning"
						? "Recent control changes were detected"
						: "No sensitive control changes were logged recently",
			facts: [
				input.recentSensitiveEvents.length > 0
					? `Recent sensitive events: ${input.recentSensitiveEvents.length}`
					: "No sensitive control changes were logged in the last 24 hours.",
				input.recentSensitiveEvents[0]
					? `Latest sensitive action: ${input.recentSensitiveEvents[0].action}`
					: "Latest sensitive action: none",
			],
			updatedAt: DateTime.utc().toISO(),
			primaryLink: { label: "Open Audit Log", href: "/settings/enterprise/audit-log" },
		},
		recentCriticalEvents: input.recentSensitiveEvents.slice(0, 3).map((event) => ({
			id: event.id,
			sectionKey: "accessControls",
			severity:
				event.action === "permission.revoked" || event.action === "app_access.denied"
					? "critical"
					: "warning",
			title: `Sensitive action: ${event.action}`,
			description: event.description,
			occurredAt: event.timestamp,
			primaryLink: { label: "Inspect in Audit Log", href: "/settings/enterprise/audit-log" },
		})),
	};
}

export async function getAccessControlsSection(organizationId: string): Promise<ComplianceSectionResult> {
	const logs = await getRecentAuditLogs(organizationId, 50);
	const recentSensitiveEvents = logs
		.filter((log) => SENSITIVE_ACTION_PREFIXES.some((prefix) => log.action.startsWith(prefix)))
		.slice(0, 10)
		.map((log) => ({
			id: log.id,
			action: log.action,
			timestamp: log.timestamp.toISOString(),
			description: `${log.action} on ${log.entityType}`,
		}));

	return deriveAccessControlsSection({ recentSensitiveEvents });
}
```

- [ ] **Step 5: Re-run the section tests**

Run: `pnpm test -- --run "apps/webapp/src/lib/compliance-command-center/sections/audit-evidence.test.ts" "apps/webapp/src/lib/compliance-command-center/sections/access-controls.test.ts"`
Expected: PASS.

- [ ] **Step 6: Commit the first two section builders**

```bash
git add apps/webapp/src/lib/compliance-command-center/sections/audit-evidence.ts apps/webapp/src/lib/compliance-command-center/sections/access-controls.ts apps/webapp/src/lib/compliance-command-center/sections/audit-evidence.test.ts apps/webapp/src/lib/compliance-command-center/sections/access-controls.test.ts
git commit -m "feat(compliance): add audit and access section builders"
```

## Task 4: Build the workforce-compliance section and aggregate loader

**Files:**
- Create: `apps/webapp/src/lib/compliance-command-center/sections/workforce-compliance.ts`
- Create: `apps/webapp/src/lib/compliance-command-center/loader.ts`
- Test: `apps/webapp/src/lib/compliance-command-center/sections/workforce-compliance.test.ts`
- Test: `apps/webapp/src/lib/compliance-command-center/loader.test.ts`

- [ ] **Step 1: Write the failing workforce and loader tests**

Create the workforce formatter test and a loader orchestration test that proves all three sections are returned together with coverage notes.

```ts
import { DateTime } from "luxon";
import { describe, expect, it } from "vitest";
import { deriveWorkforceComplianceSection } from "./workforce-compliance";

describe("deriveWorkforceComplianceSection", () => {
	it("marks the section critical when rest-period or max-hours violations exist", () => {
		const result = deriveWorkforceComplianceSection({
			restPeriodViolations: 1,
			maxDailyHourViolations: 0,
			overtimeViolations: 2,
			pendingExceptions: 0,
			latestViolationAt: DateTime.utc().minus({ hours: 2 }).toISO(),
		});

		expect(result.card.status).toBe("critical");
		expect(result.card.facts).toContain("Rest-period violations: 1");
	});

	it("falls back to warning for overtime-only drift", () => {
		const result = deriveWorkforceComplianceSection({
			restPeriodViolations: 0,
			maxDailyHourViolations: 0,
			overtimeViolations: 3,
			pendingExceptions: 1,
			latestViolationAt: DateTime.utc().minus({ days: 1 }).toISO(),
		});

		expect(result.card.status).toBe("warning");
	});
});
```

```ts
import { describe, expect, it, vi } from "vitest";

vi.mock("./sections/audit-evidence", () => ({
	getAuditEvidenceSection: vi.fn(async () => ({
		card: {
			key: "auditEvidence",
			status: "healthy",
			headline: "ok",
			facts: [],
			updatedAt: "2026-04-11T10:00:00.000Z",
			primaryLink: { label: "Audit", href: "/settings/audit-export" },
		},
		recentCriticalEvents: [],
	})),
}));

vi.mock("./sections/workforce-compliance", () => ({
	getWorkforceComplianceSection: vi.fn(async () => ({
		card: {
			key: "workforceCompliance",
			status: "warning",
			headline: "warnings",
			facts: [],
			updatedAt: "2026-04-11T10:00:00.000Z",
			primaryLink: { label: "Compliance", href: "/settings/compliance" },
		},
		recentCriticalEvents: [],
	})),
}));

vi.mock("./sections/access-controls", () => ({
	getAccessControlsSection: vi.fn(async () => ({
		card: {
			key: "accessControls",
			status: "critical",
			headline: "critical",
			facts: [],
			updatedAt: "2026-04-11T10:00:00.000Z",
			primaryLink: { label: "Audit Log", href: "/settings/enterprise/audit-log" },
		},
		recentCriticalEvents: [
			{
				id: "evt-1",
				sectionKey: "accessControls",
				severity: "critical",
				title: "Sensitive action",
				description: "details",
				occurredAt: "2026-04-11T10:00:00.000Z",
				primaryLink: { label: "Open", href: "/settings/enterprise/audit-log" },
			},
		],
	})),
}));

import { getComplianceCommandCenterData } from "./loader";

describe("getComplianceCommandCenterData", () => {
	it("assembles all sections, summary, and coverage notes", async () => {
		const data = await getComplianceCommandCenterData("org-1");

		expect(data.sections.map((section) => section.key)).toEqual([
			"auditEvidence",
			"workforceCompliance",
			"accessControls",
		]);
		expect(data.summary.status).toBe("critical");
		expect(data.coverageNotes.length).toBeGreaterThan(0);
	});

	it("falls back to an unavailable card when one section loader throws", async () => {
		const { getAccessControlsSection } = await import("./sections/access-controls");
		vi.mocked(getAccessControlsSection).mockRejectedValueOnce(new Error("audit log offline"));

		const data = await getComplianceCommandCenterData("org-1");

		expect(data.sections.find((section) => section.key === "accessControls")?.status).toBe(
			"unavailable",
		);
	});
});
```

- [ ] **Step 2: Run the workforce and loader tests to confirm the files are missing**

Run: `pnpm test -- --run "apps/webapp/src/lib/compliance-command-center/sections/workforce-compliance.test.ts" "apps/webapp/src/lib/compliance-command-center/loader.test.ts"`
Expected: FAIL because `workforce-compliance.ts` and `loader.ts` do not exist.

- [ ] **Step 3: Implement `workforce-compliance.ts` directly from existing violation and exception tables**

Avoid manager-only scheduling actions here. Query the org-scoped tables directly so the section works for any org-admin with an active organization.

```ts
import { and, eq, gte, sql } from "drizzle-orm";
import { DateTime } from "luxon";
import { db } from "@/db";
import { complianceException, workPolicyViolation } from "@/db/schema";
import type { ComplianceSectionResult } from "../types";

export interface WorkforceComplianceSnapshot {
	restPeriodViolations: number;
	maxDailyHourViolations: number;
	overtimeViolations: number;
	pendingExceptions: number;
	latestViolationAt: string | null;
}

export function deriveWorkforceComplianceSection(
	snapshot: WorkforceComplianceSnapshot,
): ComplianceSectionResult {
	const status =
		snapshot.restPeriodViolations > 0 || snapshot.maxDailyHourViolations > 0
			? "critical"
			: snapshot.overtimeViolations > 0 || snapshot.pendingExceptions > 0
				? "warning"
				: "healthy";

	return {
		card: {
			key: "workforceCompliance",
			status,
			headline:
				status === "critical"
					? "Workforce policy violations need review"
					: status === "warning"
						? "Workforce compliance is drifting"
						: "No recent workforce policy issues were detected",
			facts: [
				`Rest-period violations: ${snapshot.restPeriodViolations}`,
				`Max-hours violations: ${snapshot.maxDailyHourViolations}`,
				`Overtime violations: ${snapshot.overtimeViolations}`,
				`Pending exceptions: ${snapshot.pendingExceptions}`,
			],
			updatedAt: snapshot.latestViolationAt ?? DateTime.utc().toISO(),
			primaryLink: { label: "Open Compliance Settings", href: "/settings/compliance" },
		},
		recentCriticalEvents:
			status === "healthy"
				? []
				: [
						{
							id: "workforce-violations",
							sectionKey: "workforceCompliance",
							severity: status === "critical" ? "critical" : "warning",
							title: "Recent workforce policy findings",
							description: `Rest: ${snapshot.restPeriodViolations}, Max hours: ${snapshot.maxDailyHourViolations}, Overtime: ${snapshot.overtimeViolations}`,
							occurredAt: snapshot.latestViolationAt ?? DateTime.utc().toISO()!,
							primaryLink: { label: "Inspect compliance", href: "/settings/compliance" },
						},
					],
	};
}

export async function getWorkforceComplianceSection(
	organizationId: string,
): Promise<ComplianceSectionResult> {
	const sevenDaysAgo = DateTime.utc().minus({ days: 7 }).toJSDate();

	const [violationRows, pendingExceptionRows] = await Promise.all([
		db
			.select({
				violationType: workPolicyViolation.violationType,
				count: sql<number>`count(*)::int`,
				latestViolationAt: sql<Date | null>`max(${workPolicyViolation.violationDate})`,
			})
			.from(workPolicyViolation)
			.where(
				and(
					eq(workPolicyViolation.organizationId, organizationId),
					gte(workPolicyViolation.violationDate, sevenDaysAgo),
				),
			)
			.groupBy(workPolicyViolation.violationType),
		db
			.select({ count: sql<number>`count(*)::int` })
			.from(complianceException)
			.where(
				and(
					eq(complianceException.organizationId, organizationId),
					eq(complianceException.status, "pending"),
				),
			),
	]);

	const snapshot: WorkforceComplianceSnapshot = {
		restPeriodViolations: violationRows.find((row) => row.violationType === "rest_period")?.count ?? 0,
		maxDailyHourViolations:
			violationRows.find((row) => row.violationType === "max_daily_hours")?.count ?? 0,
		overtimeViolations: violationRows
			.filter((row) => String(row.violationType).startsWith("overtime_"))
			.reduce((total, row) => total + row.count, 0),
		pendingExceptions: pendingExceptionRows[0]?.count ?? 0,
		latestViolationAt:
			violationRows
				.map((row) => row.latestViolationAt)
				.filter((value): value is Date => value instanceof Date)
				.sort((left, right) => right.getTime() - left.getTime())[0]
				?.toISOString() ?? null,
	};

	return deriveWorkforceComplianceSection(snapshot);
}
```

- [ ] **Step 4: Implement the parallel loader in `loader.ts`**

Keep this file orchestration-only. All section semantics should stay in the section files and pure view-model helper.

```ts
import { DateTime } from "luxon";
import { getAccessControlsSection } from "./sections/access-controls";
import { getAuditEvidenceSection } from "./sections/audit-evidence";
import { getWorkforceComplianceSection } from "./sections/workforce-compliance";
import { buildComplianceCommandCenterData } from "./view-model";
import type { ComplianceCommandCenterData, ComplianceSectionResult } from "./types";

function unavailableSection(
	key: ComplianceSectionResult["card"]["key"],
	primaryLink: ComplianceSectionResult["card"]["primaryLink"],
	errorMessage: string,
): ComplianceSectionResult {
	return {
		card: {
			key,
			status: "unavailable",
			headline: "Signal temporarily unavailable",
			facts: [errorMessage],
			updatedAt: DateTime.utc().toISO(),
			primaryLink,
		},
		recentCriticalEvents: [],
	};
}

export async function getComplianceCommandCenterData(
	organizationId: string,
): Promise<ComplianceCommandCenterData> {
	const [auditEvidence, workforceCompliance, accessControls] = await Promise.all([
		getAuditEvidenceSection(organizationId).catch(() =>
			unavailableSection(
				"auditEvidence",
				{ label: "Open Audit Export", href: "/settings/audit-export" },
				"Audit evidence data could not be loaded.",
			),
		),
		getWorkforceComplianceSection(organizationId).catch(() =>
			unavailableSection(
				"workforceCompliance",
				{ label: "Open Compliance Settings", href: "/settings/compliance" },
				"Workforce compliance data could not be loaded.",
			),
		),
		getAccessControlsSection(organizationId).catch(() =>
			unavailableSection(
				"accessControls",
				{ label: "Open Audit Log", href: "/settings/enterprise/audit-log" },
				"Access-control events could not be loaded.",
			),
		),
	]);

	return buildComplianceCommandCenterData({
		sections: [auditEvidence.card, workforceCompliance.card, accessControls.card],
		recentCriticalEvents: [
			...auditEvidence.recentCriticalEvents,
			...workforceCompliance.recentCriticalEvents,
			...accessControls.recentCriticalEvents,
		],
		coverageNotes: [
			"Audit evidence uses live audit-export configuration, audit-pack requests, and recent verification results.",
			"Workforce compliance uses the last 7 days of work-policy violations and pending exception requests.",
			"Access controls only summarize sensitive audit-log events that are already captured today.",
		],
		refreshedAt: DateTime.utc().toISO()!,
	});
}
```

- [ ] **Step 5: Re-run the workforce and loader tests**

Run: `pnpm test -- --run "apps/webapp/src/lib/compliance-command-center/sections/workforce-compliance.test.ts" "apps/webapp/src/lib/compliance-command-center/loader.test.ts"`
Expected: PASS.

- [ ] **Step 6: Commit the third section and loader**

```bash
git add apps/webapp/src/lib/compliance-command-center/sections/workforce-compliance.ts apps/webapp/src/lib/compliance-command-center/loader.ts apps/webapp/src/lib/compliance-command-center/sections/workforce-compliance.test.ts apps/webapp/src/lib/compliance-command-center/loader.test.ts
git commit -m "feat(compliance): add workforce section and loader"
```

## Task 5: Add the `/compliance` route and overview UI

**Files:**
- Create: `apps/webapp/src/app/[locale]/(app)/compliance/page.tsx`
- Create: `apps/webapp/src/app/[locale]/(app)/compliance/page.guard.test.ts`
- Create: `apps/webapp/src/components/compliance-command-center/compliance-command-center-page.tsx`
- Create: `apps/webapp/src/components/compliance-command-center/risk-summary-header.tsx`
- Create: `apps/webapp/src/components/compliance-command-center/compliance-section-card.tsx`
- Create: `apps/webapp/src/components/compliance-command-center/recent-critical-events-list.tsx`
- Create: `apps/webapp/src/components/compliance-command-center/coverage-footer.tsx`
- Test: `apps/webapp/src/components/compliance-command-center/compliance-command-center-page.test.tsx`

- [ ] **Step 1: Write the failing route-guard and page-shell tests**

Create a source-based route guard test and a render test for the page shell.

```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("compliance page guard", () => {
	it("uses the shared org-admin settings helper and the normalized loader", () => {
		const source = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");

		expect(source).toContain("requireOrgAdminSettingsAccess");
		expect(source).toContain("getComplianceCommandCenterData");
	});
});
```

```tsx
import type { ReactNode } from "react";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ComplianceCommandCenterPage } from "./compliance-command-center-page";

const refresh = vi.fn();

vi.mock("@/navigation", () => ({
	useRouter: () => ({ refresh }),
	Link: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a>,
}));

describe("ComplianceCommandCenterPage", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		refresh.mockReset();
	});

	it("renders cards, events, and coverage notes", () => {
		render(
			<ComplianceCommandCenterPage
				data={{
					refreshedAt: "2026-04-11T10:00:00.000Z",
					summary: {
						status: "warning",
						headline: "Compliance signals need review",
						topRiskKeys: ["workforceCompliance"],
						refreshedAt: "2026-04-11T10:00:00.000Z",
					},
					sections: [
						{
							key: "auditEvidence",
							status: "healthy",
							headline: "Audit evidence signals look healthy",
							facts: ["Recent failed audit-pack jobs: 0"],
							updatedAt: "2026-04-11T10:00:00.000Z",
							primaryLink: { label: "Open Audit Export", href: "/settings/audit-export" },
						},
						{
							key: "accessControls",
							status: "unavailable",
							headline: "Signal temporarily unavailable",
							facts: ["Access-control events could not be loaded."],
							updatedAt: "2026-04-11T10:00:00.000Z",
							primaryLink: { label: "Open Audit Log", href: "/settings/enterprise/audit-log" },
						},
					],
					recentCriticalEvents: [],
					coverageNotes: ["Access controls only summarize logged audit events."],
				}}
			/>,
		);

		expect(screen.getByText("Compliance signals need review")).toBeInTheDocument();
		expect(screen.getByText("Audit evidence signals look healthy")).toBeInTheDocument();
		expect(screen.getByText("Access-control events could not be loaded.")).toBeInTheDocument();
		expect(screen.getByText("Access controls only summarize logged audit events.")).toBeInTheDocument();
	});

	it("refreshes the route every two minutes to keep critical signals fresher", () => {
		render(
			<ComplianceCommandCenterPage
				data={{
					refreshedAt: "2026-04-11T10:00:00.000Z",
					summary: {
						status: "healthy",
						headline: "No active issues detected in monitored signals",
						topRiskKeys: [],
						refreshedAt: "2026-04-11T10:00:00.000Z",
					},
					sections: [],
					recentCriticalEvents: [],
					coverageNotes: [],
				}}
			/>,
		);

		vi.advanceTimersByTime(120_000);
		expect(refresh).toHaveBeenCalledTimes(1);
	});
});
```

- [ ] **Step 2: Run the route and page tests before implementing the page**

Run: `pnpm test -- --run "apps/webapp/src/app/[locale]/(app)/compliance/page.guard.test.ts" "apps/webapp/src/components/compliance-command-center/compliance-command-center-page.test.tsx"`
Expected: FAIL because the route and components do not exist yet.

- [ ] **Step 3: Add the guarded top-level route in `page.tsx`**

Keep the route thin: auth, load, render.

```tsx
import { ComplianceCommandCenterPage } from "@/components/compliance-command-center/compliance-command-center-page";
import { requireOrgAdminSettingsAccess } from "@/lib/auth-helpers";
import { getComplianceCommandCenterData } from "@/lib/compliance-command-center/loader";

export const metadata = {
	title: "Compliance",
	description: "Risk-first compliance overview for organization admins",
};

export default async function CompliancePage() {
	const { organizationId } = await requireOrgAdminSettingsAccess();
	const data = await getComplianceCommandCenterData(organizationId);

	return <ComplianceCommandCenterPage data={data} />;
}
```

- [ ] **Step 4: Build the page shell and focused UI components**

Create a restrained overview surface with one client page shell and three small presentational components.

```tsx
"use client";

import { useEffect } from "react";
import { useRouter } from "@/navigation";
import type { ComplianceCommandCenterData } from "@/lib/compliance-command-center/types";
import { CoverageFooter } from "./coverage-footer";
import { ComplianceSectionCard } from "./compliance-section-card";
import { RecentCriticalEventsList } from "./recent-critical-events-list";
import { RiskSummaryHeader } from "./risk-summary-header";

export function ComplianceCommandCenterPage({ data }: { data: ComplianceCommandCenterData }) {
	const router = useRouter();

	useEffect(() => {
		const intervalId = window.setInterval(() => {
			router.refresh();
		}, 120_000);

		return () => window.clearInterval(intervalId);
	}, [router]);

	return (
		<div className="flex flex-1 flex-col gap-6 p-4 md:p-6">
			<RiskSummaryHeader summary={data.summary} />
			<div className="grid gap-4 xl:grid-cols-3">
				{data.sections.map((section) => (
					<ComplianceSectionCard key={section.key} section={section} />
				))}
			</div>
			<RecentCriticalEventsList events={data.recentCriticalEvents} />
			<CoverageFooter notes={data.coverageNotes} refreshedAt={data.refreshedAt} />
		</div>
	);
}
```

```tsx
import { Badge } from "@/components/ui/badge";
import type { ComplianceRiskSummary } from "@/lib/compliance-command-center/types";

export function RiskSummaryHeader({ summary }: { summary: ComplianceRiskSummary }) {
	return (
		<div className="rounded-xl border bg-card p-5">
			<div className="flex items-center justify-between gap-3">
				<div className="space-y-1">
					<p className="text-sm text-muted-foreground">Compliance overview</p>
					<h1 className="text-2xl font-semibold">{summary.headline}</h1>
				</div>
				<Badge variant={summary.status === "critical" ? "destructive" : "secondary"}>
					{summary.status}
				</Badge>
			</div>
		</div>
	);
}
```

```tsx
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Link } from "@/navigation";
import type { ComplianceSectionCard as ComplianceSectionCardModel } from "@/lib/compliance-command-center/types";

export function ComplianceSectionCard({ section }: { section: ComplianceSectionCardModel }) {
	return (
		<Card>
			<CardHeader className="space-y-2">
				<CardTitle className="flex items-center justify-between">
					<span>{section.headline}</span>
					<span className="text-sm uppercase text-muted-foreground">{section.status}</span>
				</CardTitle>
			</CardHeader>
			<CardContent className="space-y-3">
				<ul className="space-y-2 text-sm text-muted-foreground">
					{section.facts.map((fact) => (
						<li key={fact}>{fact}</li>
					))}
				</ul>
				<Link className="text-sm font-medium text-primary" href={section.primaryLink.href}>
					{section.primaryLink.label}
				</Link>
			</CardContent>
		</Card>
	);
}
```

```tsx
import { Link } from "@/navigation";
import type { ComplianceCriticalEvent } from "@/lib/compliance-command-center/types";

export function RecentCriticalEventsList({ events }: { events: ComplianceCriticalEvent[] }) {
	return (
		<section className="space-y-3 rounded-xl border bg-card p-5">
			<h2 className="text-lg font-semibold">Recent critical events</h2>
			{events.length === 0 ? (
				<p className="text-sm text-muted-foreground">No recent critical events were detected.</p>
			) : (
				<ul className="space-y-3">
					{events.map((event) => (
						<li key={event.id} className="rounded-lg border p-3">
							<p className="font-medium">{event.title}</p>
							<p className="text-sm text-muted-foreground">{event.description}</p>
							<Link className="text-sm font-medium text-primary" href={event.primaryLink.href}>
								{event.primaryLink.label}
							</Link>
						</li>
					))}
				</ul>
			)}
		</section>
	);
}
```

```tsx
import { DateTime } from "luxon";

export function CoverageFooter({ notes, refreshedAt }: { notes: string[]; refreshedAt: string }) {
	return (
		<section className="space-y-2 rounded-xl border bg-muted/30 p-4 text-sm text-muted-foreground">
			<p>Last refreshed: {DateTime.fromISO(refreshedAt).toLocaleString(DateTime.DATETIME_MED)}</p>
			<ul className="space-y-1">
				{notes.map((note) => (
					<li key={note}>{note}</li>
				))}
			</ul>
		</section>
	);
}
```

- [ ] **Step 5: Re-run the route and component tests, then run the focused integration suite**

Run: `pnpm test -- --run "apps/webapp/src/app/[locale]/(app)/compliance/page.guard.test.ts" "apps/webapp/src/components/compliance-command-center/compliance-command-center-page.test.tsx" "apps/webapp/src/components/app-sidebar.test.tsx" "apps/webapp/src/lib/compliance-command-center/**/*.test.ts"`
Expected: PASS.

- [ ] **Step 6: Run a production build check**

Run: `pnpm build`
Expected: PASS.

- [ ] **Step 7: Commit the route and UI**

```bash
git add apps/webapp/src/app/[locale]/(app)/compliance/page.tsx apps/webapp/src/app/[locale]/(app)/compliance/page.guard.test.ts apps/webapp/src/components/compliance-command-center/compliance-command-center-page.tsx apps/webapp/src/components/compliance-command-center/risk-summary-header.tsx apps/webapp/src/components/compliance-command-center/compliance-section-card.tsx apps/webapp/src/components/compliance-command-center/recent-critical-events-list.tsx apps/webapp/src/components/compliance-command-center/coverage-footer.tsx apps/webapp/src/components/compliance-command-center/compliance-command-center-page.test.tsx
git commit -m "feat: add compliance command center overview"
```

## Self-Review Checklist

- Spec coverage: This plan maps the approved spec to five concrete implementation slices: org-admin nav visibility, shared contract, audit/access builders, workforce/loader aggregation, and final route/UI delivery.
- Placeholder scan: No steps rely on `TODO`, `TBD`, or implicit “add tests later” instructions. Every task has exact files, code, test commands, and commit commands.
- Type consistency: The plan uses the same names throughout: `ComplianceSectionCard`, `ComplianceCriticalEvent`, `ComplianceSectionResult`, `buildComplianceCommandCenterData`, and `getComplianceCommandCenterData`.
