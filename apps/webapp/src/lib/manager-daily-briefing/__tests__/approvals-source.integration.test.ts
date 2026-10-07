/**
 * PostgreSQL contract for the manager daily briefing's approvals source (#663):
 * it lists the approver's real pending approvals of every approval type,
 * scoped to the requested organization and employees.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
	createLifecycleDatabaseFixture,
	type LifecycleDatabaseFixture,
	type SeededEmployee,
} from "@/lib/employee-lifecycle/testing/database.test.fixture";
import { databaseSources } from "../get-manager-daily-briefing";

const SUBMITTED_AT = new Date("2026-09-14T08:00:00Z");
// The first call loads the approval handlers and the shared runtime.
const TEST_TIMEOUT_MS = 30_000;

describe("manager daily briefing approvals source", () => {
	let fixture: LifecycleDatabaseFixture;
	let manager: SeededEmployee;
	let requester: SeededEmployee;
	let foreignOrganizationId: string;
	let foreignRequester: SeededEmployee;
	let absenceRequestId: string;
	let claimRequestId: string;
	let foreignRequestId: string;

	async function seedPendingAbsence(input: {
		organizationId: string;
		requester: SeededEmployee;
		approverEmployeeId: string;
	}) {
		const categoryId = randomUUID();
		const absenceId = randomUUID();
		const requestId = randomUUID();
		await fixture.pool.query(
			`insert into absence_category (id, organization_id, type, name, updated_at)
			 values ($1, $2, 'vacation', 'Vacation', $3)`,
			[categoryId, input.organizationId, SUBMITTED_AT],
		);
		await fixture.pool.query(
			`insert into absence_entry (id, organization_id, employee_id, category_id, start_date,
				end_date, status, created_at, updated_at)
			 values ($1, $2, $3, $4, '2026-10-20', '2026-10-21', 'pending', $5, $5)`,
			[absenceId, input.organizationId, input.requester.employeeId, categoryId, SUBMITTED_AT],
		);
		await fixture.pool.query(
			`insert into approval_request (id, organization_id, entity_type, entity_id, requested_by,
				approver_id, status, created_at, updated_at)
			 values ($1, $2, 'absence_entry', $3, $4, $5, 'pending', $6, $6)`,
			[
				requestId,
				input.organizationId,
				absenceId,
				input.requester.employeeId,
				input.approverEmployeeId,
				SUBMITTED_AT,
			],
		);
		return requestId;
	}

	async function seedSubmittedClaim(input: {
		organizationId: string;
		requester: SeededEmployee;
		approverEmployeeId: string;
	}) {
		const claimId = randomUUID();
		const requestId = randomUUID();
		await fixture.pool.query(
			`insert into travel_expense_claim (id, organization_id, employee_id, approver_id, type, status,
				trip_start, trip_end, original_currency, original_amount, calculated_currency,
				calculated_amount, submitted_at, created_by, created_at, updated_at)
			 values ($1, $2, $3, $4, 'receipt', 'submitted', '2026-09-01', '2026-09-02', 'EUR', 42,
				'EUR', 42, $5, $6, $5, $5)`,
			[
				claimId,
				input.organizationId,
				input.requester.employeeId,
				input.approverEmployeeId,
				SUBMITTED_AT,
				input.requester.userId,
			],
		);
		await fixture.pool.query(
			`insert into approval_request (id, organization_id, entity_type, entity_id, requested_by,
				approver_id, status, created_at, updated_at)
			 values ($1, $2, 'travel_expense_claim', $3, $4, $5, 'pending', $6, $6)`,
			[
				requestId,
				input.organizationId,
				claimId,
				input.requester.employeeId,
				input.approverEmployeeId,
				SUBMITTED_AT,
			],
		);
		return requestId;
	}

	beforeAll(async () => {
		fixture = await createLifecycleDatabaseFixture();
		manager = await fixture.seedEmployee();
		requester = await fixture.seedEmployee();
		await fixture.pool.query(`update employee set role = 'manager' where id = $1`, [
			manager.employeeId,
		]);
		absenceRequestId = await seedPendingAbsence({
			organizationId: fixture.organizationId,
			requester,
			approverEmployeeId: manager.employeeId,
		});
		claimRequestId = await seedSubmittedClaim({
			organizationId: fixture.organizationId,
			requester,
			approverEmployeeId: manager.employeeId,
		});

		foreignOrganizationId = await fixture.createOrganization();
		const foreignManager = await fixture.seedEmployee({ organizationId: foreignOrganizationId });
		foreignRequester = await fixture.seedEmployee({ organizationId: foreignOrganizationId });
		foreignRequestId = await seedPendingAbsence({
			organizationId: foreignOrganizationId,
			requester: foreignRequester,
			approverEmployeeId: foreignManager.employeeId,
		});
	});

	afterAll(async () => {
		await fixture?.close();
	});

	it(
		"lists the manager's pending approvals of every seeded type",
		async () => {
			const approvals = await databaseSources.getApprovals({
				organizationId: fixture.organizationId,
				employeeIds: [requester.employeeId],
				approverId: manager.employeeId,
			});

			expect(approvals.map((approval) => [approval.approvalType, approval.id]).sort()).toEqual(
				[
					["absence_entry", absenceRequestId],
					["travel_expense_claim", claimRequestId],
				].sort(),
			);
			for (const approval of approvals) {
				expect(approval.organizationId).toBe(fixture.organizationId);
				expect(approval.requester.id).toBe(requester.employeeId);
			}
		},
		TEST_TIMEOUT_MS,
	);

	it(
		"never lists another organization's approvals, even for all approvers",
		async () => {
			const approvals = await databaseSources.getApprovals({
				organizationId: fixture.organizationId,
				employeeIds: [requester.employeeId, foreignRequester.employeeId],
				approverId: fixture.ownerEmployeeId,
				includeAllApprovers: true,
			});

			expect(approvals.map((approval) => approval.id).sort()).toEqual(
				[absenceRequestId, claimRequestId].sort(),
			);
			expect(approvals.map((approval) => approval.id)).not.toContain(foreignRequestId);
		},
		TEST_TIMEOUT_MS,
	);
});
