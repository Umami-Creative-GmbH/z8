import { DateTime } from "luxon";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => {
	const violationGroupBy = vi.fn();
	const violationWhere = vi.fn(() => ({ groupBy: violationGroupBy }));
	const violationFrom = vi.fn(() => ({ where: violationWhere }));
	const exceptionWhere = vi.fn();
	const exceptionFrom = vi.fn(() => ({ where: exceptionWhere }));

	return {
		select: vi.fn(),
		loadStatutoryReviewInbox: vi.fn(),
		violationWhere,
		violationGroupBy,
		exceptionWhere,
		configureSelectChain() {
			this.select
				.mockImplementationOnce(() => ({ from: violationFrom }))
				.mockImplementationOnce(() => ({ from: exceptionFrom }));
		},
	};
});

vi.mock("drizzle-orm", () => ({
	and: vi.fn((...args: unknown[]) => ({ and: args })),
	eq: vi.fn((left: unknown, right: unknown) => ({ eq: [left, right] })),
	gt: vi.fn((left: unknown, right: unknown) => ({ gt: [left, right] })),
	gte: vi.fn((left: unknown, right: unknown) => ({ gte: [left, right] })),
	sql: vi.fn((strings: TemplateStringsArray) => strings.join("?")),
}));

vi.mock("@/db", () => ({
	db: {
		select: mockState.select,
	},
}));

vi.mock("@/db/schema", () => ({
	complianceException: {
		createdAt: "complianceException.createdAt",
		organizationId: "complianceException.organizationId",
		status: "complianceException.status",
		validUntil: "complianceException.validUntil",
	},
	workPolicyViolation: {
		organizationId: "workPolicyViolation.organizationId",
		violationDate: "workPolicyViolation.violationDate",
		violationType: "workPolicyViolation.violationType",
	},
}));

vi.mock("@/lib/statutory/review-inbox", () => ({
	loadStatutoryReviewInbox: mockState.loadStatutoryReviewInbox,
}));

const { deriveWorkforceComplianceSection, getWorkforceComplianceSection } =
	await import("./workforce-compliance");

const REVIEW_EXCEPTIONS = {
	label: { key: "compliance.commandCenter.links.reviewComplianceExceptions" },
	href: "/approvals/inbox?types=compliance_exception",
};
const REVIEW_VIOLATIONS = {
	label: { key: "compliance.commandCenter.links.reviewPolicyViolations" },
	href: "/settings/work-policies?tab=work&view=compliance",
};

