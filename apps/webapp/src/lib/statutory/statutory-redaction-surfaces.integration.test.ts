/**
 * #1994: strict wage and EUR redaction across every surface below org admin that carries statutory
 * findings (real PostgreSQL). One organization with an open finding in every statutory domain
 * (Minijob and short-term earnings of 675 EUR at 15 EUR/h against the 603 EUR limit), read by:
 *
 * - API (server actions): Employee Detail monitors (Minijob, short-term, working student, on-call
 *   status and reference calculator, apprentice release credits) as the scoped manager, the
 *   payroll reference rows, and every org-admin-only Reviews / settings action (refused);
 * - Scheduling: the schedule compliance evaluation (banner, publish dialog);
 * - Staffing: suggestions for a proposed shift;
 * - UI loaders: the employee's own profile (working-student balance, on-call reference hours,
 *   apprentice release credits) and the Compliance Command Center card (counts only).
 *
 * None of them may carry a wage, an EUR amount, an EUR cap, external earnings, an input
 * fingerprint or an admin's acknowledgement reason; earnings-derived findings (Minijob, the
 * Berufsmäßigkeit check) show their tier alone. The org admin's view is the control: the checker
 * finds the amounts there.
 */
import { Effect, Layer } from "effect";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { getWorkforceComplianceSection } from "@/lib/compliance-command-center/sections/workforce-compliance";
import { DatabaseServiceLive } from "@/lib/effect/services/database.service";
import {
	ScheduleComplianceService,
	ScheduleComplianceServiceLive,
} from "@/lib/effect/services/schedule-compliance.service";
import {
	StaffingSuggestionService,
	StaffingSuggestionServiceLive,
} from "@/lib/effect/services/staffing-suggestion.service";
import { WorkPolicyServiceLive } from "@/lib/effect/services/work-policy.service";
import { shiftDateBounds } from "@/lib/scheduling/shift-date";
import { integrationAdminPool } from "@/test/integration-database";
import type { StubCaller } from "@/test/organization-action";
import { type FixtureEmployee, statutoryFixture } from "@/test/statutory-fixtures";
import {
	STATUTORY_DOMAINS_NOW,
	type StatutoryDomainsSeed,
	statutoryDomainsFixture,
} from "./__tests__/statutory-domains-fixture";
import { loadOwnWorkingStudentStatus } from "./working-student/views";

const harness = vi.hoisted(() => ({
	caller: null as StubCaller | null,
	now: null as import("@/lib/datetime/temporal-core").Instant | null,
}));

// The actions and services read `systemClock`: judge the seeded weeks at the fixture's "now".
vi.mock("@/lib/datetime/temporal-core", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@/lib/datetime/temporal-core")>();
	return {
		...actual,
		systemClock: Object.freeze({
			nowInstant: () => harness.now ?? actual.systemClock.nowInstant(),
		}),
	};
});

vi.mock("@/lib/effect/runtime", async () => {
	const { db } = await import("@/db");
	const { organizationActionStubLayer } = await import("@/test/organization-action");
	return (await import("@/test/effect-runtime")).runtimeModuleOver(
		organizationActionStubLayer(() => harness.caller, { db }),
	);
});

const minijobActions = await import("@/app/[locale]/(app)/settings/employees/minijob-actions");
const apprenticeActions =
	await import("@/app/[locale]/(app)/settings/employees/apprentice-release-actions");
const shortTermActions = await import("@/app/[locale]/(app)/settings/contracts/short-term-actions");
const workingStudentActions =
	await import("@/app/[locale]/(app)/settings/contracts/working-student-actions");
const onCallActions = await import("@/app/[locale]/(app)/settings/contracts/on-call-actions");
const youthActions =
	await import("@/app/[locale]/(app)/settings/contracts/youth-sector-exception-actions");
const minijobReviewActions =
	await import("@/app/[locale]/(app)/settings/contracts/minijob-review-actions");
const statutoryActions = await import("@/app/[locale]/(app)/settings/contracts/statutory-actions");
const reviewActions =
	await import("@/app/[locale]/(app)/settings/contracts/statutory-review-actions");

