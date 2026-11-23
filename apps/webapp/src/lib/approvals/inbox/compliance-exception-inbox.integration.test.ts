/**
 * #1977 runtime evidence (Approvals ADR-0005): ArbZG compliance exceptions are listed, counted,
 * opened and decided in the Approval inbox through their own adapter, backed by the
 * `compliance_exception` rows alone.
 *
 * Local contract: pnpm --filter webapp test:integration
 */
import { randomUUID } from "node:crypto";
import { Effect } from "effect";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { UnifiedApprovalItem } from "@/lib/approvals/domain/types";
import { type Clock, parseInstant } from "@/lib/datetime/temporal-core";
import {
	AuthorizationError,
	ConflictError,
	NotFoundError,
	ValidationError,
} from "@/lib/effect/errors";
import {
	type ClosedMonthDatabaseFixture,
	createClosedMonthDatabaseFixture,
} from "@/lib/time-tracking/closed-months/testing/closed-month-database.test.fixture";
import {
	complianceExceptionInboxRead,
	decideComplianceExceptionFromInbox,
	findComplianceExceptionDecisionTarget,
	resolveComplianceExceptionInboxScope,
} from "./compliance-exception-inbox";
import { bulkApproveApprovalInboxItems, bulkRejectApprovalInboxItems } from "./decision-service";
import { getApprovalInboxDetail, getApprovalInboxListFromSources } from "./read-service";
import type { ApprovalInboxSource } from "./source-adapters";

type ComplianceScope = Parameters<typeof decideComplianceExceptionFromInbox>[0]["scope"];

