/**
 * PostgreSQL contract (#663): the manager daily briefing lists the manager's
 * real pending approvals of every registered type, scoped to the requested
 * organization. It used to run the approval query without `DatabaseService`,
 * so every handler died and the briefing silently showed none.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { ApprovalType } from "@/lib/approvals/domain/types";
import {
	createLifecycleDatabaseFixture,
	type LifecycleDatabaseFixture,
	type SeededEmployee,
} from "@/lib/employee-lifecycle/testing/database.test.fixture";
import { managerDailyBriefingDatabaseSources } from "../get-manager-daily-briefing";
import type { BriefingApproval } from "../types";

const SUBMITTED_AT = new Date("2026-10-01T08:00:00Z");

function summarize(approvals: BriefingApproval[]) {
	return approvals
		.map(({ approvalType, entityId, requester }) => ({
			approvalType,
			entityId,
			requesterId: requester.id,
		}))
		.sort((a, b) => a.approvalType.localeCompare(b.approvalType));
}

describe("manager daily briefing approvals source", () => {
	// The first call imports every approval handler.
	vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

	let fixture: LifecycleDatabaseFixture;
	let manager: SeededEmployee;
	let requester: SeededEmployee;
	let foreignRequester: SeededEmployee;
	let foreignOrganizationId: string;
	const seeded = {
		absenceId: "",
		claimId: "",
		foreignAbsenceId: "",
	};

	async function seedPendingAbsence(organizationId: string, requesterEmployeeId: string) {
		const categoryId = randomUUID();
		const absenceId = randomUUID();
		await fixture.pool.query(
			`insert into absence_category (id, organization_id, type, name, requires_work_time,
				requires_approval, counts_against_vacation, is_active, created_at, updated_at)
			 values ($1, $2, 'vacation', 'Vacation', false, true, true, true, $3, $3)`,
			[categoryId, organizationId, SUBMITTED_AT],
		);
		await fixture.pool.query(
			`insert into absence_entry (id, employee_id, category_id, start_date, end_date, status,
				organization_id, created_at, updated_at)
			 values ($1, $2, $3, '2026-10-12', '2026-10-12', 'pending', $4, $5, $5)`,
			[absenceId, requesterEmployeeId, categoryId, organizationId, SUBMITTED_AT],
		);
		await seedPendingRequest(organizationId, "absence_entry", absenceId, requesterEmployeeId);
		return absenceId;
	}

	async function seedSubmittedClaim(organizationId: string, requesterEmployeeId: string) {
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
				requesterEmployeeId,
				manager.employeeId,
				SUBMITTED_AT,
				requester.userId,
			],
		);
		await seedPendingRequest(organizationId, "travel_expense_claim", claimId, requesterEmployeeId);
		return claimId;
	}

	async function seedPendingRequest(
		organizationId: string,
		entityType: ApprovalType,
		entityId: string,
		requesterEmployeeId: string,
	) {
		await fixture.pool.query(
			`insert into approval_request (id, organization_id, entity_type, entity_id, requested_by,
				approver_id, status, created_at, updated_at)
			 values ($1, $2, $3, $4, $5, $6, 'pending', $7, $7)`,
			[
				randomUUID(),
				organizationId,
				entityType,
				entityId,
				requesterEmployeeId,
				manager.employeeId,
				SUBMITTED_AT,
			],
		);
	}

	beforeAll(async () => {
		fixture = await createLifecycleDatabaseFixture();
		manager = await fixture.seedEmployee();
		requester = await fixture.seedEmployee();
		await fixture.pool.query(
			`update employee set role = 'manager' where organization_id = $1 and id = $2`,
			[fixture.organizationId, manager.employeeId],
		);
		foreignOrganizationId = await fixture.createOrganization();
		foreignRequester = await fixture.seedEmployee({ organizationId: foreignOrganizationId });

		seeded.absenceId = await seedPendingAbsence(fixture.organizationId, requester.employeeId);
		seeded.claimId = await seedSubmittedClaim(fixture.organizationId, requester.employeeId);
		// Same approver id, other tenant: must never reach this organization's briefing.
		seeded.foreignAbsenceId = await seedPendingAbsence(
			foreignOrganizationId,
			foreignRequester.employeeId,
		);
	});

	afterAll(async () => {
		await fixture?.close();
	});

	it("lists pending approvals of several types for the manager's organization only", async () => {
		const approvals = await managerDailyBriefingDatabaseSources.getApprovals({
			organizationId: fixture.organizationId,
			approverId: manager.employeeId,
			employeeIds: [requester.employeeId, foreignRequester.employeeId],
		});

		expect(summarize(approvals)).toEqual([
			{
				approvalType: "absence_entry",
				entityId: seeded.absenceId,
				requesterId: requester.employeeId,
			},
			{
				approvalType: "travel_expense_claim",
				entityId: seeded.claimId,
				requesterId: requester.employeeId,
			},
		]);
	});

	it("scopes org-wide briefings to the requested organization", async () => {
		const approvals = await managerDailyBriefingDatabaseSources.getApprovals({
			organizationId: foreignOrganizationId,
			approverId: fixture.ownerEmployeeId,
			employeeIds: [requester.employeeId, foreignRequester.employeeId],
			includeAllApprovers: true,
		});

		expect(summarize(approvals)).toEqual([
			{
				approvalType: "absence_entry",
				entityId: seeded.foreignAbsenceId,
				requesterId: foreignRequester.employeeId,
			},
		]);
	});
});