/** EUR figures of the seeded organization: 675 EUR earned, 603 EUR limit, 15 EUR/h. */
const EUR_FIGURES = new Set([67_500, 60_300, 120_600, 675, 603, 1_500]);
const MONEY_KEYS = new Set([
	"amountsCents",
	"hourlyWageCents",
	"externalEarningsCents",
	"hourlyRate",
	"hourlyWage",
	"wage",
	"currency",
	"totalCents",
	"capCents",
	"doubleCapCents",
	"earnedCents",
	"plannedCents",
	"externalCents",
	"amountCents",
]);
const EARNINGS_DERIVED = /minijob|berufsmaessigkeit/i;

/** Every wage, EUR or admin-only detail in a payload, as `path: value`. */
function wageLeaks(payload: unknown): string[] {
	const leaks: string[] = [];
	const visit = (value: unknown, path: string, earningsDerived: boolean) => {
		if (value === null || value === undefined) return;
		if (typeof value === "number") {
			if (EUR_FIGURES.has(value)) leaks.push(`${path}: ${value}`);
			return;
		}
		if (typeof value === "string") {
			if (/€|\bEUR\b/.test(value) || /^v1:[0-9a-f]{16,}/.test(value)) {
				leaks.push(`${path}: ${value}`);
			}
			return;
		}
		if (value instanceof Date || typeof value !== "object") return;
		if (Array.isArray(value)) {
			value.forEach((item, index) => visit(item, `${path}[${index}]`, earningsDerived));
			return;
		}
		const record = value as Record<string, unknown>;
		const derived =
			earningsDerived ||
			[record.domain, record.kind, record.statutoryKind].some(
				(field) => typeof field === "string" && EARNINGS_DERIVED.test(field),
			);
		for (const [key, child] of Object.entries(record)) {
			const at = `${path}.${key}`;
			if (MONEY_KEYS.has(key) && child !== null && child !== undefined) leaks.push(at);
			else if (key === "adminDetail" && child !== null && child !== undefined) leaks.push(at);
			else if (key === "inputFingerprint" && child !== null && child !== undefined) leaks.push(at);
			else if (
				key === "acknowledgement" &&
				child &&
				typeof child === "object" &&
				((child as Record<string, unknown>).reason ||
					(child as Record<string, unknown>).acknowledgedBy)
			) {
				leaks.push(`${at}.reason`);
			} else if (
				derived &&
				key === "summary" &&
				child &&
				typeof child === "object" &&
				Object.keys(child).some((summaryKey) => summaryKey !== "tier")
			) {
				// A percentage of a public EUR cap, or time derived from it, reveals the earnings.
				leaks.push(`${at}: ${Object.keys(child).join(",")}`);
			} else visit(child, at, derived);
		}
	};
	visit(payload, "$", false);
	return leaks;
}

function expectWageFree(label: string, payload: unknown) {
	expect({ label, leaks: wageLeaks(payload) }).toEqual({ label, leaks: [] });
}

function dataOf<T>(result: { success: boolean; data?: T; error?: string }, label: string): T {
	expect({ label, success: result.success, error: result.error }).toMatchObject({
		label,
		success: true,
	});
	return result.data as T;
}

const complianceLayer = ScheduleComplianceServiceLive.pipe(
	Layer.provide(WorkPolicyServiceLive),
	Layer.provide(DatabaseServiceLive),
);
const staffingLayer = StaffingSuggestionServiceLive.pipe(
	Layer.provide(WorkPolicyServiceLive),
	Layer.provide(DatabaseServiceLive),
);