describe("deriveWorkforceComplianceSection", () => {
	it("marks the section critical when rest-period or max-hours violations exist", () => {
		const result = deriveWorkforceComplianceSection({
			restPeriodViolations: 1,
			generalPolicyViolations: 0,
			overtimeViolations: 2,
			pendingExceptions: 0,
			latestViolationAt: DateTime.utc().minus({ hours: 2 }).toISO(),
			latestPendingExceptionAt: null,
		});

		expect(result.card.status).toBe("critical");
		expect(result.card.facts).toContainEqual({
			key: "compliance.commandCenter.facts.workforce.restPeriodViolations",
			params: { count: 1 },
		});
	});

	it("falls back to warning for overtime-only drift", () => {
		const result = deriveWorkforceComplianceSection({
			restPeriodViolations: 0,
			generalPolicyViolations: 0,
			overtimeViolations: 3,
			pendingExceptions: 1,
			latestViolationAt: DateTime.utc().minus({ days: 1 }).toISO(),
			latestPendingExceptionAt: null,
		});

		expect(result.card.status).toBe("warning");
	});

	const quietPolicy = {
		restPeriodViolations: 0,
		generalPolicyViolations: 0,
		overtimeViolations: 0,
		pendingExceptions: 0,
		latestViolationAt: null,
		latestPendingExceptionAt: null,
		evaluatedAt: "2026-11-18T10:00:00Z",
	};
	const domain = (
		name: "minijob" | "short_term" | "working_student" | "on_call" | "youth_apprentice",
		counts: Partial<{
			critical: number;
			warning: number;
			pendingAcknowledgements: number;
			staleAcknowledgements: number;
		}> = {},
		status: "loaded" | "unavailable" = "loaded",
	) => ({
		domain: name,
		status,
		critical: 0,
		warning: 0,
		pendingAcknowledgements: 0,
		staleAcknowledgements: 0,
		...counts,
	});

	it("turns critical for a critical statutory finding and links its domain's reviews", () => {
		const result = deriveWorkforceComplianceSection({
			...quietPolicy,
			statutory: [
				domain("minijob", { critical: 2, pendingAcknowledgements: 1 }),
				domain("on_call"),
			],
		});

		expect(result.card.status).toBe("critical");
		expect(result.card.links).toEqual([
			{
				label: {
					key: "compliance.commandCenter.links.statutoryDomain.minijob",
					params: { count: 2 },
				},
				href: "/settings/contracts?tab=reviews&domain=minijob",
			},
		]);
		// A standing backlog, not an event: it stays out of "Recent critical events".
		expect(result.recentCriticalEvents).toEqual([]);
	});

	it("warns about an acknowledgement invalidated by newer work even without an open warning", () => {
		const result = deriveWorkforceComplianceSection({
			...quietPolicy,
			statutory: [domain("working_student", { staleAcknowledgements: 1 })],
		});

		expect(result.card.status).toBe("warning");
		expect(result.card.facts).toContainEqual({
			key: "compliance.commandCenter.facts.workforce.statutoryAcknowledgements",
			params: { pending: 0, stale: 1 },
		});
	});

	it("links every domain an org admin has to act on, acknowledgements alone included", () => {
		const result = deriveWorkforceComplianceSection({
			...quietPolicy,
			statutory: [
				domain("minijob", { pendingAcknowledgements: 2 }),
				domain("working_student", { staleAcknowledgements: 1 }),
				domain("short_term"),
				domain("on_call", {}, "unavailable"),
			],
		});

		expect(result.card.status).toBe("warning");
		expect(result.card.links).toEqual([
			{
				label: {
					key: "compliance.commandCenter.links.statutoryDomain.minijob",
					params: { count: 2 },
				},
				href: "/settings/contracts?tab=reviews&domain=minijob",
			},
			{
				label: {
					key: "compliance.commandCenter.links.statutoryDomain.working_student",
					params: { count: 1 },
				},
				href: "/settings/contracts?tab=reviews&domain=working_student",
			},
		]);
		// An unreadable domain has nothing to open: it is reported as a fact.
		expect(result.card.facts).toContainEqual({
			key: "compliance.commandCenter.facts.workforce.statutoryUnavailable",
		});
	});

	it("reports statutory monitors it could not read instead of calling them healthy", () => {
		const unreadable = deriveWorkforceComplianceSection({ ...quietPolicy, statutory: null });
		const partly = deriveWorkforceComplianceSection({
			...quietPolicy,
			statutory: [domain("minijob"), domain("on_call", {}, "unavailable")],
		});

		for (const result of [unreadable, partly]) {
			expect(result.card.status).toBe("warning");
			expect(result.card.facts).toContainEqual({
				key: "compliance.commandCenter.facts.workforce.statutoryUnavailable",
			});
		}
	});

	it("sends exception triage to the Approval inbox's compliance exceptions (#1977)", () => {
		const result = deriveWorkforceComplianceSection({
			restPeriodViolations: 1,
			generalPolicyViolations: 0,
			overtimeViolations: 0,
			pendingExceptions: 2,
			latestViolationAt: "2026-04-11T10:00:00.000Z",
			latestPendingExceptionAt: "2026-04-11T08:00:00.000Z",
		});

		expect(result.card.primaryLink).toEqual(REVIEW_EXCEPTIONS);
		expect(result.recentCriticalEvents.map((event) => event.primaryLink)).toEqual([
			REVIEW_VIOLATIONS,
			REVIEW_EXCEPTIONS,
		]);
	});

	it("sends the violations event to the work-policy violations, not the exceptions (#1977)", () => {
		const result = deriveWorkforceComplianceSection({
			restPeriodViolations: 1,
			generalPolicyViolations: 2,
			overtimeViolations: 3,
			pendingExceptions: 0,
			latestViolationAt: "2026-04-11T10:00:00.000Z",
			latestPendingExceptionAt: null,
		});

		expect(result.recentCriticalEvents).toEqual([
			{
				id: "workforce-violations",
				sectionKey: "workforceCompliance",
				severity: "critical",
				title: { key: "compliance.commandCenter.events.workforceFindings.title" },
				description: {
					key: "compliance.commandCenter.events.workforceFindings.description",
					params: { restPeriodViolations: 1, generalPolicyViolations: 2, overtimeViolations: 3 },
				},
				occurredAt: "2026-04-11T10:00:00.000Z",
				primaryLink: REVIEW_VIOLATIONS,
			},
		]);
	});

	it("raises pending exceptions as their own event, linked to the Approval inbox (#1977)", () => {
		const result = deriveWorkforceComplianceSection({
			restPeriodViolations: 0,
			generalPolicyViolations: 0,
			overtimeViolations: 0,
			pendingExceptions: 2,
			latestViolationAt: null,
			latestPendingExceptionAt: "2026-04-11T08:00:00.000Z",
		});

		expect(result.recentCriticalEvents).toEqual([
			{
				id: "workforce-pending-exceptions",
				sectionKey: "workforceCompliance",
				severity: "warning",
				title: { key: "compliance.commandCenter.events.pendingExceptions.title" },
				description: {
					key: "compliance.commandCenter.events.pendingExceptions.description",
					params: { count: 2 },
				},
				occurredAt: "2026-04-11T08:00:00.000Z",
				primaryLink: REVIEW_EXCEPTIONS,
			},
		]);
	});
});

