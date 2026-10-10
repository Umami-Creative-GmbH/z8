/**
 * #1016 runtime evidence: a covering deputy lists, opens and decides an absent
 * approver's approvals, under canonical authority (an absence) and legacy
 * authority (a time correction), through the real inbox routes, the real
 * decision owners, covering (#1015) and the real CASL abilities. Only the
 * request/session, billing, e-mail, notification fan-out (recorded), the
 * calendar queue, work-balance marking, the Next cache and the delivery fast
 * path are replaced.
 *
 * Run: pnpm --filter webapp test:integration src/lib/approvals/deputy/deputy-decisions.integration.test.ts
 */

import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { parseInstant } from "@/lib/datetime/temporal-core";
import { integrationAdminPool } from "@/test/integration-database";

const harness = vi.hoisted(() => ({
	userId: null as string | null,
	organizationId: null as string | null,
	notifications: [] as Array<{ name: string; params: Record<string, unknown> }>,
}));

vi.mock("next/server", async (importOriginal) =>
	(await import("@/test/integration-harness")).nextServer(importOriginal),
);
vi.mock("next/headers", async () => (await import("@/test/integration-harness")).nextHeaders());
vi.mock("next/cache", async (importOriginal) =>
	(await import("@/test/integration-harness")).nextCache(importOriginal),
);

vi.mock("@/lib/auth", () => ({
	auth: {
		api: {
			getSession: async () =>
				harness.userId
					? {
							user: {
								id: harness.userId,
								role: "user",
								name: harness.userId,
								email: `${harness.userId}@example.test`,
							},
							session: {
								id: `session-${harness.userId}`,
								userId: harness.userId,
								activeOrganizationId: harness.organizationId,
							},
						}
					: null,
		},
	},
}));

vi.mock("@/lib/auth-helpers", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/lib/auth-helpers")>()),
	isOrgAdminCasl: async () => false,
	canApproveFor: async () => false,
	// React `cache` would pin the first actor for the whole test process.
	getAuthContext: async () => {
		if (!harness.userId || !harness.organizationId) return null;
		const { db } = await import("@/db");
		const { employee } = await import("@/db/schema");
		const { and, eq } = await import("drizzle-orm");
		const [row] = await db
			.select()
			.from(employee)
			.where(
				and(
					eq(employee.userId, harness.userId),
					eq(employee.organizationId, harness.organizationId),
				),
			)
			.limit(1);
		return {
			user: { id: harness.userId, name: harness.userId, email: `${harness.userId}@example.test` },
			session: { activeOrganizationId: harness.organizationId },
			employee: row
				? { id: row.id, organizationId: row.organizationId, role: row.role, teamId: row.teamId }
				: null,
		};
	},
}));

vi.mock("@/lib/billing/guard", async () =>
	(await import("@/test/integration-harness")).billingGuard(),
);
vi.mock("@/lib/app-url", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/lib/app-url")>()),
	getOrganizationBaseUrl: async () => "https://t1016.example.test",
}));
vi.mock("@/lib/email/email-service", async () =>
	(await import("@/test/integration-harness")).emailService(),
);
vi.mock("@/lib/email/render", async (importOriginal) =>
	(await import("@/test/integration-harness")).absenceEmailRender(importOriginal),
);
// Every trigger is recorded instead of fanned out.
vi.mock("@/lib/notifications/triggers", async (importOriginal) => {
	const original = await importOriginal<Record<string, unknown>>();
	return Object.fromEntries(
		Object.entries(original).map(([name, value]) => [
			name,
			typeof value === "function"
				? async (params: Record<string, unknown>) => {
						harness.notifications.push({ name, params });
					}
				: value,
		]),
	);
});
vi.mock("@/lib/absences/deputy-notifier", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/lib/absences/deputy-notifier")>()),
	notifyAbsenceDeputies: async () => undefined,
}));
vi.mock("@/lib/queue", async (importOriginal) =>
	(await import("@/test/integration-harness")).calendarSyncQueue(importOriginal),
);
vi.mock("@/lib/work-balance/service", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/lib/work-balance/service")>()),
	markEmployeeWorkBalanceDirty: async () => undefined,
}));
vi.mock("@/app/[locale]/(app)/time-tracking/actions/policy-helpers", async (importOriginal) => ({
	...(await importOriginal<
		typeof import("@/app/[locale]/(app)/time-tracking/actions/policy-helpers")
	>()),
	getEditCapabilityForPeriod: async () => ({ type: "approval_required" as const }),
}));
vi.mock("@/lib/approvals/delivery/kick", async () =>
	(await import("@/test/integration-harness")).deliveryKick(),
);