const NOW = new Date("2026-03-10T12:00:00Z");
/** The decisions' clock: the same instant as `NOW`. */
const AT_NOW: Clock = { nowInstant: () => parseInstant("2026-03-10T12:00:00Z") };

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
					clock: AT_NOW,
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
					clock: AT_NOW,
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

		it("checks scope, self-decision and staleness before a blank rejection reason", async () => {
			const unmanagedId = await exception({ employeeId: outsider.employeeId });
			const ownId = await exception({ employeeId: manager.employeeId });
			const expiredId = await exception({
				employeeId: employee.employeeId,
				createdAt: "2026-03-08T08:00:00Z",
				validUntil: "2026-03-09T08:00:00Z",
			});
			const pendingId = await exception({ employeeId: employee.employeeId });
			const rejectBlank = (exceptionId: string, scope: ComplianceScope) =>
				decideComplianceExceptionFromInbox({
					organizationId,
					exceptionId,
					actorEmployeeId: manager.employeeId,
					scope,
					action: "reject",
					reason: " ",
					clock: AT_NOW,
					notify: notifications(),
				});
			const managed: ComplianceScope = { kind: "managed", employeeIds: [employee.employeeId] };

			await expect(rejectBlank(unmanagedId, managed)).rejects.toBeInstanceOf(NotFoundError);
			await expect(rejectBlank(ownId, { kind: "organization" })).rejects.toBeInstanceOf(
				AuthorizationError,
			);
			await expect(rejectBlank(expiredId, managed)).rejects.toBeInstanceOf(ConflictError);
			await expect(rejectBlank(pendingId, managed)).rejects.toBeInstanceOf(ValidationError);
		});

		it("names the organization's exception as a decision target, whatever its status", async () => {
			const pendingId = await exception({ employeeId: employee.employeeId });
			const expiredId = await exception({ employeeId: employee.employeeId, status: "expired" });
			const other = await fixture.organization("Europe/Berlin");
			const foreign = await fixture.employee({ organizationId: other.organizationId });
			const foreignId = await exception({
				employeeId: foreign.employeeId,
				organizationId: other.organizationId,
			});
			const target = (id: string) => findComplianceExceptionDecisionTarget({ organizationId, id });

			await expect(target(pendingId)).resolves.toEqual({
				entityType: "compliance_exception",
				targetType: "compliance_exception",
				status: "pending",
				workflowKind: null,
			});
			await expect(target(expiredId)).resolves.toMatchObject({ status: "expired" });
			await expect(target(foreignId)).resolves.toBeNull();
			await expect(target(randomUUID())).resolves.toBeNull();
			await expect(target("approval-1")).resolves.toBeNull();
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
					clock: AT_NOW,
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
					clock: AT_NOW,
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
					clock: AT_NOW,
					notify: notifications(),
				});

			await expect(approve(expiredId)).rejects.toThrow("Request is already expired");
			await expect(approve(approvedId)).rejects.toThrow("Request is already approved");
			expect((await row(expiredId))?.status).toBe("pending");
		});

		it("refuses an exception already marked expired as expired, not pending", async () => {
			const exceptionId = await exception({ employeeId: employee.employeeId, status: "expired" });
			const notify = notifications();

			const decision = decideComplianceExceptionFromInbox({
				organizationId,
				exceptionId,
				actorEmployeeId: manager.employeeId,
				scope: { kind: "organization" },
				action: "reject",
				reason: "Too late",
				clock: AT_NOW,
				notify,
			});

			await expect(decision).rejects.toBeInstanceOf(ConflictError);
			await expect(decision).rejects.toThrow("Request is already expired");
			expect(await row(exceptionId)).toMatchObject({
				status: "expired",
				approver_id: null,
				rejection_reason: null,
			});
			expect(notify.rejected).not.toHaveBeenCalled();
		});

		it("lets exactly one of two concurrent decisions win, and notifies once", async () => {
			const exceptionId = await exception({ employeeId: employee.employeeId });
			const notify = notifications();
			const decide = (actorEmployeeId: string, action: "approve" | "reject") =>
				decideComplianceExceptionFromInbox({
					organizationId,
					exceptionId,
					actorEmployeeId,
					scope: { kind: "organization" },
					action,
					...(action === "reject" ? { reason: "Cover is already planned" } : {}),
					clock: AT_NOW,
					notify,
				});

			const results = await Promise.allSettled([
				decide(manager.employeeId, "approve"),
				decide(outsider.employeeId, "reject"),
			]);

			const won = results.filter((result) => result.status === "fulfilled");
			const lost = results.filter((result) => result.status === "rejected");
			expect(won).toHaveLength(1);
			expect(lost).toHaveLength(1);
			expect(lost[0]?.reason).toBeInstanceOf(ConflictError);
			const decided = await row(exceptionId);
			const winner = won[0]?.value;
			expect(decided?.status).toBe(winner?.status);
			expect(decided?.approver_id).toBe(
				winner?.status === "approved" ? manager.employeeId : outsider.employeeId,
			);
			expect(notify.approved.mock.calls.length + notify.rejected.mock.calls.length).toBe(1);
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
		const exceptionId = await exception({ employeeId: employee.employeeId });
		// The manager's own pending absence approval, which their deputy does cover.
		const absence: UnifiedApprovalItem = {
			id: randomUUID(),
			approvalType: "absence_entry",
			entityId: randomUUID(),
			typeName: "Absence Request",
			requester: {
				id: employee.employeeId,
				userId: employee.userId,
				name: "Avery Employee",
				email: "avery@example.com",
				image: null,
				teamId: null,
			},
			approverId: manager.employeeId,
			organizationId,
			status: "pending",
			createdAt: new Date("2026-03-10T09:00:00Z"),
			resolvedAt: null,
			priority: "normal",
			sla: { deadline: null, status: "on_time", hoursRemaining: null },
			display: { title: "Vacation", subtitle: "Mar 12", summary: "1 day off" },
		};
		const absences: ApprovalInboxSource = {
			type: "absence_entry",
			displayName: "Absence",
			supportsBulkApprove: true,
			handler: {
				getApprovals: (params: { approverId: string }) =>
					Effect.succeed(params.approverId === manager.employeeId ? [absence] : []),
				getCount: (approverId: string) => Effect.succeed(approverId === manager.employeeId ? 1 : 0),
			} as never,
		};

		// The deputy manages Compliance: their own scope holds the manager's employee's exception,
		// which a Covering section must still never pick up.
		const deputy = await getApprovalInboxListFromSources({
			sources: [absences],
			params: {
				approverId: outsider.employeeId,
				organizationId,
				covering: [{ approverId: manager.employeeId, approverName: "Manager" }],
				complianceExceptionScope: { kind: "organization" },
			},
			complianceExceptionRead: complianceExceptionInboxRead,
			now: NOW,
		});

		const [section] = deputy.covering ?? [];
		expect(section).toMatchObject({ approverId: manager.employeeId, count: 1 });
		expect(section?.rows.map((row) => [row.type, row.id])).toEqual([["absence_entry", absence.id]]);
		const own = deputy.items.find((item) => item.id === exceptionId);
		expect(own).toMatchObject({ type: "compliance_exception" });
		expect(own?.coveringFor).toBeUndefined();
	});
});
