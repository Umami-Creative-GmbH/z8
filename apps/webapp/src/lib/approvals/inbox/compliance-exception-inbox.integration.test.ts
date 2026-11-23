/**
 * #1977 runtime evidence (Approvals ADR-0005): ArbZG compliance exceptions are listed, counted,
 * opened and decided in the Approval inbox through their own adapter, backed by the
 * `compliance_exception` rows alone.
 *
 * Local contract: pnpm --filter webapp test:integration
 */
import { randomUUID } from "node:crypto";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { Effect } from "effect";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import type { UnifiedApprovalItem } from "@/lib/approvals/domain/types";
import { getPrimaryEligibleManagerIdForRequester } from "@/lib/approvals/policies/manager-eligibility-db";
import { type AppAbility, defineAbilityFor } from "@/lib/authorization/ability";
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
	decideComplianceExceptionForActor,
	decideComplianceExceptionFromInbox,
	findComplianceExceptionDecisionTarget,
	resolveComplianceExceptionInboxScope,
} from "./compliance-exception-inbox";
import { bulkApproveApprovalInboxItems, bulkRejectApprovalInboxItems } from "./decision-service";
import {
	type ApprovalInboxListParams,
	getApprovalInboxDetail,
	getApprovalInboxListFromSources,
} from "./read-service";
import type { ApprovalInboxSource } from "./source-adapters";
import { resolveApprovalInboxViewerScope } from "./viewer-scope";

