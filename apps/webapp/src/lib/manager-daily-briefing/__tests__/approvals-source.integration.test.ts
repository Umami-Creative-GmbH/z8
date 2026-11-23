/**
 * PostgreSQL contract: the manager daily briefing lists the viewer's pending approvals as their
 * unified Approval inbox does (#1980), every inbox type included (#663 legacy kinds, canonical
 * period submissions, ArbZG compliance exceptions), kept to the briefing's employees and the
 * requested organization.
 */
import { randomUUID } from "node:crypto";
import { Effect } from "effect";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import type { ApprovalType } from "@/lib/approvals/domain/types";
import type { ApprovalInboxListParams } from "@/lib/approvals/inbox/read-service";
import type { ApprovalInboxSourceFailure } from "@/lib/approvals/inbox/types";
import type { PrincipalContext } from "@/lib/authorization";
import { parseInstant, systemClock } from "@/lib/datetime/temporal-core";
import {
	type ClosedMonthDatabaseFixture,
	createClosedMonthDatabaseFixture,
} from "@/lib/time-tracking/closed-months/testing/closed-month-database.test.fixture";
import { submitPeriodSubmission } from "@/lib/time-tracking/period-submissions/submission-service";
import { managerDailyBriefingDatabaseSources } from "../get-manager-daily-briefing";
import type { BriefingApproval } from "../types";

// The request's session principal; the briefing resolves the viewer's inbox scope from it.
const session = vi.hoisted(() => ({ principal: null as PrincipalContext | null }));
vi.mock("@/lib/auth-helpers", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/lib/auth-helpers")>()),
	getPrincipalContext: async () => session.principal,
}));
// The inbox reads the briefing asks for, as it asks for them.
const inboxReads = vi.hoisted(() => [] as ApprovalInboxListParams[]);
// Warnings the next inbox read reports besides its own, as when a source's list read fails.
const extraInboxWarnings = vi.hoisted(
	() => [] as Array<{ source: string; message: string; failure?: ApprovalInboxSourceFailure }>,
);
vi.mock("@/lib/approvals/inbox/read-service", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@/lib/approvals/inbox/read-service")>();
	return {
		...actual,
		getApprovalInboxList: async (params: ApprovalInboxListParams) => {
			inboxReads.push(params);
			const result = await actual.getApprovalInboxList(params);
			return { ...result, warnings: [...result.warnings, ...extraInboxWarnings.splice(0)] };
		},
	};
});

const SUBMITTED_AT = new Date("2026-10-01T08:00:00Z");

type Seeded = { employeeId: string; userId: string };

function summarize(approvals: BriefingApproval[]) {
	return approvals
		.map(({ type, entityId, requester }) => ({ type, entityId, requesterId: requester.id }))
		.sort((a, b) => a.type.localeCompare(b.type));
}