describe("getWorkforceComplianceSection", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockState.configureSelectChain();
		mockState.loadStatutoryReviewInbox.mockResolvedValue({ items: [], domains: [] });
	});

	it("degrades to an unavailable statutory fact when the monitors fail", async () => {
		mockState.violationGroupBy.mockResolvedValue([]);
		mockState.exceptionWhere.mockResolvedValue([{ count: 0 }]);
		mockState.loadStatutoryReviewInbox.mockRejectedValue(new Error("monitor down"));
		const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

		const result = await getWorkforceComplianceSection("org-1");

		expect(result.card.facts).toContainEqual({
			key: "compliance.commandCenter.facts.workforce.statutoryUnavailable",
		});
		expect(mockState.loadStatutoryReviewInbox).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({ organizationId: "org-1" }),
		);
		consoleError.mockRestore();
	});

	it("counts non-overtime policy violations toward the critical max-hours bucket", async () => {
		mockState.violationGroupBy.mockResolvedValue([
			{
				violationType: "max_weekly",
				count: 1,
				latestViolationAt: new Date("2026-04-11T10:00:00.000Z"),
			},
			{
				violationType: "break_required",
				count: 2,
				latestViolationAt: new Date("2026-04-11T11:00:00.000Z"),
			},
		]);
		mockState.exceptionWhere.mockResolvedValue([{ count: 0 }]);

		const result = await getWorkforceComplianceSection("org-1");

		expect(result.card.status).toBe("critical");
		expect(result.card.facts).toContainEqual({
			key: "compliance.commandCenter.facts.workforce.generalPolicyViolations",
			params: { count: 3 },
		});
	});

	it("limits pending exception requests to the same seven-day lookback", async () => {
		mockState.violationGroupBy.mockResolvedValue([]);
		mockState.exceptionWhere.mockResolvedValue([{ count: 0 }]);

		await getWorkforceComplianceSection("org-1");

		expect(mockState.exceptionWhere).toHaveBeenCalledWith(
			expect.objectContaining({
				and: expect.arrayContaining([
					{ eq: ["complianceException.organizationId", "org-1"] },
					{
						and: [
							{ eq: ["complianceException.status", "pending"] },
							{ gt: ["complianceException.validUntil", expect.any(Date)] },
						],
					},
					expect.objectContaining({
						gte: ["complianceException.createdAt", expect.any(Date)],
					}),
				]),
			}),
		);
	});

	it("dates the pending-exceptions event by the latest pending request (#1977)", async () => {
		mockState.violationGroupBy.mockResolvedValue([]);
		mockState.exceptionWhere.mockResolvedValue([
			{ count: 1, latestPendingExceptionAt: new Date("2026-04-11T08:00:00.000Z") },
		]);

		const result = await getWorkforceComplianceSection("org-1");

		expect(result.recentCriticalEvents.map((event) => event.occurredAt)).toEqual([
			"2026-04-11T08:00:00.000Z",
		]);
	});
});