// The route seam notifies through the real triggers; record them instead of delivering.
const triggers = vi.hoisted(() => ({
	approved: vi.fn(async () => {}),
	rejected: vi.fn(async () => {}),
}));
vi.mock("@/lib/notifications/compliance-triggers", () => ({
	onComplianceExceptionApproved: triggers.approved,
	onComplianceExceptionRejected: triggers.rejected,
}));

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
		status?: "pending" | "approved" | "rejected" | "expired" | "used";
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
		// The validity window in the organization's zone (Berlin, UTC+1 in March), never UTC.
		expect(list.items[0]?.summary).toMatchObject({
			subtitle:
				"Valid 2026-03-10T09:00+01:00[Europe/Berlin] – 2026-03-11T09:00+01:00[Europe/Berlin]",
			localized: {
				subtitle: {
					key: "approvals:approvals.complianceException.validity",
					fallback: "Valid {from} – {until}",
					params: {
						from: {
							kind: "zoned_instant",
							at: "2026-03-10T08:00:00.000Z",
							timeZone: "Europe/Berlin",
						},
						until: {
							kind: "zoned_instant",
							at: "2026-03-11T08:00:00.000Z",
							timeZone: "Europe/Berlin",
						},
					},
				},
			},
		});
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

	it("lists a used exception as approved, under the approved filter only", async () => {
		const usedId = await exception({ employeeId: employee.employeeId, status: "used" });
		const idsUnder = async (status: "pending" | "approved" | "rejected") => {
			const list = await getApprovalInboxListFromSources({
				sources: [],
				params: {
					approverId: manager.employeeId,
					organizationId,
					status,
					complianceExceptionScope: { kind: "organization" },
				},
				complianceExceptionRead: complianceExceptionInboxRead,
				now: NOW,
			});
			return list.items.map((item) => [item.id, item.status]);
		};

		await expect(idsUnder("approved")).resolves.toEqual([[usedId, "approved"]]);
		await expect(idsUnder("pending")).resolves.toEqual([]);
		await expect(idsUnder("rejected")).resolves.toEqual([]);
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
						value: {
							kind: "zoned_instant",
							at: "2026-03-10T08:00:00.000Z",
							timeZone: "Europe/Berlin",
						},
					},
					{
						label: {
							key: "approvals:approvals.complianceException.validUntil",
							fallback: "Valid until",
						},
						value: {
							kind: "zoned_instant",
							at: "2026-03-11T08:00:00.000Z",
							timeZone: "Europe/Berlin",
						},
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
			// The loser learns how the exception was decided, not merely that it was.
			expect(lost[0]?.reason.message).toBe(`Request is already ${winner?.status}`);
			expect(decided?.status).toBe(winner?.status);
			expect(decided?.approver_id).toBe(
				winner?.status === "approved" ? manager.employeeId : outsider.employeeId,
			);
			expect(notify.approved.mock.calls.length + notify.rejected.mock.calls.length).toBe(1);
		});

		it("refuses as expired when the validity window closes before the decision is written", async () => {
			// Valid 2026-03-10T08:00Z – 2026-03-11T08:00Z: open when read, closed when written.
			const exceptionId = await exception({ employeeId: employee.employeeId });
			const readings = ["2026-03-11T07:59:59.999Z", "2026-03-11T08:00:00Z"];
			const closingClock: Clock = {
				nowInstant: () => parseInstant(readings.shift() ?? "2026-03-11T08:00:00Z"),
			};
			const notify = notifications();

			const decision = decideComplianceExceptionFromInbox({
				organizationId,
				exceptionId,
				actorEmployeeId: manager.employeeId,
				scope: { kind: "organization" },
				action: "approve",
				clock: closingClock,
				notify,
			});

			await expect(decision).rejects.toBeInstanceOf(ConflictError);
			await expect(decision).rejects.toThrow("Request is already expired");
			expect(await row(exceptionId)).toMatchObject({ status: "pending", approver_id: null });
			expect(notify.approved).not.toHaveBeenCalled();
		});

		it("refuses as not found when the manager's scope is revoked before the decision is written", async () => {
			const exceptionId = await exception({ employeeId: employee.employeeId });
			const dialect = new PgDialect();
			// The manager link goes away after the exception was read in scope, before the write.
			const revokingDatabase = {
				async execute(statement: SQL) {
					if (/^\s*update\b/i.test(dialect.sqlToQuery(statement).sql)) {
						await fixture.pool.query(
							"delete from employee_managers where employee_id = $1 and manager_id = $2",
							[employee.employeeId, manager.employeeId],
						);
					}
					return db.execute(statement);
				},
			};
			const notify = notifications();

			const decision = decideComplianceExceptionFromInbox({
				organizationId,
				exceptionId,
				actorEmployeeId: manager.employeeId,
				scope: { kind: "managed", employeeIds: [employee.employeeId] },
				action: "approve",
				clock: AT_NOW,
				notify,
				database: revokingDatabase,
			});

			await expect(decision).rejects.toBeInstanceOf(NotFoundError);
			await expect(decision).rejects.toThrow("Approval not found");
			expect(await row(exceptionId)).toMatchObject({ status: "pending", approver_id: null });
			expect(notify.approved).not.toHaveBeenCalled();
		});
	});

	describe("a team's primary manager", () => {
		let teamLead: { employeeId: string; userId: string };
		let teamId: string;

		beforeEach(async () => {
			teamLead = await fixture.employee({ organizationId });
			await fixture.pool.query("update employee set role = 'manager' where id = $1", [
				teamLead.employeeId,
			]);
			teamId = await fixture.team(organizationId);
			await fixture.pool.query("update team set primary_manager_id = $2 where id = $1", [
				teamId,
				teamLead.employeeId,
			]);
			// The outsider has no direct manager; the employee has one, the manager.
			await fixture.setEmployeeTeam(outsider.employeeId, teamId);
			await fixture.setEmployeeTeam(employee.employeeId, teamId);
		});

		const rejectAs = (actor: { employeeId: string }, exceptionId: string) =>
			decideComplianceExceptionForActor({
				organizationId,
				exceptionId,
				actorEmployeeId: actor.employeeId,
				canManageCompliance: false,
				action: "reject",
				reason: "Cover is already planned",
				clock: AT_NOW,
			});

		it("sees and decides the exception of a team member who has no direct manager", async () => {
			const exceptionId = await exception({ employeeId: outsider.employeeId });

			const list = await listFor(teamLead);

			expect(list.items.map((item) => item.id)).toEqual([exceptionId]);
			expect(list.counts.compliance_exception).toBe(1);
			await expect(rejectAs(teamLead, exceptionId)).resolves.toMatchObject({
				status: "rejected",
			});
		});

		it("neither sees nor decides the exception of a team member with a direct manager", async () => {
			const exceptionId = await exception({ employeeId: employee.employeeId });

			const list = await listFor(teamLead);

			expect(list.items).toEqual([]);
			await expect(rejectAs(teamLead, exceptionId)).rejects.toBeInstanceOf(NotFoundError);
			await expect(rejectAs(manager, exceptionId)).resolves.toMatchObject({ status: "rejected" });
		});

		it("lets the manager a requested exception notifies decide it", async () => {
			for (const requester of [outsider, employee]) {
				const exceptionId = await exception({ employeeId: requester.employeeId });
				const notifiedManagerId = await getPrimaryEligibleManagerIdForRequester({
					db,
					requesterEmployeeId: requester.employeeId,
					organizationId,
				});
				expect(notifiedManagerId).not.toBeNull();

				await expect(
					rejectAs({ employeeId: notifiedManagerId ?? "" }, exceptionId),
				).resolves.toMatchObject({ status: "rejected" });
			}
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

	it("answers a bulk decision of an exception outside the actor's scope as an unknown id", async () => {
		const unmanagedId = await exception({ employeeId: outsider.employeeId });
		const unknownId = randomUUID();
		const bulk = {
			approvalIds: [unmanagedId, unknownId],
			actorEmployeeId: manager.employeeId,
			organizationId,
			includeAllApprovers: true as const,
		};
		const notFound = (id: string) => ({ id, code: "not_found", message: "Approval not found" });

		await expect(bulkApproveApprovalInboxItems(bulk)).resolves.toEqual({
			succeeded: [],
			failed: [notFound(unmanagedId), notFound(unknownId)],
		});
		await expect(bulkRejectApprovalInboxItems({ ...bulk, reason: "No" })).resolves.toEqual({
			succeeded: [],
			failed: [notFound(unmanagedId), notFound(unknownId)],
		});
		// Managing Compliance widens the scope to the organization: one at a time again.
		await expect(
			bulkApproveApprovalInboxItems({ ...bulk, canManageCompliance: true }),
		).resolves.toEqual({
			succeeded: [],
			failed: [
				{
					id: unmanagedId,
					code: "unsupported",
					message: "Compliance exceptions are decided one at a time",
				},
				notFound(unknownId),
			],
		});
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

	function abilityFor(
		viewer: { employeeId: string; userId: string },
		access: { membership: "admin" | "member"; role: "manager" | "employee" },
	): AppAbility {
		return defineAbilityFor({
			userId: viewer.userId,
			isPlatformAdmin: false,
			activeOrganizationId: organizationId,
			orgMembership: { organizationId, role: access.membership, status: "active" },
			employee: { id: viewer.employeeId, organizationId, role: access.role, teamId: null },
			permissions: { orgWide: null, byTeamId: new Map() },
			managedEmployeeIds: [],
			customRoles: [],
		});
	}

	function viewerScopeOf(
		viewer: { employeeId: string; userId: string },
		access: { membership: "admin" | "member"; role: "manager" | "employee" },
	) {
		return resolveApprovalInboxViewerScope({
			ability: abilityFor(viewer, access),
			employee: { id: viewer.employeeId, organizationId, role: access.role },
			clock: AT_NOW,
		});
	}

	/** The outsider covers for the manager, who is absent around `NOW` (#1016). */
	async function outsiderCoversForManager() {
		await fixture.pool.query("update employee set role = 'manager' where id = $1", [
			outsider.employeeId,
		]);
		await fixture.pool.query(
			`insert into approval_setting (organization_id, deputy_decisions_enabled) values ($1, true)
			 on conflict (organization_id) do update set deputy_decisions_enabled = true`,
			[organizationId],
		);
		const absenceId = await fixture.absence({
			organizationId,
			employeeId: manager.employeeId,
			startDate: "2026-03-09",
			endDate: "2026-03-11",
		});
		await fixture.pool.query("update absence_entry set deputy_employee_id = $2 where id = $1", [
			absenceId,
			outsider.employeeId,
		]);
	}

	describe("the viewer's inbox scope", () => {
		it("limits a manager's compliance exceptions to the employees they manage", async () => {
			const scope = await viewerScopeOf(manager, { membership: "member", role: "manager" });

			expect(scope?.complianceExceptionScope).toEqual({
				kind: "managed",
				employeeIds: [employee.employeeId],
			});
			expect(scope?.complianceExceptionsOnly).toBeUndefined();
		});

		it("gives managing Compliance alone every exception of the organization and no approvals", async () => {
			const exceptionId = await exception({ employeeId: employee.employeeId });

			const scope = await viewerScopeOf(outsider, { membership: "admin", role: "employee" });

			expect(scope).toMatchObject({
				complianceExceptionsOnly: true,
				complianceExceptionScope: { kind: "organization" },
				eligibleApprovalScopes: [],
				covering: [],
			});
			if (!scope) throw new Error("expected an inbox scope");
			const list = await getApprovalInboxListFromSources({
				sources: [],
				params: scope,
				complianceExceptionRead: complianceExceptionInboxRead,
				now: NOW,
			});
			expect(list.items.map((item) => item.id)).toEqual([exceptionId]);
		});

		it("opens no inbox to an employee who neither approves nor manages Compliance", async () => {
			await expect(
				viewerScopeOf(employee, { membership: "member", role: "employee" }),
			).resolves.toBeNull();
		});

		it("shows a covering deputy none of the absent manager's compliance exceptions", async () => {
			await outsiderCoversForManager();
			await exception({ employeeId: employee.employeeId });

			const scope = await viewerScopeOf(outsider, { membership: "member", role: "manager" });

			expect(scope?.covering).toEqual([
				expect.objectContaining({ approverId: manager.employeeId }),
			]);
			expect(scope?.complianceExceptionScope).toBeNull();
			if (!scope) throw new Error("expected an inbox scope");
			const list = await getApprovalInboxListFromSources({
				sources: [],
				params: scope,
				complianceExceptionRead: complianceExceptionInboxRead,
				now: NOW,
			});
			expect(list.items).toEqual([]);
			expect(list.counts.compliance_exception).toBe(0);
			expect(list.supportedTypes).not.toContain("compliance_exception");
			expect((list.covering ?? []).flatMap((section) => section.rows)).toEqual([]);
		});
	});

	describe("deciding at the inbox route seam", () => {
		beforeEach(() => {
			triggers.approved.mockClear();
			triggers.rejected.mockClear();
		});

		const rejectAs = (
			actor: { employeeId: string },
			exceptionId: string,
			options: { canManageCompliance?: boolean; clock?: Clock } = {},
		) =>
			decideComplianceExceptionForActor({
				organizationId,
				exceptionId,
				actorEmployeeId: actor.employeeId,
				canManageCompliance: options.canManageCompliance ?? false,
				action: "reject",
				reason: "Cover is already planned",
				clock: options.clock ?? AT_NOW,
			});

		/** What a refused decision tells its caller. */
		async function refusalOf(decision: Promise<unknown>) {
			const error = await decision.then(
				() => null,
				(cause: unknown) => cause,
			);
			return error instanceof Error
				? { tag: (error as { _tag?: string })._tag, message: error.message }
				: error;
		}

		async function statusOf(exceptionId: string) {
			const { rows } = await fixture.pool.query<{ status: string }>(
				"select status from compliance_exception where id = $1",
				[exceptionId],
			);
			return rows[0]?.status;
		}

		it("refuses an actor who sees no exceptions as not found", async () => {
			const exceptionId = await exception({ employeeId: employee.employeeId });

			await expect(rejectAs(outsider, exceptionId)).rejects.toBeInstanceOf(NotFoundError);
			expect(await statusOf(exceptionId)).toBe("pending");
		});

		it("lets manage Compliance decide any exception of the organization and notifies", async () => {
			const exceptionId = await exception({ employeeId: employee.employeeId });

			await expect(rejectAs(outsider, exceptionId, { canManageCompliance: true })).resolves.toEqual(
				{ id: exceptionId, type: "compliance_exception", status: "rejected" },
			);
			expect(triggers.rejected).toHaveBeenCalledWith(
				expect.objectContaining({ exceptionId, reason: "Cover is already planned" }),
			);
		});

		it("limits a manager to the exceptions of the employees they manage", async () => {
			const managedId = await exception({ employeeId: employee.employeeId });
			const unmanagedId = await exception({ employeeId: outsider.employeeId });

			await expect(rejectAs(manager, unmanagedId)).rejects.toBeInstanceOf(NotFoundError);
			expect(await statusOf(unmanagedId)).toBe("pending");
			await expect(rejectAs(manager, managedId)).resolves.toMatchObject({ status: "rejected" });
		});

		it("answers an exception outside the actor's scope exactly as an unknown id", async () => {
			const unmanagedId = await exception({ employeeId: outsider.employeeId });

			const outOfScope = await refusalOf(rejectAs(manager, unmanagedId));
			const unknown = await refusalOf(rejectAs(manager, randomUUID()));

			expect(outOfScope).toEqual(unknown);
			expect(outOfScope).toEqual({ tag: "NotFoundError", message: "Approval not found" });
		});

		it("refuses a covering deputy the absent manager's exceptions", async () => {
			await outsiderCoversForManager();
			const exceptionId = await exception({ employeeId: employee.employeeId });

			await expect(rejectAs(outsider, exceptionId)).rejects.toBeInstanceOf(NotFoundError);
			expect(await statusOf(exceptionId)).toBe("pending");
		});

		it("judges the validity window by the clock it is given", async () => {
			// Valid 2026-03-10T08:00Z – 2026-03-11T08:00Z, long before the system clock.
			const exceptionId = await exception({ employeeId: employee.employeeId });
			const atExpiry: Clock = { nowInstant: () => parseInstant("2026-03-11T08:00:00Z") };

			await expect(rejectAs(manager, exceptionId, { clock: atExpiry })).rejects.toThrow(
				"Request is already expired",
			);
			await expect(rejectAs(manager, exceptionId)).resolves.toMatchObject({ status: "rejected" });
		});
	});

	describe("list filters and paging", () => {
		const everyException: ComplianceScope = { kind: "organization" };

		function listWith(
			params: Partial<ApprovalInboxListParams>,
			sources: ApprovalInboxSource[] = [],
		) {
			return getApprovalInboxListFromSources({
				sources,
				params: {
					approverId: manager.employeeId,
					organizationId,
					complianceExceptionScope: everyException,
					...params,
				},
				complianceExceptionRead: complianceExceptionInboxRead,
				now: NOW,
			});
		}

		it("filters exceptions by search, team, submission date, age and priority", async () => {
			const teamId = await fixture.team(organizationId);
			await fixture.setEmployeeTeam(employee.employeeId, teamId);
			await fixture.pool.query(`update "user" set name = 'Quinn Searchable' where id = $1`, [
				employee.userId,
			]);
			const recentId = await exception({
				employeeId: employee.employeeId,
				createdAt: "2026-03-10T08:00:00Z",
				reason: "Inventory count runs late",
			});
			const olderId = await exception({
				employeeId: outsider.employeeId,
				createdAt: "2026-03-06T08:00:00Z",
				validUntil: "2026-03-12T08:00:00Z",
				reason: "Audit preparation",
			});
			const idsWith = async (params: Partial<ApprovalInboxListParams>) => {
				const list = await listWith(params);
				return {
					ids: list.items.map((item) => item.id),
					count: list.counts.compliance_exception,
				};
			};

			await expect(idsWith({ search: "searchable" })).resolves.toEqual({
				ids: [recentId],
				count: 1,
			});
			await expect(idsWith({ search: "AUDIT" })).resolves.toEqual({ ids: [olderId], count: 1 });
			await expect(idsWith({ teamId })).resolves.toEqual({ ids: [recentId], count: 1 });
			await expect(
				idsWith({
					dateRange: {
						from: new Date("2026-03-05T00:00:00Z"),
						to: new Date("2026-03-07T00:00:00Z"),
					},
				}),
			).resolves.toEqual({ ids: [olderId], count: 1 });
			await expect(idsWith({ minAgeDays: 2 })).resolves.toEqual({ ids: [olderId], count: 1 });
			await expect(idsWith({ priority: "high" })).resolves.toEqual({
				ids: [olderId, recentId],
				count: 2,
			});
			await expect(idsWith({ priority: "normal" })).resolves.toEqual({ ids: [], count: 0 });
		});

		it("pages exceptions and other inbox types together under one cursor", async () => {
			const exceptionIds = [
				await exception({ employeeId: employee.employeeId, createdAt: "2026-03-10T08:00:00Z" }),
				await exception({ employeeId: employee.employeeId, createdAt: "2026-03-10T09:00:00Z" }),
				await exception({ employeeId: outsider.employeeId, createdAt: "2026-03-10T10:00:00Z" }),
			];
			const absenceAt = (createdAt: string, priority: UnifiedApprovalItem["priority"]) =>
				({
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
					createdAt: new Date(createdAt),
					resolvedAt: null,
					priority,
					sla: { deadline: null, status: "on_time", hoursRemaining: null },
					display: { title: "Vacation", subtitle: "Mar 12", summary: "1 day off" },
				}) satisfies UnifiedApprovalItem;
			const absences = [
				absenceAt("2026-03-10T08:30:00Z", "high"),
				absenceAt("2026-03-10T09:30:00Z", "normal"),
				absenceAt("2026-03-10T07:00:00Z", "urgent"),
			];
			const absenceSource: ApprovalInboxSource = {
				type: "absence_entry",
				displayName: "Absence",
				supportsBulkApprove: true,
				handler: {
					getApprovals: () => Effect.succeed(absences),
					getCount: () => Effect.succeed(absences.length),
				} as never,
			};

			const whole = await listWith({}, [absenceSource]);
			const paged: string[] = [];
			let cursor: string | undefined;
			for (let page = 0; page < 10; page++) {
				const list = await listWith({ limit: 2, ...(cursor ? { cursor } : {}) }, [absenceSource]);
				paged.push(...list.items.map((item) => item.id));
				if (!list.hasMore) break;
				cursor = list.nextCursor ?? undefined;
			}

			expect(whole.items).toHaveLength(6);
			expect(whole.items.map((item) => item.id)).toEqual(expect.arrayContaining(exceptionIds));
			expect(paged).toEqual(whole.items.map((item) => item.id));
		});

		/**
		 * An exception as the app files it: `created_at` from the database's `now()`, finer than
		 * the millisecond a cursor carries. Each insert is its own transaction, so its own instant.
		 */
		async function exceptionFiledNow(employeeId: string): Promise<string> {
			const id = randomUUID();
			await fixture.pool.query(
				`insert into compliance_exception
				 (id, organization_id, employee_id, exception_type, status, reason,
				  valid_from, valid_until, created_by, updated_at)
				 values ($1, $2, $3, 'overtime_daily', 'pending', 'Inventory count runs late',
				  '2026-03-10T08:00:00Z', '2026-03-11T08:00:00Z', $4, now())`,
				[id, organizationId, employeeId, ownerUserId],
			);
			return id;
		}

		/** Every page at `limit`, following the cursor until the list says there is no more. */
		async function everyPage(limit: number, sources: ApprovalInboxSource[] = []) {
			const pages: { ids: string[]; hasMore: boolean }[] = [];
			let cursor: string | undefined;
			for (let page = 0; page < 20; page++) {
				const list = await listWith({ limit, ...(cursor ? { cursor } : {}) }, sources);
				pages.push({ ids: list.items.map((item) => item.id), hasMore: list.hasMore });
				if (!list.hasMore) break;
				cursor = list.nextCursor ?? undefined;
			}
			return pages;
		}

		it("reaches every exception filed at the database clock exactly once, page after page", async () => {
			const filed: string[] = [];
			for (let index = 0; index < 7; index++) {
				filed.push(await exceptionFiledNow(employee.employeeId));
			}

			const pages = await everyPage(2);

			expect(pages.map((page) => page.ids.length)).toEqual([2, 2, 2, 1]);
			expect(pages.map((page) => page.hasMore)).toEqual([true, true, true, false]);
			const paged = pages.flatMap((page) => page.ids);
			expect(paged).toHaveLength(7);
			expect([...paged].sort()).toEqual([...filed].sort());
		});

		it("reaches every exception filed at the database clock exactly once among other types", async () => {
			// Two other items first, so the exceptions fill the later pages on their own.
			const absences: UnifiedApprovalItem[] = [0, 1].map((minutesEarlier) => ({
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
				createdAt: new Date(Date.now() - (minutesEarlier + 1) * 60_000),
				resolvedAt: null,
				priority: "high",
				sla: { deadline: null, status: "on_time", hoursRemaining: null },
				display: { title: "Vacation", subtitle: "Mar 12", summary: "1 day off" },
			}));
			const filed: string[] = [];
			for (let index = 0; index < 7; index++) {
				filed.push(await exceptionFiledNow(outsider.employeeId));
			}
			const absenceSource: ApprovalInboxSource = {
				type: "absence_entry",
				displayName: "Absence",
				supportsBulkApprove: true,
				handler: {
					getApprovals: () => Effect.succeed(absences),
					getCount: () => Effect.succeed(absences.length),
				} as never,
			};

			const pages = await everyPage(3, [absenceSource]);

			expect(pages.map((page) => page.ids.length)).toEqual([3, 3, 3]);
			expect(pages.map((page) => page.hasMore)).toEqual([true, true, false]);
			const paged = pages.flatMap((page) => page.ids);
			expect(paged).toHaveLength(9);
			expect([...paged].sort()).toEqual(
				[...filed, ...absences.map((absence) => absence.id)].sort(),
			);
		});
	});
});