describe("manager daily briefing approvals source", () => {
	// The first call imports every approval handler.
	vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

	let fixture: ClosedMonthDatabaseFixture;
	let organizationId: string;
	let ownerUserId: string;
	let manager: Seeded;
	let admin: Seeded;
	let requester: Seeded;
	let unmanaged: Seeded;
	let foreignOrganizationId: string;
	let foreignRequester: Seeded;
	const seeded = {
		absenceId: "",
		claimId: "",
		periodSubmissionId: "",
		exceptionId: "",
		unmanagedAbsenceId: "",
		unmanagedPeriodSubmissionId: "",
		unmanagedExceptionId: "",
		foreignAbsenceId: "",
	};

	function signIn(
		viewer: Seeded,
		access: { membership: "admin" | "member"; role: "admin" | "manager" | "employee" },
		organization = organizationId,
	) {
		session.principal = {
			userId: viewer.userId,
			isPlatformAdmin: false,
			activeOrganizationId: organization,
			orgMembership: { organizationId: organization, role: access.membership, status: "active" },
			employee: {
				id: viewer.employeeId,
				organizationId: organization,
				role: access.role,
				teamId: null,
			},
			permissions: { orgWide: null, byTeamId: new Map() },
			managedEmployeeIds: [],
			customRoles: [],
		};
	}

	/** A platform admin's session: no employee of its own in the principal. */
	function signInAsPlatformAdmin(userId: string) {
		session.principal = {
			userId,
			isPlatformAdmin: true,
			activeOrganizationId: organizationId,
			orgMembership: null,
			employee: null,
			permissions: { orgWide: null, byTeamId: new Map() },
			managedEmployeeIds: [],
			customRoles: [],
		};
	}

	/** The signed-in admin's inbox scope, as `/approvals/inbox` resolves it. */
	async function adminInboxScope() {
		const [{ defineAbilityFor }, { resolveApprovalInboxViewerScope }] = await Promise.all([
			import("@/lib/authorization"),
			import("@/lib/approvals/inbox/viewer-scope"),
		]);
		if (!session.principal) throw new Error("not signed in");
		const scope = await resolveApprovalInboxViewerScope({
			ability: defineAbilityFor(session.principal),
			employee: { id: admin.employeeId, organizationId, role: "admin" },
		});
		if (!scope) throw new Error("no inbox scope");
		return { ...scope, covering: undefined };
	}

	/** Pending absences of `requesterEmployeeId` for the manager, submitted long before the rest. */
	async function seedEarlierPendingAbsences(requesterEmployeeId: string, count: number) {
		const categoryId = randomUUID();
		const submittedAt = new Date("2026-01-05T08:00:00Z");
		await fixture.pool.query(
			`insert into absence_category (id, organization_id, type, name, requires_work_time,
				requires_approval, counts_against_vacation, is_active, created_at, updated_at)
			 values ($1, $2, 'vacation', 'Vacation', false, true, true, true, $3, $3)`,
			[categoryId, organizationId, submittedAt],
		);
		await fixture.pool.query(
			`with absences as (
				insert into absence_entry (id, employee_id, category_id, start_date, end_date, status,
					organization_id, created_at, updated_at)
				select gen_random_uuid(), $1, $2, '2026-01-12', '2026-01-12', 'pending', $3, $4, $4
				from generate_series(1, $5)
				returning id
			)
			insert into approval_request (id, organization_id, entity_type, entity_id, requested_by,
				approver_id, status, created_at, updated_at)
			select gen_random_uuid(), $3, 'absence_entry', absences.id, $1, $6, 'pending', $4, $4
			from absences`,
			[requesterEmployeeId, categoryId, organizationId, submittedAt, count, manager.employeeId],
		);
	}

	async function seedPendingAbsence(input: {
		organizationId: string;
		requesterEmployeeId: string;
		approverId: string;
	}) {
		const categoryId = randomUUID();
		const absenceId = randomUUID();
		await fixture.pool.query(
			`insert into absence_category (id, organization_id, type, name, requires_work_time,
				requires_approval, counts_against_vacation, is_active, created_at, updated_at)
			 values ($1, $2, 'vacation', 'Vacation', false, true, true, true, $3, $3)`,
			[categoryId, input.organizationId, SUBMITTED_AT],
		);
		await fixture.pool.query(
			`insert into absence_entry (id, employee_id, category_id, start_date, end_date, status,
				organization_id, created_at, updated_at)
			 values ($1, $2, $3, '2026-10-12', '2026-10-12', 'pending', $4, $5, $5)`,
			[absenceId, input.requesterEmployeeId, categoryId, input.organizationId, SUBMITTED_AT],
		);
		await seedPendingRequest({ ...input, entityType: "absence_entry", entityId: absenceId });
		return absenceId;
	}

	async function seedSubmittedClaim() {
		const claimId = randomUUID();
		await fixture.pool.query(
			`insert into travel_expense_claim (id, organization_id, employee_id, approver_id, type, status,
				trip_start, trip_end, original_currency, original_amount, calculated_currency,
				calculated_amount, submitted_at, created_by, created_at, updated_at)
			 values ($1, $2, $3, $4, 'receipt', 'submitted', '2026-09-28', '2026-09-29', 'EUR', 42,
				'EUR', 42, $5, $6, $5, $5)`,
			[
				claimId,
				organizationId,
				requester.employeeId,
				manager.employeeId,
				SUBMITTED_AT,
				requester.userId,
			],
		);
		await seedPendingRequest({
			organizationId,
			requesterEmployeeId: requester.employeeId,
			approverId: manager.employeeId,
			entityType: "travel_expense_claim",
			entityId: claimId,
		});
		return claimId;
	}

	async function seedPendingRequest(input: {
		organizationId: string;
		requesterEmployeeId: string;
		approverId: string;
		entityType: ApprovalType;
		entityId: string;
	}) {
		await fixture.pool.query(
			`insert into approval_request (id, organization_id, entity_type, entity_id, requested_by,
				approver_id, status, created_at, updated_at)
			 values ($1, $2, $3, $4, $5, $6, 'pending', $7, $7)`,
			[
				randomUUID(),
				input.organizationId,
				input.entityType,
				input.entityId,
				input.requesterEmployeeId,
				input.approverId,
				SUBMITTED_AT,
			],
		);
	}

	/** A canonical-only period submission of `employee`, routed to their manager. */
	async function seedPeriodSubmission(employee: Seeded) {
		await fixture.work({
			organizationId,
			employeeId: employee.employeeId,
			userId: employee.userId,
			start: "2026-03-03T07:00:00Z",
			end: "2026-03-03T15:15:00Z",
		});
		const submitted = await submitPeriodSubmission(
			{ organizationId, userId: employee.userId, periodStartDate: "2026-03-02" },
			{ database: db, clock: { nowInstant: () => parseInstant("2026-03-08T12:00:00Z") } },
		);
		if (submitted.kind !== "submitted") throw new Error(`not submitted: ${submitted.reason}`);
		const { rows } = await fixture.pool.query<{ id: string }>(
			`select id from period_submission where organization_id = $1 and employee_id = $2`,
			[organizationId, employee.employeeId],
		);
		return rows[0]?.id ?? "";
	}

	/** A pending ArbZG exception of `employee`, valid for the day around now. */
	async function seedComplianceException(employee: Seeded) {
		const id = randomUUID();
		const now = systemClock.nowInstant();
		await fixture.pool.query(
			`insert into compliance_exception
			 (id, organization_id, employee_id, exception_type, status, reason, planned_duration_minutes,
			  valid_from, valid_until, created_at, created_by, updated_at)
			 values ($1, $2, $3, 'rest_period', 'pending', 'Customer go-live', 90, $4, $5, $4, $6, $4)`,
			[
				id,
				organizationId,
				employee.employeeId,
				now.subtract({ hours: 1 }).toString(),
				now.add({ hours: 23 }).toString(),
				ownerUserId,
			],
		);
		return id;
	}

	beforeAll(async () => {
		fixture = await createClosedMonthDatabaseFixture();
		const organization = await fixture.organization("Europe/Berlin");
		organizationId = organization.organizationId;
		ownerUserId = organization.ownerUserId;
		manager = await fixture.employee({ organizationId });
		admin = await fixture.employee({ organizationId });
		requester = await fixture.employee({ organizationId });
		unmanaged = await fixture.employee({ organizationId });
		await fixture.pool.query(`update employee set role = 'manager' where id = $1`, [
			manager.employeeId,
		]);
		await fixture.pool.query(`update employee set role = 'admin' where id = $1`, [
			admin.employeeId,
		]);
		await fixture.pool.query(
			`insert into employee_managers (id, employee_id, manager_id, is_primary, assigned_by)
			 values ($1, $2, $3, true, $4)`,
			[randomUUID(), requester.employeeId, manager.employeeId, ownerUserId],
		);
		foreignOrganizationId = (await fixture.organization("Europe/Berlin")).organizationId;
		foreignRequester = await fixture.employee({ organizationId: foreignOrganizationId });

		seeded.absenceId = await seedPendingAbsence({
			organizationId,
			requesterEmployeeId: requester.employeeId,
			approverId: manager.employeeId,
		});
		seeded.claimId = await seedSubmittedClaim();
		await fixture.pool.query(
			`insert into period_submission_cadence_change
			 (id, organization_id, cadence, week_start_day, changed_at)
			 values ($1, $2, 'weekly', 'monday', '2026-01-01T00:00:00Z')`,
			[randomUUID(), organizationId],
		);
		seeded.periodSubmissionId = await seedPeriodSubmission(requester);
		seeded.exceptionId = await seedComplianceException(requester);
		// Assigned to the manager, but its requester is outside the briefing's employees.
		seeded.unmanagedAbsenceId = await seedPendingAbsence({
			organizationId,
			requesterEmployeeId: unmanaged.employeeId,
			approverId: manager.employeeId,
		});
		// Outside the briefing's employees too, yet in an admin's organization-wide inbox: the
		// canonical and compliance reads must keep them out as well (#1980). The admin approves them.
		await fixture.pool.query(
			`insert into employee_managers (id, employee_id, manager_id, is_primary, assigned_by)
			 values ($1, $2, $3, true, $4)`,
			[randomUUID(), unmanaged.employeeId, admin.employeeId, ownerUserId],
		);
		seeded.unmanagedPeriodSubmissionId = await seedPeriodSubmission(unmanaged);
		seeded.unmanagedExceptionId = await seedComplianceException(unmanaged);
		// Same approver id, other tenant: must never reach this organization's briefing.
		seeded.foreignAbsenceId = await seedPendingAbsence({
			organizationId: foreignOrganizationId,
			requesterEmployeeId: foreignRequester.employeeId,
			approverId: manager.employeeId,
		});
	});

	afterAll(async () => {
		session.principal = null;
		await fixture?.close();
	});

	it("lists the manager's unified inbox for the briefing's employees: every type, this organization only", async () => {
		signIn(manager, { membership: "member", role: "manager" });

		const approvals = await managerDailyBriefingDatabaseSources.getApprovals({
			organizationId,
			employeeIds: [requester.employeeId, foreignRequester.employeeId],
			viewer: { id: manager.employeeId, role: "manager" },
		});

		expect(summarize(approvals)).toEqual([
			{ type: "absence_entry", entityId: seeded.absenceId, requesterId: requester.employeeId },
			{
				type: "compliance_exception",
				entityId: seeded.exceptionId,
				requesterId: requester.employeeId,
			},
			{
				type: "period_submission",
				entityId: seeded.periodSubmissionId,
				requesterId: requester.employeeId,
			},
			{ type: "travel_expense_claim", entityId: seeded.claimId, requesterId: requester.employeeId },
		]);
		// A compliance exception keeps the inbox's deliberate single review.
		expect(approvals.find((approval) => approval.type === "compliance_exception")).toMatchObject({
			capabilities: { canBulkApprove: false, singleDecisionOnly: true, requiresRejectReason: true },
		});
	});

	it("reads an admin's organization-wide inbox, kept to the briefing's employees", async () => {
		signIn(admin, { membership: "admin", role: "admin" });

		const approvals = await managerDailyBriefingDatabaseSources.getApprovals({
			organizationId,
			// The other tenant's requester never widens an organization-wide read.
			employeeIds: [requester.employeeId, foreignRequester.employeeId],
			viewer: { id: admin.employeeId, role: "admin" },
		});

		expect(summarize(approvals).map(({ type, entityId }) => ({ type, entityId }))).toEqual([
			{ type: "absence_entry", entityId: seeded.absenceId },
			{ type: "compliance_exception", entityId: seeded.exceptionId },
			{ type: "period_submission", entityId: seeded.periodSubmissionId },
			{ type: "travel_expense_claim", entityId: seeded.claimId },
		]);
		expect(approvals.totalCount).toBe(4);
	});

	it("keeps another employee's period submission and compliance exception out of an admin's briefing", async () => {
		signIn(admin, { membership: "admin", role: "admin" });
		const scope = await adminInboxScope();
		// The admin's whole inbox holds them, so only the requester filter can keep them out.
		const { getApprovalInboxList } = await import("@/lib/approvals/inbox/read-service");
		const wholeInbox = await getApprovalInboxList({ ...scope, status: "pending", limit: 100 });
		expect(wholeInbox.items.map((item) => item.entityId)).toEqual(
			expect.arrayContaining([seeded.unmanagedPeriodSubmissionId, seeded.unmanagedExceptionId]),
		);

		const approvals = await managerDailyBriefingDatabaseSources.getApprovals({
			organizationId,
			employeeIds: [requester.employeeId],
			viewer: { id: admin.employeeId, role: "admin" },
		});

		const entityIds = approvals.map((approval) => approval.entityId);
		expect(entityIds).not.toContain(seeded.unmanagedPeriodSubmissionId);
		expect(entityIds).not.toContain(seeded.unmanagedExceptionId);
		expect(approvals.totalCount).toBe(4);
	});

	it("lists and counts nothing in any inbox source for no requesters at all", async () => {
		signIn(admin, { membership: "admin", role: "admin" });
		const scope = await adminInboxScope();
		const { getApprovalInboxCounts, getApprovalInboxList } =
			await import("@/lib/approvals/inbox/read-service");
		const params = { ...scope, requesterEmployeeIds: [], status: "pending" as const };

		const list = await getApprovalInboxList({ ...params, limit: 100 });
		const counts = await getApprovalInboxCounts(params);

		expect(list.items).toEqual([]);
		expect(list.total).toBe(0);
		// Every source is counted, the canonical and compliance reads included, and each is zero.
		expect(Object.keys(list.counts)).toEqual(
			expect.arrayContaining(["absence_entry", "period_submission", "compliance_exception"]),
		);
		expect(Object.values(list.counts).every((count) => count === 0)).toBe(true);
		expect(Object.keys(counts)).toEqual(
			expect.arrayContaining(["absence_entry", "period_submission", "compliance_exception"]),
		);
		expect(Object.values(counts).every((count) => count === 0)).toBe(true);
	});

	it("lists nothing for a viewer the Approval inbox refuses", async () => {
		signIn(unmanaged, { membership: "member", role: "employee" });

		const approvals = await managerDailyBriefingDatabaseSources.getApprovals({
			organizationId,
			employeeIds: [requester.employeeId, unmanaged.employeeId],
			viewer: { id: unmanaged.employeeId, role: "employee" },
		});

		expect(approvals).toEqual([]);
	});

	it("lists nothing when the session's active organization is not the requested one", async () => {
		signIn(manager, { membership: "member", role: "manager" }, foreignOrganizationId);

		const approvals = await managerDailyBriefingDatabaseSources.getApprovals({
			organizationId,
			employeeIds: [requester.employeeId],
			viewer: { id: manager.employeeId, role: "manager" },
		});

		expect(approvals).toEqual([]);
	});

	it("lists nothing when the session's employee is not the viewer", async () => {
		signIn(admin, { membership: "admin", role: "admin" });

		const approvals = await managerDailyBriefingDatabaseSources.getApprovals({
			organizationId,
			employeeIds: [requester.employeeId],
			viewer: { id: manager.employeeId, role: "manager" },
		});

		expect(approvals).toEqual([]);
	});

	it("reads a platform admin's inbox only for their own employee, as the inbox does", async () => {
		signInAsPlatformAdmin(admin.userId);
		const own = await managerDailyBriefingDatabaseSources.getApprovals({
			organizationId,
			employeeIds: [requester.employeeId],
			viewer: { id: admin.employeeId, role: "admin" },
		});
		expect(summarize(own).map(({ entityId }) => entityId)).toContain(seeded.absenceId);

		signInAsPlatformAdmin(ownerUserId);
		const someoneElses = await managerDailyBriefingDatabaseSources.getApprovals({
			organizationId,
			employeeIds: [requester.employeeId],
			viewer: { id: admin.employeeId, role: "admin" },
		});
		expect(someoneElses).toEqual([]);
	});

	it("reads an organization-wide briefing past PostgreSQL's bind limit: one parameter for every employee", async () => {
		signIn(admin, { membership: "admin", role: "admin" });
		// More ids than PostgreSQL's 65,535 bind parameters, the real requester among them.
		const employeeIds = Array.from({ length: 70_000 }, () => randomUUID());
		employeeIds.splice(35_000, 0, requester.employeeId);

		const approvals = await managerDailyBriefingDatabaseSources.getApprovals({
			organizationId,
			employeeIds,
			viewer: { id: admin.employeeId, role: "admin" },
		});

		// Every source listed and counted: none failed on its query.
		expect(approvals.unavailableTypes).toBeUndefined();
		expect(summarize(approvals).map(({ type, entityId }) => ({ type, entityId }))).toEqual([
			{ type: "absence_entry", entityId: seeded.absenceId },
			{ type: "compliance_exception", entityId: seeded.exceptionId },
			{ type: "period_submission", entityId: seeded.periodSubmissionId },
			{ type: "travel_expense_claim", entityId: seeded.claimId },
		]);
		expect(approvals.totalCount).toBe(4);
	});

	it("names the types the inbox could not list, once each, and none when it listed every one", async () => {
		signIn(manager, { membership: "member", role: "manager" });
		const complete = await managerDailyBriefingDatabaseSources.getApprovals({
			organizationId,
			employeeIds: [requester.employeeId],
			viewer: { id: manager.employeeId, role: "manager" },
		});
		expect(complete.unavailableTypes).toBeUndefined();

		extraInboxWarnings.push(
			{ source: "travel_expense_claim", message: "Travel Expenses approvals could not be loaded." },
			{ source: "travel_expense_claim", message: "Travel Expenses approvals could not be loaded." },
		);
		const partial = await managerDailyBriefingDatabaseSources.getApprovals({
			organizationId,
			employeeIds: [requester.employeeId],
			viewer: { id: manager.employeeId, role: "manager" },
		});

		expect(partial.unavailableTypes).toEqual(["travel_expense_claim"]);
		expect(partial.totalCount).toBe(complete.totalCount);
	});

	it("names a type whose count read failed as not counted, apart from those it could not list", async () => {
		signIn(manager, { membership: "member", role: "manager" });
		await import("@/lib/approvals/init");
		const { getApprovalHandler } = await import("@/lib/approvals/domain/registry");
		const absences = getApprovalHandler("absence_entry");
		if (!absences) throw new Error("no absence handler");
		// The absence list reads; only its count fails, so the total misses its approvals.
		const failedCount = vi
			.spyOn(absences, "getCount")
			.mockReturnValue(Effect.fail(new Error("count read failed")) as never);
		// A "Covering for" header count is no total of the briefing's.
		extraInboxWarnings.push({
			source: "travel_expense_claim",
			message: "Travel Expenses approvals of a section could not be counted.",
			failure: "covering_count",
		});
		try {
			const approvals = await managerDailyBriefingDatabaseSources.getApprovals({
				organizationId,
				employeeIds: [requester.employeeId],
				viewer: { id: manager.employeeId, role: "manager" },
			});

			expect(approvals.uncountedTypes).toEqual(["absence_entry"]);
			expect(approvals.unavailableTypes).toBeUndefined();
			// Its row still lists; only the total misses it.
			expect(summarize(approvals).map(({ entityId }) => entityId)).toContain(seeded.absenceId);
			expect(approvals.totalCount).toBe(3);
		} finally {
			failedCount.mockRestore();
		}
	});

	it("reads no Covering for sections it would discard", async () => {
		signIn(manager, { membership: "member", role: "manager" });
		inboxReads.length = 0;

		await managerDailyBriefingDatabaseSources.getApprovals({
			organizationId,
			employeeIds: [requester.employeeId],
			viewer: { id: manager.employeeId, role: "manager" },
		});

		expect(inboxReads).toHaveLength(1);
		expect(inboxReads[0]?.covering).toBeUndefined();
	});

	it("keeps the briefing's employees' approvals behind a full page of others' that sort first", async () => {
		await seedEarlierPendingAbsences(unmanaged.employeeId, 120);
		signIn(manager, { membership: "member", role: "manager" });
		// The manager's whole inbox opens with the others' requests: a page of 100 holds none of
		// the requester's absence.
		const { getApprovalInboxList } = await import("@/lib/approvals/inbox/read-service");
		const wholeInbox = await getApprovalInboxList({
			approverId: manager.employeeId,
			organizationId,
			status: "pending",
			limit: 100,
		});
		expect(wholeInbox.items.map((item) => item.entityId)).not.toContain(seeded.absenceId);

		const approvals = await managerDailyBriefingDatabaseSources.getApprovals({
			organizationId,
			employeeIds: [requester.employeeId],
			viewer: { id: manager.employeeId, role: "manager" },
		});

		expect(summarize(approvals).map(({ type, entityId }) => ({ type, entityId }))).toEqual([
			{ type: "absence_entry", entityId: seeded.absenceId },
			{ type: "compliance_exception", entityId: seeded.exceptionId },
			{ type: "period_submission", entityId: seeded.periodSubmissionId },
			{ type: "travel_expense_claim", entityId: seeded.claimId },
		]);
		// Every pending approval of the briefing's employees, however many the briefing shows.
		expect(approvals.totalCount).toBe(4);
	});
});
