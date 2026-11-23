import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { BotCommandContext } from "@/lib/bot-platform/types";
import { parseInstant, systemClock } from "@/lib/datetime/temporal-core";
import type { ComplianceSummary } from "@/lib/effect/services/teams-compliance.service";
import type { StubCaller } from "@/test/organization-action";

/**
 * #1977: the Teams compliance card links the work-policy violations view only for a recipient
 * who can open it, an org admin, as the command works out from their settings access. The
 * card's buttons are covered in `cards/compliance-card.test.ts`, the summary on PostgreSQL in
 * `teams-compliance.service.integration.test.ts`.
 */
const state = vi.hoisted(() => ({
	caller: null as StubCaller | null,
	summary: null as ComplianceSummary | null,
}));

vi.mock("@/lib/effect/runtime", async () => {
	const { runtimeModuleOver } = await import("@/test/effect-runtime");
	const { organizationActionStubLayer } = await import("@/test/organization-action");
	return runtimeModuleOver(organizationActionStubLayer(() => state.caller));
});
vi.mock("@/lib/effect/services/teams-compliance.service", async () => {
	const { Context, Effect, Layer } = await import("effect");
	const TeamsComplianceService = Context.Service<any>("TeamsComplianceService");
	return {
		TeamsComplianceService,
		TeamsComplianceServiceLive: Layer.succeed(TeamsComplianceService, {
			getComplianceSummary: () => Effect.sync(() => state.summary),
		}),
	};
});
// The permission and rate-limit gates are not under test here.
vi.mock("./middleware/permissions.middleware", () => ({
	compose:
		(...middlewares: Array<(handler: unknown) => unknown>) =>
		(handler: unknown) =>
			middlewares.reduceRight((wrapped, middleware) => middleware(wrapped), handler),
	withPermission: (_role: string, handler: unknown) => handler,
}));
vi.mock("./middleware/rate-limit.middleware", () => ({
	withRateLimit: (_command: string, handler: unknown) => handler,
}));
vi.mock("@/env", async (importOriginal) => ({
	env: { ...(await importOriginal<typeof import("@/env")>()).env, APP_URL: "https://z8.test" },
}));
vi.mock("@/lib/bot-platform/i18n", () => ({
	getBotTranslate: async () => (_key: string, fallback: string) => fallback,
}));

const { complianceCommand } = await import("./compliance");

const VIOLATIONS_URL = "https://z8.test/settings/work-policies?tab=work&view=compliance";

function context(): BotCommandContext {
	return {
		platform: "teams",
		organizationId: "org-1",
		employeeId: "employee-1",
		userId: "user-1",
		platformUserId: "T1",
		config: {
			organizationId: "org-1",
			enableApprovals: true,
			enableCommands: true,
			enableDailyDigest: false,
			enableEscalations: false,
			digestTime: "08:00",
			digestTimezone: "Europe/Berlin",
			escalationTimeoutHours: 24,
		},
		args: [],
		locale: "en",
		temporal: {
			effectiveTimezone: "Europe/Berlin",
			organizationTimezone: "Europe/Berlin",
			locale: "en",
			timezone: "Europe/Berlin",
			timeFormat: "24h",
			now: parseInstant("2026-07-22T09:05:00Z"),
			clock: systemClock,
		},
	};
}

function collectStrings(value: unknown): string[] {
	if (typeof value === "string") return [value];
	if (Array.isArray(value)) return value.flatMap(collectStrings);
	if (value && typeof value === "object") return Object.values(value).flatMap(collectStrings);
	return [];
}

async function cardLinksFor(caller: StubCaller): Promise<string[]> {
	state.caller = caller;
	const response = await complianceCommand.handler(context());
	expect(response.type).toBe("card");
	return collectStrings(response.type === "card" ? response.card : null);
}

describe("Teams compliance command", () => {
	// The handler imports these lazily; loading them once here keeps each test within its timeout.
	beforeAll(async () => {
		await Promise.all([
			import("@/lib/effect/runtime"),
			import("@/lib/effect/services/database.service"),
			import("@/lib/organization-action/settings-access"),
		]);
	}, 60_000);

	beforeEach(() => {
		state.summary = {
			alerts: [
				{
					id: "violation-1",
					type: "rest_period",
					severity: "violation",
					employeeId: "employee-2",
					employeeName: "Robin",
					date: new Date("2026-07-21T22:00:00Z"),
					details: "Rest Period Violation",
					hasException: false,
				},
			],
			pendingExceptions: [],
			recentViolationsCount: 1,
			criticalAlertsCount: 1,
		};
	});

	it("links the violations view for an org admin", async () => {
		const links = await cardLinksFor({
			userId: "user-1",
			activeOrganizationId: "org-1",
			membershipRole: "admin",
			employee: { id: "employee-1", role: "employee", former: false },
		});

		expect(links).toContain(VIOLATIONS_URL);
	});

	it("does not link the violations view for a manager, who cannot open it", async () => {
		const links = await cardLinksFor({
			userId: "user-1",
			activeOrganizationId: "org-1",
			membershipRole: "member",
			employee: { id: "employee-1", role: "manager", former: false },
		});

		expect(links).not.toContain(VIOLATIONS_URL);
		expect(links.join("\n")).toContain("Robin");
	});
});
