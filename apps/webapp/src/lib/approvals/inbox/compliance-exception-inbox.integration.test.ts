/**
 * #1977 runtime evidence (Approvals ADR-0005): ArbZG compliance exceptions are listed, counted,
 * opened and decided in the Approval inbox through their own adapter, backed by the
 * `compliance_exception` rows alone.
 *
 * Local contract: pnpm --filter webapp test:integration
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
	type ClosedMonthDatabaseFixture,
	createClosedMonthDatabaseFixture,
} from "@/lib/time-tracking/closed-months/testing/closed-month-database.test.fixture";
import {
	complianceExceptionInboxRead,
	decideComplianceExceptionFromInbox,
	resolveComplianceExceptionInboxScope,
} from "./compliance-exception-inbox";
import { bulkApproveApprovalInboxItems, bulkRejectApprovalInboxItems } from "./decision-service";
import { getApprovalInboxDetail, getApprovalInboxListFromSources } from "./read-service";

const NOW = new Date("2026-03-10T12:00:00Z");

describe("compliance exceptions in the Approval inbox on PostgreSQL", () => {
	let fixture: ClosedMonthDatabaseFixture;
	let organizationId: string;
	let ownerUserId: string;
	let employee: { employeeId: string; userId: string };
	let manager: { employeeId: string; userId: string };
	let outsider: { employeeId: string; userId: string };

	beforeAll(async () => {
		fixture = await createClosedMonthDatabaseFixture();
	});

	afterAll(async () => {
		await fixture.close();
	});

	async function exception(input: {
		employeeId: string;
		organizationId?: string;
		status?: "pending" | "approved" | "rejected" | "expired";
		exceptionType?: "rest_period" | "overtime_daily" | "overtime_weekly" | "overtime_monthly";
		createdAt?: string;
		validUntil?: string;
		plannedDurationMinutes?: number | null;
		reason?: string;
	}): Promise<string> {
		const id = randomUUID();
		const createdAt = input.createdAt ?? "2026-03-10T08:00:00Z";
		await fixture.pool.query(
			`insert into compliance_exception
			 (id, organization_id, employee_id, exception_type, status, reason, planned_duration_minutes,
			  valid_from, valid_until, created_at, created_by, updated_at)
			 values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $8, $10, $8)`,
			[
				id,
				input.organizationId ?? organizationId,
				input.employeeId,
				input.exceptionType ?? "overtime_daily",
				input.status ?? "pending",
				input.reason ?? "Inventory count runs late",
				input.plannedDurationMinutes === undefined ? 90 : input.plannedDurationMinutes,
				createdAt,
				input.validUntil ?? new Date(Date.parse(createdAt) + 24 * 3600_000).toISOString(),
				ownerUserId,
			],
		);
		return id;
	}

	beforeEach(async () => {
		const organization = await fixture.organization("Europe/Berlin");
		organizationId = organization.organizationId;
		ownerUserId = organization.ownerUserId;
		employee = await fixture.employee({ organizationId });
		manager = await fixture.employee({ organizationId });
		outsider = await fixture.employee({ organizationId });
		await fixture.pool.query("update employee set role = 'manager' where id = $1", [
			manager.employeeId,
		]);
		await fixture.pool.query(
			`insert into employee_managers (id, employee_id, manager_id, is_primary, assigned_by)
			 values ($1, $2, $3, true, $4)`,
			[randomUUID(), employee.employeeId, manager.employeeId, ownerUserId],
		);
	});

	async function listFor(viewer: { employeeId: string }, canManageCompliance = false) {
		const scope = await resolveComplianceExceptionInboxScope({
			organizationId,
			employeeId: viewer.employeeId,
			canManageCompliance,
		});
		return getApprovalInboxListFromSources({
			sources: [],
			params: {
				approverId: viewer.employeeId,
				organizationId,
				complianceExceptionScope: scope,
			},
			complianceExceptionRead: complianceExceptionInboxRead,
			now: NOW,
		});
	}

	it("lists a managed employee's pending exception for their manager, for single review only", async () => {
		const exceptionId = await exception({ employeeId: employee.employeeId });

		const list = await listFor(manager);

		expect(list.counts.compliance_exception).toBe(1);
		expect(list.supportedTypes).toContain("compliance_exception");
		expect(list.items).toEqual([
			expect.objectContaining({
				id: exceptionId,
				type: "compliance_exception",
				entityId: exceptionId,
				status: "pending",
				requester: expect.objectContaining({ id: employee.employeeId }),
				triage: expect.objectContaining({ fastLaneGroup: null }),
				capabilities: {
					canApprove: true,
					canReject: true,
					canBulkApprove: false,
					requiresRejectReason: true,
					singleDecisionOnly: true,
				},
			}),
		]);
	});

	it("shows every organization exception with manage Compliance, only managed ones to a manager, none to others", async () => {
		const managedId = await exception({ employeeId: employee.employeeId });
		const unmanagedId = await exception({ employeeId: outsider.employeeId });
		const other = await fixture.organization("Europe/Berlin");
		const foreign = await fixture.employee({ organizationId: other.organizationId });
		await exception({ employeeId: foreign.employeeId, organizationId: other.organizationId });

		const complianceManager = await listFor(employee, true);
		expect(complianceManager.items.map((item) => item.id).sort()).toEqual(
			[managedId, unmanagedId].sort(),
		);
		expect(complianceManager.counts.compliance_exception).toBe(2);

		const teamManager = await listFor(manager);
		expect(teamManager.items.map((item) => item.id)).toEqual([managedId]);

		const unrelated = await listFor(outsider);
		expect(unrelated.items).toEqual([]);
		expect(unrelated.counts.compliance_exception).toBe(0);
	});

	it("keeps an expired exception out of the pending queue and its count", async () => {
		await exception({
			employeeId: employee.employeeId,
			createdAt: "2026-03-08T08:00:00Z",
			validUntil: "2026-03-09T08:00:00Z",
		});
		await exception({ employeeId: employee.employeeId, status: "expired" });

		const list = await listFor(manager);

		expect(list.items).toEqual([]);
		expect(list.counts.compliance_exception).toBe(0);
	});

	it("lists decided exceptions under their status filter, read-only", async () => {
		const approvedId = await exception({ employeeId: employee.employeeId, status: "approved" });
		const rejectedId = await exception({ employeeId: employee.employeeId, status: "rejected" });
		const scope = { kind: "managed" as const, employeeIds: [employee.employeeId] };
		const listStatus = (status: "approved" | "rejected") =>
			getApprovalInboxListFromSources({
				sources: [],
				params: {
					approverId: manager.employeeId,
					organizationId,
					status,
					complianceExceptionScope: scope,
				},
				complianceExceptionRead: complianceExceptionInboxRead,
				now: NOW,
			});

		const approved = await listStatus("approved");
		expect(approved.items).toEqual([
			expect.objectContaining({
				id: approvedId,
				status: "approved",
				capabilities: expect.objectContaining({ canApprove: false, canReject: false }),
			}),
		]);
		const rejected = await listStatus("rejected");
		expect(rejected.items.map((item) => item.id)).toEqual([rejectedId]);
		// The counts stay the pending queue's.
		expect(rejected.counts.compliance_exception).toBe(0);
	});

	it("shows a compliance manager their own pending exception without any decision", async () => {
		const ownId = await exception({ employeeId: manager.employeeId });

		const list = await listFor(manager, true);

		expect(list.items).toEqual([
			expect.objectContaining({
				id: ownId,
				capabilities: expect.objectContaining({
					canApprove: false,
					canReject: false,
					ownRequest: true,
				}),
			}),
		]);
	});

	it("opens the exception type, employee reason, planned duration, validity window and timeline", async () => {
		const exceptionId = await exception({
			employeeId: employee.employeeId,
			exceptionType: "rest_period",
			reason: "Night shift handover",
			plannedDurationMinutes: 90,
		});

		const detail = await getApprovalInboxDetail({
			approvalId: exceptionId,
			organizationId,
			approverId: manager.employeeId,
			complianceExceptionScope: { kind: "managed", employeeIds: [employee.employeeId] },
			now: NOW,
		});

		expect(detail.item).toMatchObject({ id: exceptionId, type: "compliance_exception" });
		expect(detail.actions).toMatchObject({
			canApprove: true,
			canBulkApprove: false,
			requiresRejectReason: true,
		});
		expect(detail.sections).toEqual([
			{
				type: "key_value",
				title: {
					key: "approvals:approvals.complianceException.sectionTitle",
					fallback: "ArbZG compliance exception",
				},
				rows: [
					{
						label: {
							key: "approvals:approvals.complianceException.employee",
							fallback: "Employee",
						},
						value: expect.any(String),
					},
					{
						label: {
							key: "approvals:approvals.complianceException.exceptionType",
							fallback: "Exception type",
						},
						value: {
							key: "approvals:approvals.complianceException.types.rest_period",
							fallback: "Rest Period",
						},
					},
					{
						label: {
							key: "approvals:approvals.complianceException.plannedDuration",
							fallback: "Planned duration",
						},
						value: {
							key: "approvals:approvals.complianceException.plannedHours",
							fallback: "{duration} h",
							params: { duration: "1:30" },
						},
					},
					{
						label: {
							key: "approvals:approvals.complianceException.validFrom",
							fallback: "Valid from",
						},
						value: { kind: "instant", at: "2026-03-10T08:00:00.000Z" },
					},
					{
						label: {
							key: "approvals:approvals.complianceException.validUntil",
							fallback: "Valid until",
						},
						value: { kind: "instant", at: "2026-03-11T08:00:00.000Z" },
					},
				],
			},
			{
				type: "text",
				title: {
					key: "approvals:approvals.complianceException.employeeReason",
					fallback: "Employee reason",
				},
				body: "Night shift handover",
			},
			{
				type: "timeline",
				title: { key: "approvals:approvals.timeline", fallback: "Timeline" },
				events: [
					{
						id: `${exceptionId}-requested`,
						label: {
							key: "approvals:approvals.complianceException.requested",
							fallback: "Requested",
						},
						at: "2026-03-10T08:00:00.000Z",
						actorName: expect.any(String),
					},
				],
			},
		]);
	});

	it("refuses the detail of an exception outside the viewer's scope or expired", async () => {
		const unmanagedId = await exception({ employeeId: outsider.employeeId });
		const expiredId = await exception({ employeeId: employee.employeeId, status: "expired" });
		const open = (approvalId: string) =>
			getApprovalInboxDetail({
				approvalId,
				organizationId,
				approverId: manager.employeeId,
				complianceExceptionScope: { kind: "managed", employeeIds: [employee.employeeId] },
				now: NOW,
			});

		await expect(open(unmanagedId)).rejects.toThrow("Approval not found");
		await expect(open(expiredId)).rejects.toThrow("Approval not found");
	});

	describe("deciding one exception", () => {
		const notifications = () => ({
			approved: vi.fn(async () => {}),
			rejected: vi.fn(async () => {}),
		});

		async function row(id: string) {
			const { rows } = await fixture.pool.query<{
				status: string;
				approver_id: string | null;
				approved_at: Date | null;
				rejected_at: Date | null;
				rejection_reason: string | null;
			}>(
				"select status, approver_id, approved_at, rejected_at, rejection_reason from compliance_exception where id = $1",
				[id],
			);
			return rows[0];
		}

		it("approves a managed employee's exception and notifies the employee", async () => {
			const exceptionId = await exception({ employeeId: employee.employeeId });
			const notify = notifications();

			await expect(
				decideComplianceExceptionFromInbox({
					organizationId,
					exceptionId,
					actorEmployeeId: manager.employeeId,
					scope: { kind: "managed", employeeIds: [employee.employeeId] },
					action: "approve",
					now: NOW,
					notify,
				}),
			).resolves.toEqual({ id: exceptionId, type: "compliance_exception", status: "approved" });

			expect(await row(exceptionId)).toMatchObject({
				status: "approved",
				approver_id: manager.employeeId,
				approved_at: expect.any(Date),
				rejected_at: null,
			});
			expect(notify.approved).toHaveBeenCalledWith(
				expect.objectContaining({
					exceptionId,
					employeeUserId: employee.userId,
					organizationId,
					exceptionType: "overtime_daily",
					validUntil: new Date("2026-03-11T08:00:00Z"),
				}),
			);
			expect(notify.rejected).not.toHaveBeenCalled();
			const { rows } = await fixture.pool.query<{ count: number }>(
				"select count(*)::int as count from approval_request where organization_id = $1",
				[organizationId],
			);
			expect(rows).toEqual([{ count: 0 }]);
		});

		it("refuses a blank rejection reason, then rejects with the reason and notifies", async () => {
			const exceptionId = await exception({ employeeId: employee.employeeId });
			const notify = notifications();
			const reject = (reason: string) =>
				decideComplianceExceptionFromInbox({
					organizationId,
					exceptionId,
					actorEmployeeId: manager.employeeId,
					scope: { kind: "organization" },
					action: "reject",
					reason,
					now: NOW,
					notify,
				});

			await expect(reject("  ")).rejects.toThrow("Rejection reason is required");
			expect((await row(exceptionId))?.status).toBe("pending");

			await expect(reject(" Cover is already planned ")).resolves.toMatchObject({
				status: "rejected",
			});
			expect(await row(exceptionId)).toMatchObject({
				status: "rejected",
				approver_id: manager.employeeId,
				rejected_at: expect.any(Date),
				rejection_reason: "Cover is already planned",
			});
			expect(notify.rejected).toHaveBeenCalledWith(
				expect.objectContaining({ exceptionId, reason: "Cover is already planned" }),
			);
		});

		it("refuses the requester's own exception even with manage Compliance", async () => {
			const exceptionId = await exception({ employeeId: manager.employeeId });

			await expect(
				decideComplianceExceptionFromInbox({
					organizationId,
					exceptionId,
					actorEmployeeId: manager.employeeId,
					scope: { kind: "organization" },
					action: "approve",
					now: NOW,
					notify: notifications(),
				}),
			).rejects.toThrow("You cannot decide your own compliance exception");
			expect((await row(exceptionId))?.status).toBe("pending");
		});

		it("refuses an exception outside the actor's scope as not found", async () => {
			const exceptionId = await exception({ employeeId: outsider.employeeId });

			await expect(
				decideComplianceExceptionFromInbox({
					organizationId,
					exceptionId,
					actorEmployeeId: manager.employeeId,
					scope: { kind: "managed", employeeIds: [employee.employeeId] },
					action: "approve",
					now: NOW,
					notify: notifications(),
				}),
			).rejects.toThrow("Approval not found");
			expect((await row(exceptionId))?.status).toBe("pending");
		});

		it("refuses an expired or already decided exception as stale", async () => {
			const expiredId = await exception({
				employeeId: employee.employeeId,
				createdAt: "2026-03-08T08:00:00Z",
				validUntil: "2026-03-09T08:00:00Z",
			});
			const approvedId = await exception({ employeeId: employee.employeeId, status: "approved" });
			const approve = (exceptionId: string) =>
				decideComplianceExceptionFromInbox({
					organizationId,
					exceptionId,
					actorEmployeeId: manager.employeeId,
					scope: { kind: "organization" },
					action: "approve",
					now: NOW,
					notify: notifications(),
				});

			await expect(approve(expiredId)).rejects.toThrow("Request is already expired");
			await expect(approve(approvedId)).rejects.toThrow("Request is already approved");
			expect((await row(expiredId))?.status).toBe("pending");
		});
	});

	it("refuses bulk decisions of compliance exceptions, one at a time only", async () => {
		const exceptionId = await exception({ employeeId: employee.employeeId });
		const refusal = {
			id: exceptionId,
			code: "unsupported",
			message: "Compliance exceptions are decided one at a time",
		};

		await expect(
			bulkApproveApprovalInboxItems({
				approvalIds: [exceptionId],
				actorEmployeeId: manager.employeeId,
				organizationId,
				includeAllApprovers: true,
			}),
		).resolves.toEqual({ succeeded: [], failed: [refusal] });
		await expect(
			bulkRejectApprovalInboxItems({
				approvalIds: [exceptionId],
				actorEmployeeId: manager.employeeId,
				organizationId,
				reason: "No",
				includeAllApprovers: true,
			}),
		).resolves.toEqual({ succeeded: [], failed: [refusal] });
		const { rows } = await fixture.pool.query<{ status: string }>(
			"select status from compliance_exception where id = $1",
			[exceptionId],
		);
		expect(rows).toEqual([{ status: "pending" }]);
	});

	it("never puts a compliance exception in a Covering section", async () => {
		await exception({ employeeId: employee.employeeId });

		const deputy = await getApprovalInboxListFromSources({
			sources: [],
			params: {
				approverId: outsider.employeeId,
				organizationId,
				covering: [{ approverId: manager.employeeId, approverName: "Manager" }],
				complianceExceptionScope: null,
			},
			complianceExceptionRead: complianceExceptionInboxRead,
			now: NOW,
		});

		expect(deputy.items).toEqual([]);
		expect(deputy.covering).toEqual([
			expect.objectContaining({ approverId: manager.employeeId, count: 0, rows: [] }),
		]);
	});
});