describe("statutory wage and EUR redaction on every restricted surface (PostgreSQL)", () => {
	vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 });
	const admin = integrationAdminPool();
	const fx = statutoryFixture(admin, "t1994-redact");
	const domains = statutoryDomainsFixture(admin, fx);
	let seed: StatutoryDomainsSeed;
	let manager: FixtureEmployee;

	const as = (who: FixtureEmployee, role: "employee" | "manager", membership = "member") => {
		harness.caller = {
			userId: who.userId,
			activeOrganizationId: seed.org.id,
			membershipRole: membership as "member",
			employee: { id: who.employeeId, role },
		};
	};
	const asOrgAdmin = () => {
		harness.caller = {
			userId: seed.owner.userId,
			activeOrganizationId: seed.org.id,
			membershipRole: "owner",
			employee: { id: seed.owner.employeeId, role: "admin" },
		};
	};
	const asManager = () => as(manager, "manager");

	beforeAll(async () => {
		harness.now = STATUTORY_DOMAINS_NOW;
		await fx.cleanup();
		seed = await domains.seed("a");
		manager = await fx.employee(seed.org, "a-manager", { role: "manager" });
		await fx.membership(seed.org, manager, "member");
		// Planned shifts in the judged window: Scheduling judges the employees it plans.
		for (const who of [seed.mini, seed.seasonal, seed.student]) {
			await domains.shift(seed.org, {
				employeeId: who.employeeId,
				date: "2026-11-26",
				startTime: "08:00",
				endTime: "14:00",
			});
		}
		for (const who of [
			seed.mini,
			seed.seasonal,
			seed.student,
			seed.caller,
			seed.minor,
			seed.learner,
		]) {
			await fx.membership(seed.org, who, "member");
			await admin.query(
				`insert into employee_managers (employee_id, manager_id, is_primary, assigned_by)
				 values ($1, $2, true, $3)`,
				[who.employeeId, manager.employeeId, seed.owner.userId],
			);
		}
	});
	afterAll(async () => {
		harness.caller = null;
		harness.now = null;
		await fx.cleanup();
	});

	it("finds the EUR detail in the org admin's own view (control)", async () => {
		asOrgAdmin();
		const adminView = dataOf(
			await minijobActions.getEmployeeMinijobMonitorAction({ employeeId: seed.mini.employeeId }),
			"minijob monitor (org admin)",
		);
		expect(wageLeaks(adminView).length).toBeGreaterThan(0);
	});

	it("keeps Employee Detail monitors wage-free for the scoped manager (API)", async () => {
		asManager();
		const surfaces = {
			minijobMonitor: await minijobActions.getEmployeeMinijobMonitorAction({
				employeeId: seed.mini.employeeId,
			}),
			shortTermMonitor: await shortTermActions.getShortTermMonitorAction({
				employeeId: seed.seasonal.employeeId,
			}),
			workingStudentMonitor: await workingStudentActions.getWorkingStudentMonitorAction({
				employeeId: seed.student.employeeId,
			}),
			onCallStatus: await onCallActions.getEmployeeOnCallStatusAction({
				employeeId: seed.caller.employeeId,
			}),
			onCallReferenceCalculator: await onCallActions.getOnCallReferencePeriodAction({
				employeeId: seed.caller.employeeId,
				eventDate: "2026-11-17",
				method: "three_months",
			}),
			apprenticeReleaseCredits: await apprenticeActions.getApprenticeReleaseCreditsAction({
				employeeId: seed.learner.employeeId,
			}),
		};
		for (const [label, result] of Object.entries(surfaces)) {
			expectWageFree(label, dataOf(result, label));
		}
		// The earnings-derived Berufsmäßigkeit check is an org-admin review: not even its tier.
		expect(JSON.stringify(dataOf(surfaces.shortTermMonitor, "short-term"))).not.toContain(
			"short_term_berufsmaessigkeit_check",
		);
		// The Minijob monitor itself says the scoped manager reads the restricted view.
		expect(dataOf(surfaces.minijobMonitor, "minijob")).toMatchObject({ audience: "restricted" });
	});

	it("refuses every org-admin-only statutory action to the scoped manager (API)", async () => {
		asManager();
		const refused = {
			minijobReviews: await minijobReviewActions.listMinijobExceedanceReviewsAction({
				includeAcknowledged: true,
			}),
			berufsmaessigkeitReviews: await shortTermActions.listShortTermBerufsmaessigkeitReviewsAction({
				includeResolved: true,
			}),
			onCallReviews: await onCallActions.listOnCallReviewItemsAction({}),
			workingStudentReviews: await workingStudentActions.listWorkingStudentReviewsAction(),
			youthSectorExceptions: await youthActions.listYouthSectorExceptionsAction({}),
			monitorFindings: await reviewActions.listStatutoryMonitorFindingsAction(),
			acknowledgementHistory: await reviewActions.listStatutoryAcknowledgementHistoryAction({
				employeeId: seed.mini.employeeId,
				acknowledgementKind: "minijob_unforeseeable_exceedance",
				findingKind: "minijob_monthly_cap",
				subjectKey: "2026-11",
				currentInputFingerprint: "",
				currentStatus: "none",
			}),
			statutorySettings: await statutoryActions.getStatutorySettingsAction(),
			payrollReferenceRows: await onCallActions.listOnCallPayrollReferenceRowsAction({
				startDate: "2026-11-01",
				endDate: "2026-11-30",
				method: "three_months",
			}),
			// An employee the manager does not manage.
			unmanagedMinijobMonitor: await minijobActions.getEmployeeMinijobMonitorAction({
				employeeId: seed.owner.employeeId,
			}),
		};
		for (const [label, result] of Object.entries(refused)) {
			expect({ label, success: result.success }).toEqual({ label, success: false });
		}
	});

	it("keeps Scheduling's compliance evaluation wage-free with earnings-derived findings as a tier", async () => {
		const evaluation = await Effect.runPromise(
			Effect.gen(function* () {
				const service = yield* ScheduleComplianceService;
				return yield* service.evaluateScheduleWindow({
					organizationId: seed.org.id,
					startDate: shiftDateBounds("2026-11-01", seed.org.timezone).start,
					endDateExclusive: shiftDateBounds("2026-11-30", seed.org.timezone).start,
					timezone: seed.org.timezone,
				});
			}).pipe(Effect.provide(complianceLayer)),
		);
		const statutory = evaluation.findings.filter((finding) => finding.type === "statutory");
		expect(statutory.map((finding) => finding.domain)).toEqual(
			// The Berufsmäßigkeit prompt is an org-admin review, not a scheduling limit.
			expect.arrayContaining(["minijob", "working_student", "on_call", "youth_protection"]),
		);
		expect(statutory.find((finding) => finding.domain === "minijob")?.summary).toEqual({
			tier: "exceeded",
		});
		expectWageFree("schedule compliance", evaluation);
	});

	it("keeps Staffing suggestions wage-free", async () => {
		const suggestions = await Effect.runPromise(
			Effect.gen(function* () {
				const service = yield* StaffingSuggestionService;
				return yield* service.suggestForShift({
					organizationId: seed.org.id,
					timezone: seed.org.timezone,
					candidates: [seed.mini, seed.seasonal, seed.student, seed.minor].map((who, index) => ({
						employeeId: who.employeeId,
						displayName: `Candidate ${index}`,
						isActive: true,
					})),
					shift: {
						subareaId: seed.org.subareaId,
						date: "2026-11-28",
						startTime: "08:00",
						endTime: "16:00",
					},
				});
			}).pipe(Effect.provide(staffingLayer)),
		);
		const warnings = suggestions.flatMap((suggestion) => suggestion.warnings);
		// The Minijobber's Saturday shift deepens the exceeded month; the minor's is weekend work.
		expect(
			warnings.some(
				(warning) => warning.type === "compliance" && warning.findingType === "statutory",
			),
		).toBe(true);
		expectWageFree("staffing suggestions", suggestions);
	});

	it("shows employees their own status without wages (profile UI loaders)", async () => {
		const ownWorkingStudent = await loadOwnWorkingStudentStatus(db, {
			organizationId: seed.org.id,
			employeeId: seed.student.employeeId,
			now: STATUTORY_DOMAINS_NOW,
		});
		expect(ownWorkingStudent).not.toBeNull();
		expectWageFree("own working-student balance", ownWorkingStudent);

		as(seed.caller, "employee");
		expectWageFree(
			"own on-call status",
			dataOf(
				await onCallActions.getEmployeeOnCallStatusAction({ employeeId: seed.caller.employeeId }),
				"own on-call status",
			),
		);
		expectWageFree(
			"own on-call reference calculation",
			dataOf(
				await onCallActions.getOnCallReferencePeriodAction({
					employeeId: seed.caller.employeeId,
					eventDate: "2026-11-17",
					method: "thirteen_weeks",
				}),
				"own on-call reference calculation",
			),
		);

		as(seed.learner, "employee");
		expectWageFree(
			"own apprentice release credits",
			dataOf(
				await apprenticeActions.getOwnApprenticeReleaseCreditsAction(),
				"own apprentice release credits",
			),
		);

		// A Minijobber does not read the EUR monitor at all, not even their own.
		as(seed.mini, "employee");
		expect(
			await minijobActions.getEmployeeMinijobMonitorAction({ employeeId: seed.mini.employeeId }),
		).toMatchObject({ success: false });
	});

	it("keeps the Compliance Command Center card to counts", async () => {
		const section = await getWorkforceComplianceSection(seed.org.id, {
			now: STATUTORY_DOMAINS_NOW,
		});
		expectWageFree("compliance command center", section);
	});
});