const { clockIn, clockOut } = await import("@/app/[locale]/(app)/time-tracking/actions/clocking");
const { requestTimeCorrection } = await import(
	"@/app/[locale]/(app)/time-tracking/actions/corrections"
);
const { requestAbsenceEffect } = await import(
	"@/app/[locale]/(app)/absences/request-absence-effect"
);
await import("@/lib/approvals/init");
const { GET: inboxRoute } = await import("@/app/api/approvals/inbox/route");
const { GET: detailRoute } = await import("@/app/api/approvals/inbox/[id]/route");
const { POST: approveRoute } = await import("@/app/api/approvals/inbox/[id]/approve/route");
const { POST: rejectRoute } = await import("@/app/api/approvals/inbox/[id]/reject/route");
const { processDueEscalations } = await import("@/lib/approvals/escalation/transfer");

const ids = {
	organization: "t1016-deputy-org",
	requesterUser: "t1016-requester-user",
	approverUser: "t1016-approver-user",
	deputyUser: "t1016-deputy-user",
	otherUser: "t1016-other-user",
	backupUser: "t1016-backup-user",
	requester: "e1016000-0000-4000-8000-000000000001",
	approver: "e1016000-0000-4000-8000-000000000002",
	deputy: "e1016000-0000-4000-8000-000000000003",
	other: "e1016000-0000-4000-8000-000000000004",
	backup: "e1016000-0000-4000-8000-000000000005",
	vacation: "e1016100-0000-4000-8000-000000000001",
	away: "e1016100-0000-4000-8000-000000000002",
	coveringAbsence: "e1016200-0000-4000-8000-000000000001",
	changePolicy: "e1016300-0000-4000-8000-000000000001",
	changePolicyAssignment: "e1016300-0000-4000-8000-000000000002",
	chainPolicy: "e1016400-0000-4000-8000-000000000001",
	chainFirstStage: "e1016400-0000-4000-8000-000000000002",
	chainSecondStage: "e1016400-0000-4000-8000-000000000003",
} as const;

const TIME_KINDS = ["manual_time_submission", "policy_clock_out", "time_correction"] as const;

function only<T>(rows: readonly T[]): T {
	const [row] = rows;
	if (rows.length !== 1 || row === undefined) {
		throw new Error(`Expected exactly one row, received ${rows.length}`);
	}
	return row;
}

/** A UTC calendar date `days` from today. */
function utcDay(days: number): string {
	return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
}

