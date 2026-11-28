import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	absenceCategory,
	absenceEntry,
	vacationAllowance,
	vacationCarryoverTransfer,
	vacationEarningYearLeave,
	vacationPolicyAssignment,
	vacationPolicyExpiryClassification,
} from "@/db/schema";
import {
	createLifecycleDatabaseFixture,
	type LifecycleDatabaseFixture,
} from "@/lib/employee-lifecycle/testing/database.test.fixture";

const session = vi.hoisted(() => ({ userId: "", organizationId: "" }));
vi.mock("next/headers", async () => (await import("@/test/integration-harness")).nextHeaders());
vi.mock("next/server", async (original) =>
	(await import("@/test/integration-harness")).nextServer(original),
);
vi.mock("next/cache", async (original) =>
	(await import("@/test/integration-harness")).nextCache(original),
);
vi.mock("@/lib/auth", () => ({
	auth: {
		api: {
			getSession: async () => ({
				user: { id: session.userId, role: "user", email: "leave@test.invalid" },
				session: {
					id: session.userId,
					userId: session.userId,
					activeOrganizationId: session.organizationId,
				},
			}),
		},
	},
}));
vi.mock("@/lib/queue", async (original) =>
	(await import("@/test/integration-harness")).calendarSyncQueue(original),
);
vi.mock("@/lib/notifications/triggers", async (original) =>
	(await import("@/test/integration-harness")).notificationTriggers(original),
);
vi.mock("@/lib/approvals/delivery/kick", async () =>
	(await import("@/test/integration-harness")).deliveryKick(),
);
vi.mock("@/lib/billing/guard", async () =>
	(await import("@/test/integration-harness")).billingGuard(),
);

const { calculateAnnualCarryover, expireCarryoverDays } = await import("./vacation.service");
const { loadVacationBalances } = await import("./vacation-balance-store");
const { classifyVacationPolicyExpiryRules } =
	await import("@/app/[locale]/(app)/settings/vacation/expiry-classification-actions");

const BERLIN = "Europe/Berlin";
const LAST_VALID_INSTANT = new Date("2028-06-30T21:59:59.999Z");
const AFTER_DEADLINE = new Date("2028-07-01T00:00:00Z");

