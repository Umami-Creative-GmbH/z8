import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	absenceCategory,
	absenceEntry,
	vacationAllowance,
	vacationExternalLeaveNotice,
	vacationPolicyAssignment,
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
				user: { id: session.userId, role: "user", email: "notice@test.invalid" },
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
const { recordExternalLeaveNotice, documentLeaveOpportunity, getEmployeeLeaveNotices } =
	await import("@/app/[locale]/(app)/settings/vacation/leave-notice-actions");

const BERLIN = "Europe/Berlin";
const TODAY = new Date("2028-02-10T09:00:00Z");

describe("external leave notice and the opportunity to take leave (#2082)", () => {
	vi.setConfig({ testTimeout: 90000, hookTimeout: 90000 });
	let fixture: LifecycleDatabaseFixture;
	let employeeId: string;
	let memberUserId: string;

	beforeEach(async () => {
		fixture = await createLifecycleDatabaseFixture();
		await fixture.pool.query("update organization set timezone=$2 where id=$1", [
			fixture.organizationId,
			BERLIN,
		]);
		await fixture.pool.query(
			"update vacation_policy_rollout set baseline_date=DATE '2026-01-01', calculations_enabled=true where organization_id=$1",
			[fixture.organizationId],
		);
		employeeId = (
			await fixture.seedEmployee({
				role: "member",
				startDate: new Date("2020-01-01T00:00:00Z"),
				withPeriod: false,
			})
		).employeeId;
		memberUserId = (await fixture.seedEmployee({ role: "member" })).userId;
		session.userId = fixture.ownerUserId;
		session.organizationId = fixture.organizationId;
		await seedSevenOutstandingDaysOf2027();
		vi.useFakeTimers({ toFake: ["Date"] });
		vi.setSystemTime(TODAY);
	});
	afterEach(async () => {
		vi.useRealTimers();
		await fixture?.close();
	});

	/**
	 * A 24-day 2027 policy designated for German rules; the employee took 17 days in 2027, so 7 days
	 * of leave year 2027 are carried into 2028 and stay outstanding.
	 */
	async function seedSevenOutstandingDaysOf2027() {
		const [, source, receiving] = await fixture.db
			.insert(vacationAllowance)
			.values([
				{
					organizationId: fixture.organizationId,
					name: "Default",
					startDate: "2026-01-01",
					isCompanyDefault: true,
					defaultAnnualDays: "30",
					statutoryMinimumDays: "20",
					accrualType: "annual" as const,
					createdBy: fixture.ownerUserId,
				},
				{
					organizationId: fixture.organizationId,
					name: "German 2027",
					startDate: "2027-01-01",
					validUntil: "2027-12-31",
					defaultAnnualDays: "24",
					statutoryMinimumDays: "20",
					accrualType: "annual" as const,
					allowCarryover: false,
					createdBy: fixture.ownerUserId,
				},
				{
					organizationId: fixture.organizationId,
					name: "Receiving 2028",
					startDate: "2028-01-01",
					defaultAnnualDays: "30",
					statutoryMinimumDays: "20",
					accrualType: "annual" as const,
					carryoverExpiryMonths: 3,
					createdBy: fixture.ownerUserId,
				},
			])
			.returning();
		await fixture.db.insert(vacationPolicyAssignment).values([
			{
				organizationId: fixture.organizationId,
				policyId: source.id,
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
		const classified = await classifyVacationPolicyExpiryRules({
			policyId: source.id,
			expiryRules: "german",
			extraDaysSeparateTerms: false,
			extraDaysTermsBasis: null,
		});
		if (!classified.success) throw new Error(classified.error);
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
		// 2027-08-02 (Mon) .. 2027-08-24 (Tue): 17 working days.
		await fixture.db.insert(absenceEntry).values({
			organizationId: fixture.organizationId,
			employeeId,
			categoryId: category.id,
			startDate: "2027-08-02",
			endDate: "2027-08-24",
			status: "approved" as const,
		});
		await calculateAnnualCarryover(fixture.organizationId, 2027, fixture.ownerUserId, BERLIN);
	}

	function noticeInput(overrides: Record<string, unknown> = {}) {
		return {
			employeeId,
			leaveYear: 2027,
			days: 5,
			deliveredOn: "2028-01-15",
			deliveryMethod: "letter" as const,
			deliveryDetails: null,
			deadline: "2028-03-31",
			requestedToTakeLeave: true,
			warnedOfLapse: true,
			supportingDocuments: null,
			...overrides,
		};
	}

	async function record(overrides: Record<string, unknown> = {}) {
		const result = await recordExternalLeaveNotice(noticeInput(overrides));
		if (!result.success) throw new Error(result.error);
		return result.data;
	}

	async function noticesView() {
		const result = await getEmployeeLeaveNotices(employeeId);
		if (!result.success) throw new Error(result.error);
		return result.data;
	}

	async function outstanding2027(currentDate: Date) {
		const balances = await loadVacationBalances(fixture.db, {
			organizationId: fixture.organizationId,
			employeeIds: [employeeId],
			year: 2028,
			timezone: BERLIN,
			currentDate,
		});
		return balances.balances
			.get(employeeId)
			?.earningYears?.filter((row) => row.earningYear === 2027)
			.reduce((sum, row) => sum + row.remainingDays, 0);
	}

	it("records a dated HR attestation that identifies the employee, delivery, leave year, days and deadline", async () => {
		const notice = await record({ supportingDocuments: "Signed copy in the personnel file" });
		expect(notice).toMatchObject({
			employeeId,
			leaveYear: 2027,
			days: 5,
			deliveredOn: "2028-01-15",
			deliveryMethod: "letter",
			deadlineDate: "2028-03-31",
			timezone: BERLIN,
			requestedToTakeLeave: true,
			warnedOfLapse: true,
			supportingDocuments: "Signed copy in the personnel file",
			opportunity: null,
		});
		// The deadline is valid through the final millisecond of 31 March in Berlin.
		expect(new Date(notice.deadline).toISOString()).toBe("2028-03-31T21:59:59.999Z");
		const [stored] = await fixture.db
			.select()
			.from(vacationExternalLeaveNotice)
			.where(eq(vacationExternalLeaveNotice.id, notice.id));
		expect(stored).toMatchObject({
			organizationId: fixture.organizationId,
			attestedBy: fixture.ownerUserId,
			attestedAt: TODAY,
		});
	});

	it("leaves noticed days outstanding until HR documents the opportunity to take them", async () => {
		const notice = await record();
		expect((await noticesView()).coverage).toEqual([
			expect.objectContaining({
				leaveYear: 2027,
				outstandingDays: 7,
				coveredDays: 0,
				awaitingOpportunityDays: 5,
				uncoveredDays: 2,
			}),
			expect.objectContaining({ leaveYear: 2028, coveredDays: 0, uncoveredDays: 30 }),
		]);
		const afterDeadline = new Date("2028-04-01T00:00:00Z");
		await expireCarryoverDays(fixture.organizationId, "system-automation", afterDeadline, BERLIN);
		expect(await outstanding2027(afterDeadline)).toBe(7);

		const documented = await documentLeaveOpportunity({
			noticeId: notice.id,
			basis: "No vacation block, workload planned around the requested weeks in March",
		});
		expect(documented).toMatchObject({ success: true });
		const view = await noticesView();
		expect(view.notices).toEqual([
			expect.objectContaining({
				id: notice.id,
				opportunity: expect.objectContaining({
					basis: "No vacation block, workload planned around the requested weeks in March",
					assessedAt: TODAY,
				}),
			}),
		]);
		expect(view.coverage[0]).toMatchObject({ coveredDays: 5, uncoveredDays: 2 });
	});

	it("covers at most the five noticed days; the two added days need a new notice and assessment", async () => {
		const first = await record();
		await documentLeaveOpportunity({ noticeId: first.id, basis: "Quiet season" });
		expect((await noticesView()).coverage[0]).toMatchObject({
			outstandingDays: 7,
			coveredDays: 5,
			uncoveredDays: 2,
		});

		const added = await record({ days: 2, deliveredOn: "2028-02-01" });
		expect((await noticesView()).coverage[0]).toMatchObject({
			coveredDays: 5,
			awaitingOpportunityDays: 2,
			uncoveredDays: 0,
		});
		await documentLeaveOpportunity({ noticeId: added.id, basis: "Quiet season" });
		expect((await noticesView()).coverage[0]).toMatchObject({
			coveredDays: 7,
			awaitingOpportunityDays: 0,
			uncoveredDays: 0,
		});
	});

	it("refuses an attestation that does not establish the notice", async () => {
		const refusal = async (overrides: Record<string, unknown>) => {
			const result = await recordExternalLeaveNotice(noticeInput(overrides));
			return result.success ? "recorded" : result.refusal;
		};
		expect(await refusal({ requestedToTakeLeave: false })).toBe("notice_incomplete");
		expect(await refusal({ warnedOfLapse: false })).toBe("notice_incomplete");
		expect(await refusal({ deadline: "2028-01-15" })).toBe("deadline_not_after_delivery");
		expect(await refusal({ deliveredOn: "2028-02-11", deadline: "2028-03-31" })).toBe(
			"delivered_in_future",
		);
		expect(await refusal({ leaveYear: 2029 })).toBe("leave_year_after_delivery");
		expect(await refusal({ deliveryMethod: "other", deliveryDetails: " " })).toBe(
			"delivery_details_required",
		);
		expect(await fixture.db.select().from(vacationExternalLeaveNotice)).toEqual([]);
	});

	it("documents the opportunity once per notice and requires its basis", async () => {
		const notice = await record();
		expect(await documentLeaveOpportunity({ noticeId: notice.id, basis: "  " })).toMatchObject({
			success: false,
			refusal: "basis_required",
		});
		await documentLeaveOpportunity({ noticeId: notice.id, basis: "Quiet season" });
		expect(
			await documentLeaveOpportunity({ noticeId: notice.id, basis: "Another basis" }),
		).toMatchObject({ success: false, refusal: "already_assessed" });
	});

	it("keeps the attestation final", async () => {
		const notice = await record();
		await expect(
			fixture.pool.query("update vacation_external_leave_notice set days=7 where id=$1", [
				notice.id,
			]),
		).rejects.toThrow(/final/);
	});

	it("is scoped to the organization and to org admins", async () => {
		const notice = await record();
		session.userId = memberUserId;
		expect(await recordExternalLeaveNotice(noticeInput())).toMatchObject({ success: false });
		expect(await getEmployeeLeaveNotices(employeeId)).toMatchObject({ success: false });
		expect(
			await documentLeaveOpportunity({ noticeId: notice.id, basis: "Quiet season" }),
		).toMatchObject({ success: false });

		session.userId = fixture.ownerUserId;
		const otherOrganizationId = await fixture.createOrganization();
		const foreign = await fixture.seedEmployee({ organizationId: otherOrganizationId });
		expect(
			await recordExternalLeaveNotice(noticeInput({ employeeId: foreign.employeeId })),
		).toMatchObject({ success: false, code: "NotFoundError" });
		expect(await getEmployeeLeaveNotices(foreign.employeeId)).toMatchObject({ success: false });

		// The other organization's admin cannot see or assess this organization's notice.
		const otherAdmin = await fixture.seedEmployee({
			organizationId: otherOrganizationId,
			role: "owner",
		});
		session.userId = otherAdmin.userId;
		session.organizationId = otherOrganizationId;
		expect(
			await documentLeaveOpportunity({ noticeId: notice.id, basis: "Quiet season" }),
		).toMatchObject({ success: false, refusal: "notice_not_found" });
		session.userId = fixture.ownerUserId;
		session.organizationId = fixture.organizationId;
		expect((await noticesView()).notices[0].opportunity).toBeNull();
	});
});