describe("deputy decisions (PostgreSQL)", () => {
	vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
	const admin = integrationAdminPool();

	function actAs(userId: string | null) {
		harness.userId = userId;
		harness.organizationId = userId ? ids.organization : null;
	}

	async function cleanup() {
		await admin.query("delete from organization where id = $1", [ids.organization]);
		await admin.query('delete from "user" where id = any($1::text[])', [
			[ids.requesterUser, ids.approverUser, ids.deputyUser, ids.otherUser, ids.backupUser],
		]);
	}

	async function seed(options: { absence: "canonical" | "legacy"; twoStageChain?: boolean }) {
		await cleanup();
		const timestamp = new Date("2026-07-01T00:00:00Z");
		await admin.query(
			`insert into organization (id, name, slug, created_at) values ($1, 'T1016 deputy', $1, $2)`,
			[ids.organization, timestamp],
		);
		await admin.query(
			`insert into approval_workflow_rollout
			 (organization_id, workflow_type, lifecycle_mode, side_effect_mode, created_at, updated_at)
			 values ($1, 'absence', $2, $3, $4, $4)`,
			[ids.organization, options.absence, options.absence, timestamp],
		);
		for (const kind of TIME_KINDS) {
			await admin.query(
				`insert into approval_workflow_rollout
				 (organization_id, workflow_type, lifecycle_mode, side_effect_mode, created_at, updated_at)
				 values ($1, $2, 'legacy', 'legacy', $3, $3)`,
				[ids.organization, kind, timestamp],
			);
		}
		await admin.query(
			`insert into approval_escalation_control
			 (organization_id, owner, automation_paused, escalation_owned_since)
			 values ($1, 'escalation', false, $2)`,
			[ids.organization, timestamp],
		);
		await admin.query(
			`insert into approval_escalation_policy
			 (organization_id, enabled, response_window_hours, revision, migration_provenance)
			 values ($1, true, 1, 1, '{"source":"t1016"}'::jsonb)`,
			[ids.organization],
		);
		await admin.query(
			`insert into "user" (id, name, email, created_at, updated_at) values
			 ($1, 'Avery Requester', 't1016-requester@example.test', $6, $6),
			 ($2, 'Xavier Approver', 't1016-approver@example.test', $6, $6),
			 ($3, 'Yara Deputy', 't1016-deputy@example.test', $6, $6),
			 ($4, 'Olli Other', 't1016-other@example.test', $6, $6),
			 ($5, 'Blake Backup', 't1016-backup@example.test', $6, $6)`,
			[
				ids.requesterUser,
				ids.approverUser,
				ids.deputyUser,
				ids.otherUser,
				ids.backupUser,
				timestamp,
			],
		);
		const users = [
			ids.requesterUser,
			ids.approverUser,
			ids.deputyUser,
			ids.otherUser,
			ids.backupUser,
		];
		await admin.query(
			`insert into user_settings (user_id, locale, timezone, time_format, updated_at)
			 select user_id, 'en', 'UTC', '24h', $2 from unnest($1::text[]) as user_id`,
			[users, timestamp],
		);
		await admin.query(
			`insert into member (id, organization_id, user_id, role, status, created_at)
			 select 't1016-member-' || user_id, $1, user_id, 'member', 'approved', $2
			 from unnest($3::text[]) as user_id`,
			[ids.organization, timestamp, users],
		);
		await admin.query(
			`insert into employee (id, user_id, organization_id, role, updated_at) values
			 ($1, $2, $11, 'employee', $12), ($3, $4, $11, 'manager', $12),
			 ($5, $6, $11, 'manager', $12), ($7, $8, $11, 'manager', $12),
			 ($9, $10, $11, 'manager', $12)`,
			[
				ids.requester,
				ids.requesterUser,
				ids.approver,
				ids.approverUser,
				ids.deputy,
				ids.deputyUser,
				ids.other,
				ids.otherUser,
				ids.backup,
				ids.backupUser,
				ids.organization,
				timestamp,
			],
		);
		// X decides the requester's approvals (B is the escalation backup); X
		// also manages Y, so Y's own requests go to X too. Y and O manage nobody.
		await admin.query(
			`insert into employee_managers
			 (id, employee_id, manager_id, is_primary, assigned_by, assigned_at, created_at) values
			 (gen_random_uuid(), $1, $2, true, $4, $5, $5),
			 (gen_random_uuid(), $1, $6, false, $4, $5, $5),
			 (gen_random_uuid(), $3, $2, true, $4, $5, $5)`,
			[ids.requester, ids.approver, ids.deputy, ids.approverUser, timestamp, ids.backup],
		);
		await admin.query(
			`insert into absence_category
			 (id, organization_id, type, name, requires_approval, requires_work_time,
			  counts_against_vacation, is_active, updated_at)
			 values ($1, $3, 'vacation', 'Vacation', true, false, true, true, $4),
			        ($2, $3, 'vacation', 'Away', true, false, false, true, $4)`,
			[ids.vacation, ids.away, ids.organization, timestamp],
		);
		// X is away around today and names Y as deputy.
		await admin.query(
			`insert into absence_entry
			 (id, employee_id, category_id, start_date, end_date, status, organization_id,
			  deputy_employee_id, updated_at)
			 values ($1, $2, $3, $4, $5, 'approved', $6, $7, $8)`,
			[
				ids.coveringAbsence,
				ids.approver,
				ids.away,
				utcDay(-2),
				utcDay(2),
				ids.organization,
				ids.deputy,
				timestamp,
			],
		);
		await admin.query(
			`insert into time_entry_append_control (organization_id, mode) values ($1, 'active')`,
			[ids.organization],
		);
		await admin.query(
			`insert into change_policy
			 (id, organization_id, name, self_service_days, approval_days, created_by, updated_at)
			 values ($1, $2, 'T1016 manual approval', 0, 3650, $3, $4)`,
			[ids.changePolicy, ids.organization, ids.approverUser, timestamp],
		);
		await admin.query(
			`insert into change_policy_assignment
			 (id, policy_id, organization_id, assignment_type, priority, created_by, updated_at)
			 values ($1, $2, $3, 'organization', 0, $4, $5)`,
			[ids.changePolicyAssignment, ids.changePolicy, ids.organization, ids.approverUser, timestamp],
		);
		if (options.twoStageChain) {
			// Y decides the first stage as its own approver; X the second.
			await admin.query(
				`insert into approval_policy
				 (id, organization_id, name, is_active, priority, created_by, updated_at)
				 values ($1, $2, 'T1016 two stages', true, 1, $3, $4)`,
				[ids.chainPolicy, ids.organization, ids.approverUser, timestamp],
			);
			await admin.query(
				`insert into approval_policy_stage
				 (id, organization_id, policy_id, step_order, label, approver_type,
				  approver_employee_id, fallback_behavior, updated_at) values
				 ($1, $3, $4, 1, 'First', 'specific_employee', $5, 'fail', $6),
				 ($2, $3, $4, 2, 'Manager', 'direct_manager', null, 'fail', $6)`,
				[
					ids.chainFirstStage,
					ids.chainSecondStage,
					ids.organization,
					ids.chainPolicy,
					ids.deputy,
					timestamp,
				],
			);
		}
	}

	async function setDeputyDecisions(enabled: boolean) {
		await admin.query(
			`insert into approval_setting (organization_id, deputy_decisions_enabled) values ($1, $2)
			 on conflict (organization_id) do update set deputy_decisions_enabled = excluded.deputy_decisions_enabled`,
			[ids.organization, enabled],
		);
	}

	async function submitAbsence(userId: string = ids.requesterUser) {
		actAs(userId);
		const result = await requestAbsenceEffect({
			categoryId: ids.vacation,
			startDate: utcDay(40),
			endDate: utcDay(41),
			startPeriod: "full_day",
			endPeriod: "full_day",
			durationKind: "full_day",
			notes: "",
		});
		actAs(null);
		if (!result.success) throw new Error(`Absence submission failed: ${result.error}`);
		const { rows } = await admin.query<{ id: string; workflow_id: string | null }>(
			`select r.id, a.approval_workflow_id as workflow_id
			 from approval_request r join absence_entry a on a.id = r.entity_id
			 where r.organization_id = $1 and r.entity_id = $2 and r.status = 'pending'`,
			[ids.organization, result.data.absenceId],
		);
		return { absenceId: result.data.absenceId, ...only(rows) };
	}

	async function submitTimeCorrection(day: string) {
		actAs(ids.requesterUser);
		await expect(
			clockIn("office", { instant: parseInstant(`${day}T08:00:00Z`), browserTimezone: "UTC" }),
		).resolves.toMatchObject({ success: true });
		await expect(
			clockOut(undefined, undefined, {
				submissionId: randomUUID(),
				instant: parseInstant(`${day}T16:00:00Z`),
				browserTimezone: "UTC",
			}),
		).resolves.toMatchObject({ success: true });
		const { rows } = await admin.query<{ id: string }>(
			`select id from work_period where employee_id = $1 and start_time = $2 and deleted_at is null`,
			[ids.requester, new Date(`${day}T08:00:00Z`)],
		);
		const workPeriodId = only(rows).id;
		await expect(
			requestTimeCorrection({
				workPeriodId,
				submissionId: randomUUID(),
				newClockInDate: day,
				newClockInTime: "07:30",
				newClockOutDate: day,
				newClockOutTime: "15:00",
				reason: "Started earlier",
				workLocationType: "office",
				workCategoryId: null,
			}),
		).resolves.toMatchObject({ success: true });
		actAs(null);
		const { rows: requests } = await admin.query<{
			id: string;
			approver_id: string;
			created_at: Date;
		}>(
			`select id, approver_id, created_at at time zone 'UTC' as created_at from approval_request
			 where organization_id = $1 and entity_type = 'time_entry' and entity_id = $2
			   and status = 'pending'`,
			[ids.organization, workPeriodId],
		);
		return { workPeriodId, request: only(requests) };
	}

	async function decideAs(userId: string, approvalId: string, action: "approve" | "reject") {
		actAs(userId);
		const url = `http://t1016.example.test/api/approvals/inbox/${approvalId}/${action}`;
		const context = { params: Promise.resolve({ id: approvalId }) };
		const response =
			action === "approve"
				? await approveRoute(new NextRequest(url, { method: "POST" }), context)
				: await rejectRoute(
						new NextRequest(url, {
							method: "POST",
							body: JSON.stringify({ reason: "Not this week" }),
							headers: { "content-type": "application/json" },
						}),
						context,
					);
		actAs(null);
		return { status: response.status, body: (await response.json()) as Record<string, unknown> };
	}

	async function inboxAs(userId: string) {
		actAs(userId);
		const response = await inboxRoute(
			new NextRequest("http://t1016.example.test/api/approvals/inbox?limit=50"),
		);
		actAs(null);
		expect(response.status).toBe(200);
		return (await response.json()) as {
			items: Array<{
				id: string;
				coveringFor?: { approverId: string; approverName: string };
				capabilities: Record<string, unknown>;
			}>;
			total: number;
			covering?: Array<{ approverId: string; approverName: string; count: number }>;
		};
	}

	async function detailAs(userId: string, approvalId: string) {
		actAs(userId);
		const response = await detailRoute(
			new NextRequest(`http://t1016.example.test/api/approvals/inbox/${approvalId}`),
			{ params: Promise.resolve({ id: approvalId }) },
		);
		actAs(null);
		return response;
	}

	async function deputyRecords() {
		const { rows } = await admin.query(
			`select deputy_employee_id, acting_for_employee_id, absence_id, authority, entity_type,
			   entity_id, approval_request_id, workflow_id is not null as has_workflow, decision
			 from approval_deputy_decision where organization_id = $1 order by decided_at`,
			[ids.organization],
		);
		return rows;
	}

	async function auditFor(approvalRequestId: string) {
		const { rows } = await admin.query<{ performed_by: string; action: string; metadata: string }>(
			`select performed_by, action, metadata from audit_log
			 where organization_id = $1 and entity_type = 'approval_request' and entity_id = $2
			   and action in ('approve', 'reject')`,
			[ids.organization, approvalRequestId],
		);
		return rows.map((row) => ({ ...row, metadata: row.metadata ? JSON.parse(row.metadata) : null }));
	}

	beforeEach(() => {
		actAs(null);
		harness.notifications.length = 0;
	});

	afterAll(async () => {
		await cleanup();
	});

	describe("canonical absence", () => {
		it("lists the absent approver's approval in a Covering-for section and lets the deputy approve it for them", async () => {
			await seed({ absence: "canonical" });
			const submitted = await submitAbsence();
			if (!submitted.workflow_id) throw new Error("Canonical submission has no workflow");

			const inbox = await inboxAs(ids.deputyUser);
			const item = only(inbox.items.filter((entry) => entry.id === submitted.id));
			expect(item.coveringFor).toEqual({
				approverId: ids.approver,
				approverName: "Xavier Approver",
			});
			expect(item.capabilities).toMatchObject({ canApprove: true, canReject: true });
			expect(inbox.covering).toEqual([
				{ approverId: ids.approver, approverName: "Xavier Approver", count: 1 },
			]);
			expect(inbox.total).toBe(1);
			expect((await detailAs(ids.deputyUser, submitted.id)).status).toBe(200);
			// Someone who neither covers nor manages sees nothing of X's.
			expect((await inboxAs(ids.otherUser)).items).toHaveLength(0);
			expect((await detailAs(ids.otherUser, submitted.id)).status).toBe(403);

			const decided = await decideAs(ids.deputyUser, submitted.id, "approve");
			expect(decided).toMatchObject({ status: 200, body: { success: true } });

			const { rows: assignments } = await admin.query(
				`select approver_employee_id, status, resolved_by_actor_id
				 from approval_stage_assignment where workflow_id = $1`,
				[submitted.workflow_id],
			);
			expect(only(assignments)).toMatchObject({
				approver_employee_id: ids.approver,
				status: "approved",
				resolved_by_actor_id: ids.deputy,
			});
			const { rows: events } = await admin.query<{
				actor_employee_id: string;
				metadata: Record<string, unknown>;
			}>(
				`select actor_employee_id, metadata from approval_workflow_event
				 where workflow_id = $1 and event_type = 'assignment.approved'`,
				[submitted.workflow_id],
			);
			expect(only(events)).toMatchObject({
				actor_employee_id: ids.deputy,
				metadata: expect.objectContaining({
					actingForEmployeeId: ids.approver,
					actingForAbsenceId: ids.coveringAbsence,
				}),
			});
			expect(await deputyRecords()).toEqual([
				{
					deputy_employee_id: ids.deputy,
					acting_for_employee_id: ids.approver,
					absence_id: ids.coveringAbsence,
					authority: "canonical",
					entity_type: "absence_entry",
					entity_id: submitted.absenceId,
					approval_request_id: submitted.id,
					has_workflow: true,
					decision: "approved",
				},
			]);
			expect(await auditFor(submitted.id)).toEqual([
				expect.objectContaining({
					performed_by: ids.deputyUser,
					action: "approve",
					metadata: expect.objectContaining({
						deputyDecision: true,
						actingForEmployeeId: ids.approver,
						actingForAbsenceId: ids.coveringAbsence,
					}),
				}),
			]);
			// After deciding, Y keeps read-only access; X's decision comes too late.
			expect((await detailAs(ids.deputyUser, submitted.id)).status).toBe(200);
			expect((await decideAs(ids.approverUser, submitted.id, "approve")).status).toBe(409);
		});

		it("refuses the deputy when the switch is off, after the absence, and for their own request", async () => {
			await seed({ absence: "canonical" });
			const submitted = await submitAbsence();

			await setDeputyDecisions(false);
			expect((await inboxAs(ids.deputyUser)).items).toHaveLength(0);
			expect((await decideAs(ids.deputyUser, submitted.id, "approve")).status).toBe(404);
			await setDeputyDecisions(true);

			await admin.query("update absence_entry set end_date = $2 where id = $1", [
				ids.coveringAbsence,
				utcDay(-1),
			]);
			expect((await decideAs(ids.deputyUser, submitted.id, "reject")).status).toBe(404);
			await admin.query("update absence_entry set start_date = $2, end_date = $3 where id = $1", [
				ids.coveringAbsence,
				utcDay(1),
				utcDay(3),
			]);
			expect((await decideAs(ids.deputyUser, submitted.id, "approve")).status).toBe(404);
			await admin.query("update absence_entry set start_date = $2, end_date = $3 where id = $1", [
				ids.coveringAbsence,
				utcDay(-2),
				utcDay(2),
			]);

			// Y's own request, assigned to X: read-only in the section, refused.
			const own = await submitAbsence(ids.deputyUser);
			const ownItem = only(
				(await inboxAs(ids.deputyUser)).items.filter((entry) => entry.id === own.id),
			);
			expect(ownItem.capabilities).toMatchObject({ canApprove: false, ownRequest: true });
			expect(await decideAs(ids.deputyUser, own.id, "approve")).toMatchObject({
				status: 403,
				body: { error: "You cannot decide your own request" },
			});

			// X can still decide during the absence.
			expect((await decideAs(ids.approverUser, submitted.id, "reject")).status).toBe(200);
			expect(await deputyRecords()).toEqual([]);
		});
	});

	describe("legacy time correction", () => {
		it("lets the covering deputy approve and reject for the absent approver, recording both people", async () => {
			await seed({ absence: "legacy" });
			const first = await submitTimeCorrection("2026-07-22");
			const second = await submitTimeCorrection("2026-07-23");
			expect(first.request.approver_id).toBe(ids.approver);

			const inbox = await inboxAs(ids.deputyUser);
			expect(inbox.items.map((entry) => entry.coveringFor?.approverId)).toEqual([
				ids.approver,
				ids.approver,
			]);
			expect(inbox.covering?.[0]?.count).toBe(2);

			expect(await decideAs(ids.deputyUser, first.request.id, "approve")).toMatchObject({
				status: 200,
			});
			expect(await decideAs(ids.deputyUser, second.request.id, "reject")).toMatchObject({
				status: 200,
			});

			const { rows: requests } = await admin.query(
				`select id, approver_id, status from approval_request where id = any($1::uuid[]) order by status`,
				[[first.request.id, second.request.id]],
			);
			expect(requests).toEqual([
				{ id: first.request.id, approver_id: ids.approver, status: "approved" },
				{ id: second.request.id, approver_id: ids.approver, status: "rejected" },
			]);
			expect(await deputyRecords()).toEqual([
				expect.objectContaining({
					deputy_employee_id: ids.deputy,
					acting_for_employee_id: ids.approver,
					absence_id: ids.coveringAbsence,
					authority: "legacy",
					entity_type: "time_entry",
					entity_id: first.workPeriodId,
					approval_request_id: first.request.id,
					decision: "approved",
				}),
				expect.objectContaining({
					authority: "legacy",
					approval_request_id: second.request.id,
					decision: "rejected",
				}),
			]);
			expect(await auditFor(first.request.id)).toEqual([
				expect.objectContaining({
					performed_by: ids.deputyUser,
					metadata: expect.objectContaining({
						deputyDecision: true,
						actingForEmployeeId: ids.approver,
					}),
				}),
			]);
			// Requester notifications name both people.
			const decisions = harness.notifications.filter((entry) =>
				["onTimeCorrectionApproved", "onTimeCorrectionRejected"].includes(entry.name),
			);
			expect(decisions.map((entry) => entry.params.approverName)).toEqual([
				"Yara Deputy (deputy for Xavier Approver)",
				"Yara Deputy (deputy for Xavier Approver)",
			]);
		});

		it("refuses the four-eyes case with a clear error and shows it without decisions", async () => {
			await seed({ absence: "legacy", twoStageChain: true });
			const submitted = await submitTimeCorrection("2026-07-24");
			// The first stage is Y's own: Y decides it as approver.
			expect(submitted.request.approver_id).toBe(ids.deputy);
			expect((await decideAs(ids.deputyUser, submitted.request.id, "approve")).status).toBe(200);
			const { rows } = await admin.query<{ id: string; approver_id: string }>(
				`select id, approver_id from approval_request
				 where organization_id = $1 and entity_id = $2 and status = 'pending'`,
				[ids.organization, submitted.workPeriodId],
			);
			const secondStage = only(rows);
			expect(secondStage.approver_id).toBe(ids.approver);

			const item = only(
				(await inboxAs(ids.deputyUser)).items.filter((entry) => entry.id === secondStage.id),
			);
			expect(item).toMatchObject({
				coveringFor: { approverId: ids.approver },
				capabilities: { canApprove: false, canReject: false, decidedEarlierStage: true },
			});
			expect(await decideAs(ids.deputyUser, secondStage.id, "approve")).toMatchObject({
				status: 403,
				body: {
					error:
						"You already decided an earlier stage of this request, so you cannot decide it as a deputy",
				},
			});
			expect(await deputyRecords()).toEqual([]);
		});

		it("ends the deputy right when escalation transfers the approval away from the absent approver", async () => {
			await seed({ absence: "legacy" });
			const submitted = await submitTimeCorrection("2026-07-25");
			const at = new Date(submitted.request.created_at.getTime() + 60 * 60_000);
			expect(
				await processDueEscalations({
					organizationId: ids.organization,
					now: parseInstant(at.toISOString()),
				}),
			).toMatchObject({ transferred: 1 });
			const { rows } = await admin.query<{ approver_id: string }>(
				"select approver_id from approval_request where id = $1",
				[submitted.request.id],
			);
			expect(only(rows).approver_id).toBe(ids.backup);

			expect((await inboxAs(ids.deputyUser)).items).toHaveLength(0);
			expect((await decideAs(ids.deputyUser, submitted.request.id, "approve")).status).toBe(404);
			expect(await deputyRecords()).toEqual([]);
		});
	});
});