describe("leave keeps its earning year and earning policy (#2080)", () => {
	vi.setConfig({ testTimeout: 90000, hookTimeout: 90000 });
	let fixture: LifecycleDatabaseFixture;
	let employeeId: string;
	let employeeUserId: string;
	let memberUserId: string;
	let categoryId: string;

	beforeEach(async () => {
		fixture = await createLifecycleDatabaseFixture();
		await fixture.pool.query(
			"update vacation_policy_rollout set baseline_date=DATE '2026-01-01', calculations_enabled=true where organization_id=$1",
			[fixture.organizationId],
		);
		const person = await fixture.seedEmployee({
			role: "member",
			startDate: new Date("2020-01-01T00:00:00Z"),
			withPeriod: false,
		});
		employeeId = person.employeeId;
		employeeUserId = person.userId;
		memberUserId = (await fixture.seedEmployee({ role: "member" })).userId;
		const [category] = await fixture.db
			.insert(absenceCategory)
			.values({
				organizationId: fixture.organizationId,
				name: "Vacation",
				type: "vacation",
				countsAgainstVacation: true,
				requiresApproval: false,
			})
			.returning();
		categoryId = category.id;
		session.userId = fixture.ownerUserId;
		session.organizationId = fixture.organizationId;
	});
	afterEach(async () => {
		vi.useRealTimers();
		await fixture?.close();
	});

	/** 24-day 2027 source policy (cap 7, carryover allowed unless overridden) and a 2028 receiving policy. */
	async function seedPolicies(
		source: {
			allowCarryover?: boolean;
			maxCarryoverDays?: string | null;
			statutoryMinimumDays?: string;
			receiving?: { allowCarryover?: boolean };
		} = {},
	) {
		const [fallback, sourcePolicy, receiving] = await fixture.db
			.insert(vacationAllowance)
			.values([
				{
					organizationId: fixture.organizationId,
					name: "Default no carry",
					startDate: "2026-01-01",
					isCompanyDefault: true,
					defaultAnnualDays: "30",
					statutoryMinimumDays: "20",
					accrualType: "annual" as const,
					createdBy: fixture.ownerUserId,
				},
				{
					organizationId: fixture.organizationId,
					name: "Source 2027",
					startDate: "2027-01-01",
					validUntil: "2027-12-31",
					defaultAnnualDays: "24",
					statutoryMinimumDays: source.statutoryMinimumDays ?? "20",
					accrualType: "annual" as const,
					allowCarryover: source.allowCarryover ?? true,
					maxCarryoverDays: source.maxCarryoverDays === undefined ? "7" : source.maxCarryoverDays,
					createdBy: fixture.ownerUserId,
				},
				{
					organizationId: fixture.organizationId,
					name: "Receiving 2028",
					startDate: "2028-01-01",
					defaultAnnualDays: "30",
					statutoryMinimumDays: "20",
					accrualType: "annual" as const,
					allowCarryover: source.receiving?.allowCarryover ?? false,
					carryoverExpiryMonths: 6,
					createdBy: fixture.ownerUserId,
				},
			])
			.returning();
		await fixture.db.insert(vacationPolicyAssignment).values([
			{
				organizationId: fixture.organizationId,
				policyId: sourcePolicy.id,
				assignmentType: "employee" as const,
				employeeId,
				effectiveStartDate: "2027-01-01",
				effectiveEndDate: "2028-01-01",
				createdBy: fixture.ownerUserId,
			},
			{
				organizationId: fixture.organizationId,
				policyId: receiving.id,
				assignmentType: "employee" as const,
				employeeId,
				effectiveStartDate: "2028-01-01",
				createdBy: fixture.ownerUserId,
			},
		]);
		return { fallback, source: sourcePolicy, receiving };
	}

	async function takeVacation2027(startDate: string, endDate: string) {
		await fixture.db.insert(absenceEntry).values({
			organizationId: fixture.organizationId,
			employeeId,
			categoryId,
			startDate,
			endDate,
			status: "approved" as const,
		});
	}

	async function classify(
		policyId: string,
		expiryRules: "german" | "policy_terms",
		extra?: { basis: string },
	) {
		const result = await classifyVacationPolicyExpiryRules({
			policyId,
			expiryRules,
			extraDaysSeparateTerms: Boolean(extra),
			extraDaysTermsBasis: extra?.basis ?? null,
		});
		if (!result.success) throw new Error(result.error);
		return result.data;
	}

	async function balance2028(currentDate: Date) {
		const balances = await loadVacationBalances(fixture.db, {
			organizationId: fixture.organizationId,
			employeeIds: [employeeId],
			year: 2028,
			timezone: BERLIN,
			currentDate,
		});
		return balances.balances.get(employeeId);
	}

	async function carry2027() {
		const run = await calculateAnnualCarryover(
			fixture.organizationId,
			2027,
			fixture.ownerUserId,
			BERLIN,
		);
		return run.results.find((row) => row.employeeId === employeeId);
	}

	it("keeps all 24 unused days of an unclassified earning policy requestable although carryover is disabled", async () => {
		const { source } = await seedPolicies({ allowCarryover: false });
		expect(await carry2027()).toMatchObject({
			previousYearRemaining: 24,
			carryoverApplied: 24,
			carryoverCapped: false,
			expiryDate: null,
		});
		expect(
			await expireCarryoverDays(
				fixture.organizationId,
				fixture.ownerUserId,
				AFTER_DEADLINE,
				BERLIN,
			),
		).toMatchObject({ employeesAffected: 0, daysExpired: 0 });
		const balance = await balance2028(AFTER_DEADLINE);
		expect(balance).toMatchObject({ totalDays: 54, carryoverDays: 24, remainingDays: 54 });
		expect(balance?.carryoverExpiryDate).toBeUndefined();
		expect(balance?.earningYears).toEqual([
			expect.objectContaining({
				earningYear: 2027,
				earningPolicyId: source.id,
				protection: "unclassified",
				days: 24,
				remainingDays: 24,
				expiryDate: null,
			}),
		]);

		// The employee can request all of it through the normal request entry point.
		vi.useFakeTimers({ toFake: ["Date"] });
		vi.setSystemTime(new Date("2028-08-01T08:00:00Z"));
		session.userId = employeeUserId;
		const { requestAbsenceEffect } =
			await import("@/app/[locale]/(app)/absences/request-absence-effect");
		const request = await requestAbsenceEffect({
			categoryId,
			startDate: "2028-08-01",
			endDate: "2028-10-13",
			startPeriod: "full_day",
			endPeriod: "full_day",
		});
		expect(request.success).toBe(true);
		const afterRequest = await balance2028(new Date("2028-08-01T08:00:00Z"));
		expect(afterRequest).toMatchObject({ usedDays: 54, remainingDays: 0, overdrawnDays: 0 });
	});

	it("keeps seven transferred German-protected days through their scheduled expiry without evidence", async () => {
		const { source, receiving } = await seedPolicies();
		await classify(source.id, "german");
		await classify(receiving.id, "german");
		await takeVacation2027("2027-03-01", "2027-03-23"); // 17 working days
		expect(await carry2027()).toMatchObject({
			previousYearRemaining: 7,
			carryoverApplied: 7,
			expiryDate: null,
		});
		const runs = await Promise.all(
			[LAST_VALID_INSTANT, AFTER_DEADLINE, AFTER_DEADLINE].map((at) =>
				expireCarryoverDays(fixture.organizationId, "system-automation", at, BERLIN),
			),
		);
		expect(runs.reduce((sum, run) => sum + run.daysExpired, 0)).toBe(0);
		expect(await balance2028(AFTER_DEADLINE)).toMatchObject({
			totalDays: 37,
			carryoverDays: 7,
			earningYears: [
				expect.objectContaining({
					earningYear: 2027,
					earningPolicyId: source.id,
					protection: "german_protection",
					remainingDays: 7,
				}),
			],
		});
	});

	it("keeps an existing seven-day transfer once HR designates its earning policy German", async () => {
		const { source } = await seedPolicies();
		await takeVacation2027("2027-03-01", "2027-03-23");
		// Committed while unclassified: the full remainder carries with the policy's frozen deadline.
		expect(await carry2027()).toMatchObject({ carryoverApplied: 7, expiryDate: null });
		await classify(source.id, "german");
		expect(
			await expireCarryoverDays(
				fixture.organizationId,
				fixture.ownerUserId,
				AFTER_DEADLINE,
				BERLIN,
			),
		).toMatchObject({ daysExpired: 0 });
		expect(await balance2028(AFTER_DEADLINE)).toMatchObject({ carryoverDays: 7 });
	});

	it("applies the policy's own cap and deadline once, after HR chose policy terms", async () => {
		const { source, receiving } = await seedPolicies();
		await classify(source.id, "policy_terms");
		await classify(receiving.id, "policy_terms");
		expect(await carry2027()).toMatchObject({
			previousYearRemaining: 24,
			carryoverApplied: 7,
			carryoverCapped: true,
			expiryDate: LAST_VALID_INSTANT,
		});
		expect(
			await expireCarryoverDays(
				fixture.organizationId,
				fixture.ownerUserId,
				LAST_VALID_INSTANT,
				BERLIN,
			),
		).toMatchObject({ employeesAffected: 0 });
		const runs = await Promise.all(
			[1, 2].map(() =>
				expireCarryoverDays(fixture.organizationId, "system-automation", AFTER_DEADLINE, BERLIN),
			),
		);
		expect(runs.reduce((sum, run) => sum + run.daysExpired, 0)).toBe(7);
		expect(await balance2028(AFTER_DEADLINE)).toMatchObject({ totalDays: 30 });
		const [row] = await fixture.db
			.select()
			.from(vacationEarningYearLeave)
			.where(eq(vacationEarningYearLeave.employeeId, employeeId));
		expect(row).toMatchObject({
			earningYear: 2027,
			receivingYear: 2028,
			earningPolicyId: source.id,
			days: "7",
			forfeitedDays: "17",
			expiredDays: "7",
			expiredBy: "system-automation",
		});
	});

	it("protects extra contractual days unless HR records separate terms, and then only those follow the cap and deadline", async () => {
		const { source, receiving } = await seedPolicies({ maxCarryoverDays: "2" });
		await classify(source.id, "german", {
			basis: "Employment contract §7: extra days lapse on 30 June",
		});
		await classify(receiving.id, "german");
		expect(await carry2027()).toMatchObject({
			previousYearRemaining: 24,
			carryoverApplied: 22,
			carryoverCapped: true,
			expiryDate: LAST_VALID_INSTANT,
		});
		expect(
			await expireCarryoverDays(
				fixture.organizationId,
				fixture.ownerUserId,
				AFTER_DEADLINE,
				BERLIN,
			),
		).toMatchObject({ daysExpired: 2 });
		expect(await balance2028(AFTER_DEADLINE)).toMatchObject({
			totalDays: 50,
			earningYears: [
				expect.objectContaining({
					portion: "extra",
					protection: "separate_terms",
					remainingDays: 0,
				}),
				expect.objectContaining({
					portion: "statutory",
					protection: "german_protection",
					remainingDays: 20,
				}),
			],
		});
	});

	it("does not treat a general cap or deadline on a German policy as separate terms", async () => {
		const { source, receiving } = await seedPolicies({ maxCarryoverDays: "2" });
		await classify(source.id, "german");
		await classify(receiving.id, "german");
		expect(await carry2027()).toMatchObject({ carryoverApplied: 24, carryoverCapped: false });
	});

	it("keeps the 2027 earning year and policy across the next year-end after a policy change", async () => {
		const { source, receiving } = await seedPolicies({ allowCarryover: false });
		await classify(receiving.id, "policy_terms");
		await carry2027();
		const next = await calculateAnnualCarryover(
			fixture.organizationId,
			2028,
			fixture.ownerUserId,
			BERLIN,
		);
		expect(next.results.find((row) => row.employeeId === employeeId)).toMatchObject({
			previousYearRemaining: 54,
			carryoverApplied: 24,
			expiryDate: null,
		});
		const balances = await loadVacationBalances(fixture.db, {
			organizationId: fixture.organizationId,
			employeeIds: [employeeId],
			year: 2029,
			timezone: BERLIN,
			currentDate: new Date("2029-09-01T00:00:00Z"),
		});
		expect(balances.balances.get(employeeId)).toMatchObject({
			totalDays: 54,
			earningYears: [
				expect.objectContaining({
					earningYear: 2027,
					earningPolicyId: source.id,
					protection: "unclassified",
					remainingDays: 24,
				}),
			],
		});
	});

	describe("HR designation of an earning policy", () => {
		it("records the designation once with its author and refuses to change it", async () => {
			const { source } = await seedPolicies();
			const recorded = await classify(source.id, "german", { basis: "Contract §7" });
			expect(recorded).toMatchObject({ policyId: source.id, expiryRules: "german" });
			const stored = await fixture.db.query.vacationPolicyExpiryClassification.findFirst({
				where: eq(vacationPolicyExpiryClassification.policyId, source.id),
			});
			expect(stored).toMatchObject({
				organizationId: fixture.organizationId,
				classifiedBy: fixture.ownerUserId,
				extraDaysSeparateTerms: true,
				extraDaysTermsBasis: "Contract §7",
			});
			const again = await classifyVacationPolicyExpiryRules({
				policyId: source.id,
				expiryRules: "policy_terms",
				extraDaysSeparateTerms: false,
				extraDaysTermsBasis: null,
			});
			expect(again).toMatchObject({ success: false, refusal: "already_classified" });
		});

		it("requires a basis for separate terms and refuses them outside German rules", async () => {
			const { source } = await seedPolicies();
			expect(
				await classifyVacationPolicyExpiryRules({
					policyId: source.id,
					expiryRules: "german",
					extraDaysSeparateTerms: true,
					extraDaysTermsBasis: "  ",
				}),
			).toMatchObject({ success: false });
			expect(
				await classifyVacationPolicyExpiryRules({
					policyId: source.id,
					expiryRules: "policy_terms",
					extraDaysSeparateTerms: true,
					extraDaysTermsBasis: "Contract",
				}),
			).toMatchObject({ success: false });
		});

		it("refuses members and policies of another organization", async () => {
			const { source } = await seedPolicies();
			session.userId = memberUserId;
			expect(
				await classifyVacationPolicyExpiryRules({
					policyId: source.id,
					expiryRules: "german",
					extraDaysSeparateTerms: false,
					extraDaysTermsBasis: null,
				}),
			).toMatchObject({ success: false });
			session.userId = fixture.ownerUserId;
			const otherOrganizationId = await fixture.createOrganization();
			const [foreign] = await fixture.db
				.insert(vacationAllowance)
				.values({
					organizationId: otherOrganizationId,
					name: "Foreign",
					startDate: "2027-01-01",
					defaultAnnualDays: "30",
					statutoryMinimumDays: "20",
					accrualType: "annual" as const,
					createdBy: fixture.ownerUserId,
				})
				.returning();
			expect(
				await classifyVacationPolicyExpiryRules({
					policyId: foreign.id,
					expiryRules: "german",
					extraDaysSeparateTerms: false,
					extraDaysTermsBasis: null,
				}),
			).toMatchObject({ success: false, refusal: "policy_not_found" });
			expect(
				await fixture.db.query.vacationPolicyExpiryClassification.findMany({
					where: and(eq(vacationPolicyExpiryClassification.policyId, foreign.id)),
				}),
			).toEqual([]);
		});
	});

	it("gives existing committed transfers one earning-year row of their source year", async () => {
		const { source } = await seedPolicies();
		const [transfer] = await fixture.db
			.insert(vacationCarryoverTransfer)
			.values({
				id: randomUUID(),
				organizationId: fixture.organizationId,
				employeeId,
				sourceYear: 2027,
				outcome: "generated",
				days: "7",
				originalDays: "7",
				expiryDate: LAST_VALID_INSTANT,
				timezone: BERLIN,
				sourcePolicyId: source.id,
				performedBy: "system-automation",
			})
			.returning();
		const { readFileSync } = await import("node:fs");
		const backfill = readFileSync("drizzle/0346_vacation_leave_earning_year.sql", "utf8")
			.split("--> statement-breakpoint")
			.at(-1);
		await fixture.pool.query(backfill ?? "");
		expect(
			await fixture.db.query.vacationEarningYearLeave.findMany({
				where: eq(vacationEarningYearLeave.transferId, transfer.id),
			}),
		).toEqual([
			expect.objectContaining({
				earningYear: 2027,
				receivingYear: 2028,
				earningPolicyId: source.id,
				portion: "all",
				days: "7",
				configuredExpiryDate: LAST_VALID_INSTANT,
			}),
		]);
	});
});
