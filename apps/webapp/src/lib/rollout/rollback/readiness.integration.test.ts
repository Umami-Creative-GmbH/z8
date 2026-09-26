/**
 * #331 / T66 runtime evidence: the rollback readiness report, and the
 * compatible pauses it relies on keeping committed work intact.
 *
 * Local contract: pnpm --filter webapp test:approval-workflow-repository:integration
 * The runner creates, migrates, verifies, and removes a label-owned PostgreSQL 16 database.
 *
 * Real callers write everything the report reads about work, approvals and
 * durable follow-ups: `clockIn`/`clockOut` (legacy and adopted), the strict
 * version-2 `createManualTimeEntry` under a real change policy that requires
 * approval, `processDueEscalations`, the inbox approve route with the real
 * CASL abilities, `changeOrganizationTimezone` and
 * `processWorkBalanceRebuildIntents`. Controls are inserted and changed
 * directly, as the documented operator SQL does: production has no setter.
 * Only the request/session, billing, notification fan-out, the Next cache and
 * the delivery fast path are replaced.
 */

import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
	resolveApprovalWorkflowRepositoryTestConfiguration,
	verifyApprovalWorkflowRepositoryTestDatabase,
} from "@/lib/approvals/workflow/repository-integration-harness";
import { parseInstant } from "@/lib/datetime/temporal-core";

const harness = vi.hoisted(() => ({
	userId: null as string | null,
	organizationId: null as string | null,
}));

vi.mock("@/db", async () => {
	const { Pool } = await import("pg");
	const { drizzle } = await import("drizzle-orm/node-postgres");
	const authSchema = await import("@/db/auth-schema");
	const schema = await import("@/db/schema");
	const { configurePostgresUtcTypes, withUtcPostgresSession } = await import("@/db/postgres-utc");
	configurePostgresUtcTypes();
	const pool = new Pool(
		withUtcPostgresSession({
			connectionString:
				process.env.APPROVAL_WORKFLOW_REPOSITORY_TEST_DATABASE_URL ??
				"postgresql://unconfigured@127.0.0.1:1/unconfigured",
			max: 8,
		}),
	);
	const db = drizzle({ client: pool, schema: { ...authSchema, ...schema } });
	return { ...authSchema, ...schema, db, pool };
});

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

vi.mock("next/server", async (importOriginal) => ({
	...(await importOriginal<typeof import("next/server")>()),
	connection: async () => {},
}));

vi.mock("next/cache", async (importOriginal) => ({
	...(await importOriginal<typeof import("next/cache")>()),
	revalidatePath: vi.fn(),
	revalidateTag: vi.fn(),
}));

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
								id: `t331-session-${harness.userId}`,
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

vi.mock("@/lib/billing/guard", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/lib/billing/guard")>()),
	requireBillingForMutation: async () => ({ canAccess: true }),
	isBillingMutationAllowed: (access: { canAccess: boolean }) => access.canAccess,
}));

vi.mock("@/lib/app-url", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/lib/app-url")>()),
	getOrganizationBaseUrl: async () => "https://t331.example.test",
}));

vi.mock("@/lib/notifications/triggers", async (importOriginal) => {
	const original = await importOriginal<typeof import("@/lib/notifications/triggers")>();
	return Object.fromEntries(
		Object.entries(original).map(([name, value]) => [
			name,
			typeof value === "function" ? async () => undefined : value,
		]),
	);
});

vi.mock("@/app/[locale]/(app)/time-tracking/actions/approvals", async (importOriginal) => ({
	...(await importOriginal<
		typeof import("@/app/[locale]/(app)/time-tracking/actions/approvals")
	>()),
	sendManualEntryApprovalNotifications: async () => undefined,
	sendManualEntryApprovedNotification: async () => undefined,
}));

// The best-effort fast path only runs the owner sooner.
vi.mock("@/lib/approvals/delivery/kick", () => ({ kickApprovalDelivery: () => undefined }));

const { clockIn, clockOut } = await import("@/app/[locale]/(app)/time-tracking/actions/clocking");
const { createManualTimeEntry } = await import("@/app/[locale]/(app)/time-tracking/actions");
await import("@/lib/approvals/init");
const { POST: approveRoute } = await import("@/app/api/approvals/inbox/[id]/approve/route");
const { processDueEscalations } = await import("@/lib/approvals/escalation/transfer");
const { changeOrganizationTimezone } = await import("@/lib/timezone/organization-timezone-change");
const { processWorkBalanceRebuildIntents } = await import("@/lib/work-balance/rebuild-intents");
const { assessOrganizationTimePilotReadiness } = await import(
	"@/lib/time-tracking/pilot/readiness-reader"
);
const { assessOrganizationRollbackReadiness } = await import("./readiness-reader");

const databaseUrl = process.env.APPROVAL_WORKFLOW_REPOSITORY_TEST_DATABASE_URL;
const testSentinel = process.env.APPROVAL_WORKFLOW_REPOSITORY_TEST_SENTINEL;
const integrationRequired = process.env.APPROVAL_WORKFLOW_REPOSITORY_TEST_REQUIRED === "1";
const integrationConfiguration = resolveApprovalWorkflowRepositoryTestConfiguration({
	databaseUrl,
	required: integrationRequired,
	sentinel: testSentinel,
});
if (integrationConfiguration.status === "error") {
	throw new Error(
		`Invalid approval workflow repository test configuration: ${integrationConfiguration.reason}`,
	);
}
const describeIntegration =
	integrationConfiguration.status === "enabled" ? describe : describe.skip;
if (integrationConfiguration.status === "unavailable") {
	describe.skip(`rollback readiness PostgreSQL unavailable: ${integrationConfiguration.reason}`, () => {
		it("requires the label-owned disposable PostgreSQL runner", () => {});
	});
}

const ids = {
	organization: "t331-rollback-org",
	otherOrganization: "t331-other-org",
	ownerUser: "t331-owner-user",
	managerUser: "t331-manager-user",
	backupUser: "t331-backup-user",
	workerUser: "t331-worker-user",
	foreignUser: "t331-foreign-user",
	owner: "d3310000-0000-4000-8000-000000000001",
	manager: "d3310000-0000-4000-8000-000000000002",
	backup: "d3310000-0000-4000-8000-000000000003",
	worker: "d3310000-0000-4000-8000-000000000004",
	foreign: "d3310000-0000-4000-8000-000000000005",
	managerLink: "d3311000-0000-4000-8000-000000000001",
	backupLink: "d3311000-0000-4000-8000-000000000002",
	changePolicy: "d3312000-0000-4000-8000-000000000001",
	changePolicyAssignment: "d3312000-0000-4000-8000-000000000002",
} as const;
const users = [ids.ownerUser, ids.managerUser, ids.backupUser, ids.workerUser, ids.foreignUser];
const TIME_KINDS = ["manual_time_submission", "policy_clock_out", "time_correction"] as const;

/** Every table whose committed rows a rollback must preserve. */
const PRESERVED_TABLES = [
	"work_period",
	"time_entry",
	"completed_work_operation",
	"time_entry_append_position",
	"approval_request",
	"approval_submitted_revision",
	"approval_escalation_transfer",
	"approval_escalation_transfer_event",
] as const;

function only<T>(rows: readonly T[]): T {
	const [row] = rows;
	if (rows.length !== 1 || row === undefined) {
		throw new Error(`Expected exactly one row, received ${rows.length}`);
	}
	return row;
}

describeIntegration("rollback readiness on PostgreSQL", () => {
	vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
	const admin = new Pool({ connectionString: databaseUrl, max: 4 });

	function actAs(userId: string | null, organizationId: string = ids.organization) {
		harness.userId = userId;
		harness.organizationId = userId ? organizationId : null;
	}

	async function tableRows(tables: readonly string[]) {
		const snapshots: Record<string, unknown> = {};
		for (const table of tables) {
			const { rows } = await admin.query(
				`select coalesce(json_agg(row_to_json(t) order by row_to_json(t)::text), '[]') as rows
				 from ${table} t where organization_id = $1`,
				[ids.organization],
			);
			snapshots[table] = rows[0]?.rows;
		}
		return snapshots;
	}

	/** Every row the report reads, and the controls it could be suspected of touching. */
	const READ_TABLES = [
		...PRESERVED_TABLES,
		"time_entry_append_control",
		"approval_delivery_control",
		"approval_presentation_control",
		"approval_delivery_work",
		"approval_delivery_message",
		"approval_escalation_control",
		"work_balance_rebuild_intent",
		"work_break_adjustment_intent",
		"payroll_export_job",
		"import_staged_row",
	];

	async function readReport() {
		const before = await tableRows(READ_TABLES);
		const report = await assessOrganizationRollbackReadiness({ organizationId: ids.organization });
		// The report is a read: nothing it reads changes.
		expect(await tableRows(READ_TABLES)).toEqual(before);
		return report;
	}

	async function liveWork(start: string, end: string, submissionId: string = randomUUID()) {
		actAs(ids.workerUser);
		await expect(
			clockIn("office", { instant: parseInstant(start), browserTimezone: "Europe/Berlin" }),
		).resolves.toMatchObject({ success: true });
		const closed = await clockOut(undefined, undefined, {
			submissionId,
			instant: parseInstant(end),
			browserTimezone: "Europe/Berlin",
		});
		actAs(null);
		expect(closed).toMatchObject({ success: true });
		return submissionId;
	}

	/** The exclusive activation statement from docs/refs/time-pilot.md. */
	async function setAppendMode(mode: "active" | "inactive") {
		const client = await admin.connect();
		try {
			await client.query("begin");
			await client.query(
				`select pg_advisory_xact_lock(hashtextextended('["completed-work-adoption","' || $1::text || '"]', 0))`,
				[ids.organization],
			);
			await client.query(
				`insert into time_entry_append_control (organization_id, mode, updated_at)
				 values ($1, $2, clock_timestamp())
				 on conflict (organization_id) do update set mode = excluded.mode, updated_at = excluded.updated_at`,
				[ids.organization, mode],
			);
			await client.query("commit");
		} finally {
			client.release();
		}
	}

	/** A strict version-2 manual submission that the change policy routes to the manager. */
	async function submitManual(date: string) {
		actAs(ids.workerUser);
		const result = await createManualTimeEntry({
			version: 2,
			submissionId: randomUUID(),
			targetEmployeeId: ids.worker,
			date,
			clockIn: { time: "09:00", occurrence: null, displayedOffsetMinutes: 120 },
			clockOut: { time: "17:00", occurrence: null, displayedOffsetMinutes: 120 },
			zone: { basis: "target", timezone: "Europe/Berlin" },
			browserTimezone: "Europe/Berlin",
			reason: "Forgot to clock",
			projectId: null,
			workCategoryId: null,
		});
		actAs(null);
		expect(result).toMatchObject({ success: true, data: { requiresApproval: true } });
		const { rows } = await admin.query<{ id: string; created_at: Date; approver_id: string }>(
			`select id, created_at, approver_id from approval_request
			 where organization_id = $1 and entity_type = 'time_entry' and status = 'pending'
			 order by created_at desc limit 1`,
			[ids.organization],
		);
		return only(rows);
	}

	function escalateAt(from: Date, plusMinutes: number) {
		return processDueEscalations({
			organizationId: ids.organization,
			now: parseInstant(new Date(from.getTime() + plusMinutes * 60_000).toISOString()),
		});
	}

	async function approveAs(userId: string, approvalId: string) {
		actAs(userId);
		const url = `http://t331.example.test/api/approvals/inbox/${approvalId}/approve`;
		const response = await approveRoute(new NextRequest(url, { method: "POST" }), {
			params: Promise.resolve({ id: approvalId }),
		});
		actAs(null);
		return response.status;
	}

	async function cleanup() {
		await admin.query("delete from organization where id in ($1, $2)", [
			ids.organization,
			ids.otherOrganization,
		]);
		await admin.query('delete from "user" where id = any($1::text[])', [users]);
	}

	async function seed() {
		await cleanup();
		const timestamp = new Date("2026-07-01T00:00:00Z");
		await admin.query(
			`insert into organization (id, name, slug, timezone, created_at) values
			 ($1, 'T331 rollback', $1, 'Europe/Berlin', $3), ($2, 'T331 other', $2, 'UTC', $3)`,
			[ids.organization, ids.otherOrganization, timestamp],
		);
		await admin.query(
			`insert into "user" (id, name, email, created_at, updated_at)
			 select user_id, user_id, user_id || '@example.test', $2, $2 from unnest($1::text[]) as user_id`,
			[users, timestamp],
		);
		await admin.query(
			`insert into user_settings (user_id, locale, timezone, time_format, updated_at)
			 select user_id, 'en', 'Europe/Berlin', '24h', $2 from unnest($1::text[]) as user_id`,
			[users, timestamp],
		);
		await admin.query(
			`insert into member (id, organization_id, user_id, role, status, created_at) values
			 ('t331-m-owner', $1, $2, 'owner', 'approved', $7),
			 ('t331-m-manager', $1, $3, 'member', 'approved', $7),
			 ('t331-m-backup', $1, $4, 'member', 'approved', $7),
			 ('t331-m-worker', $1, $5, 'member', 'approved', $7),
			 ('t331-m-foreign', $6, $8, 'member', 'approved', $7)`,
			[
				ids.organization,
				ids.ownerUser,
				ids.managerUser,
				ids.backupUser,
				ids.workerUser,
				ids.otherOrganization,
				timestamp,
				ids.foreignUser,
			],
		);
		await admin.query(
			`insert into employee (id, user_id, organization_id, role, updated_at) values
			 ($1, $2, $11, 'admin', $12), ($3, $4, $11, 'manager', $12),
			 ($5, $6, $11, 'manager', $12), ($7, $8, $11, 'employee', $12),
			 ($9, $10, $13, 'employee', $12)`,
			[
				ids.owner,
				ids.ownerUser,
				ids.manager,
				ids.managerUser,
				ids.backup,
				ids.backupUser,
				ids.worker,
				ids.workerUser,
				ids.foreign,
				ids.foreignUser,
				ids.organization,
				timestamp,
				ids.otherOrganization,
			],
		);
		// Both are direct managers: the manager holds, the backup replaces.
		await admin.query(
			`insert into employee_managers
			 (id, employee_id, manager_id, is_primary, assigned_by, assigned_at, created_at) values
			 ($1, $3, $4, true, $6, $7, $7), ($2, $3, $5, false, $6, $7, $7)`,
			[
				ids.managerLink,
				ids.backupLink,
				ids.worker,
				ids.manager,
				ids.backup,
				ids.managerUser,
				timestamp,
			],
		);
		for (const kind of TIME_KINDS) {
			await admin.query(
				`insert into approval_workflow_rollout
				 (organization_id, workflow_type, lifecycle_mode, side_effect_mode, created_at, updated_at)
				 values ($1, $2, 'legacy', 'legacy', $3, $3)`,
				[ids.organization, kind, timestamp],
			);
			await admin.query(
				`insert into approval_evidence_control (organization_id, workflow_type, mode)
				 values ($1, $2, 'capture')`,
				[ids.organization, kind],
			);
		}
		await admin.query(
			`insert into change_policy
			 (id, organization_id, name, self_service_days, approval_days, created_by, updated_at)
			 values ($1, $2, 'T331 manual approval', 0, 3650, $3, $4)`,
			[ids.changePolicy, ids.organization, ids.managerUser, timestamp],
		);
		await admin.query(
			`insert into change_policy_assignment
			 (id, policy_id, organization_id, assignment_type, priority, created_by, updated_at)
			 values ($1, $2, $3, 'organization', 0, $4, $5)`,
			[ids.changePolicyAssignment, ids.changePolicy, ids.organization, ids.managerUser, timestamp],
		);
		// Another organization's controls and pending work never count here.
		await admin.query(
			`insert into work_balance_rebuild_intent (organization_id, reason, requested_at)
			 values ($1, 'organization_timezone', now())`,
			[ids.otherOrganization],
		);
		await admin.query(
			`insert into approval_delivery_control (organization_id, workflow_type, provider)
			 values ($1, 'absence', 'telegram')`,
			[ids.otherOrganization],
		);
		await admin.query(
			`insert into approval_escalation_control
			 (organization_id, owner, automation_paused, escalation_owned_since)
			 values ($1, 'escalation', false, now())`,
			[ids.otherOrganization],
		);
	}

	async function ownEscalation() {
		await admin.query(
			`insert into approval_escalation_control
			 (organization_id, owner, automation_paused, escalation_owned_since)
			 values ($1, 'escalation', false, '2026-07-01T00:00:00Z')`,
			[ids.organization],
		);
		await admin.query(
			`insert into approval_escalation_policy
			 (organization_id, enabled, response_window_hours, revision, migration_provenance)
			 values ($1, true, 1, 1, '{"source":"t331"}'::jsonb)`,
			[ids.organization],
		);
	}

	beforeAll(async () => {
		const enabled = await verifyApprovalWorkflowRepositoryTestDatabase({
			databaseUrl,
			required: integrationRequired,
			sentinel: testSentinel,
			currentDatabase: async () => {
				const result = await admin.query<{ database_name: string }>(
					"select current_database() as database_name",
				);
				return result.rows[0]?.database_name ?? "";
			},
		});
		if (enabled.status !== "enabled") throw new Error("Rollback readiness PostgreSQL is disabled");
	});

	beforeEach(async () => {
		actAs(null);
		await seed();
	});

	afterAll(async () => {
		await cleanup();
		await admin.end();
		const { pool } = (await import("@/db")) as unknown as { pool: Pool };
		await pool.end();
	});

	it("reports an organization that never adopted anything as ready, scoped to it alone", async () => {
		await liveWork("2026-07-06T06:00:00Z", "2026-07-06T14:00:00Z");

		const report = await readReport();

		expect(report).toMatchObject({
			organizationId: ids.organization,
			verdict: "ready",
			append: { mode: "inactive", positions: { total: 0 }, findings: [] },
			// The other organization's control, intent and escalation are not read.
			cards: { deliveryControls: [], findings: [] },
			escalation: { owner: null, findings: [] },
			durable: { rebuildIntents: { organization: 0, user: 0 }, findings: [] },
		});
		// Legacy clock-outs commit no receipt: nothing pins the schema.
		expect(report.schemaFloor).toEqual({ migration: null, pins: [] });
		await expect(
			assessOrganizationRollbackReadiness({ organizationId: "t331-missing-org" }),
		).rejects.toThrow("Unknown organization t331-missing-org");
	});

	it("blocks an adopted organization: append admission has no compatible pause", async () => {
		await setAppendMode("active");
		await liveWork("2026-07-06T06:00:00Z", "2026-07-06T14:00:00Z");

		const report = await readReport();

		expect(report.verdict).toBe("blocked");
		expect(report.append).toMatchObject({
			mode: "active",
			positions: { total: 1, empty_history: 1 },
			findings: [{ code: "append_pause_unavailable", severity: "blocker" }],
		});
		expect(report.append.activatedAt).toMatch(/^2\d{3}-/);
		expect(report.schemaFloor.pins).toContainEqual({
			migration: "0079_time_entry_append_position",
			subject: "append positions",
			rows: 1,
		});
	});

	it("returning append to inactive keeps positions and receipts but reopens legacy writers", async () => {
		await setAppendMode("active");
		const committed = await liveWork("2026-07-06T06:00:00Z", "2026-07-06T14:00:00Z");
		await liveWork("2026-07-07T06:00:00Z", "2026-07-07T14:00:00Z");
		const adopted = await tableRows(PRESERVED_TABLES);

		await setAppendMode("inactive");

		// A mode change removes nothing that was committed.
		expect(await tableRows(PRESERVED_TABLES)).toEqual(adopted);
		expect((await readReport()).append.findings).toEqual([
			{ code: "adopted_history_unfenced", severity: "blocker", count: 1 },
		]);
		// Committed receipts replay exactly in every mode, with nothing written.
		actAs(ids.workerUser);
		await expect(
			clockOut(undefined, undefined, {
				submissionId: committed,
				instant: parseInstant("2026-07-06T14:00:00Z"),
				browserTimezone: "Europe/Berlin",
			}),
		).resolves.toMatchObject({ success: true });
		actAs(null);
		expect(await tableRows(PRESERVED_TABLES)).toEqual(adopted);

		// The legacy writer is back: it commits work without a receipt and
		// without advancing the kept position.
		await liveWork("2026-07-08T06:00:00Z", "2026-07-08T14:00:00Z");
		const legacy = await tableRows(PRESERVED_TABLES);
		expect(legacy.completed_work_operation).toEqual(adopted.completed_work_operation);
		expect(legacy.time_entry_append_position).toEqual(adopted.time_entry_append_position);
		expect(legacy.work_period).toHaveLength((adopted.work_period as unknown[]).length + 1);
		await setAppendMode("active");
		const pilot = await assessOrganizationTimePilotReadiness({ organizationId: ids.organization });
		expect(pilot.adoption.employees.continuityInterrupted).toBe(1);
		expect(pilot.adoption.findings).toContainEqual({
			code: "continuity_interrupted",
			severity: "blocker",
			count: 1,
		});
	});

	it("pausing cards and escalation clears their holds and keeps every committed row", async () => {
		await setAppendMode("active");
		await ownEscalation();
		await liveWork("2026-07-06T06:00:00Z", "2026-07-06T14:00:00Z");
		await admin.query(
			`insert into approval_delivery_control (organization_id, workflow_type, provider)
			 values ($1, 'absence', 'telegram'), ($1, 'absence', 'slack')`,
			[ids.organization],
		);
		await admin.query(
			`insert into approval_presentation_control (organization_id, workflow_type, provider, mode)
			 values ($1, 'absence', 'telegram', 'actionable'), ($1, 'absence', 'slack', 'review_only')`,
			[ids.organization],
		);

		const before = await readReport();
		expect(before.cards).toMatchObject({
			actionable: [{ workflowType: "absence", provider: "telegram" }],
			findings: [
				{ code: "delivery_pause_gap", severity: "hold", count: 2 },
				{ code: "presentation_actionable", severity: "hold", count: 1 },
			],
		});
		expect(before.escalation.findings).toEqual([
			{ code: "escalation_automation_running", severity: "hold" },
		]);
		const committed = await tableRows(PRESERVED_TABLES);

		// The documented pauses (docs/refs/approval-pilot.md, "Pause and rollback").
		await admin.query(
			`update approval_presentation_control set mode = 'review_only' where organization_id = $1`,
			[ids.organization],
		);
		await admin.query("delete from approval_delivery_control where organization_id = $1", [
			ids.organization,
		]);
		await admin.query(
			"update approval_escalation_control set automation_paused = true where organization_id = $1",
			[ids.organization],
		);

		const after = await readReport();
		expect(after.cards).toMatchObject({ verdict: "ready", findings: [] });
		expect(after.escalation).toMatchObject({ automationPaused: true, findings: [] });
		// Only append adoption still blocks, and the pinned rows are unchanged.
		expect(after.verdict).toBe("blocked");
		expect(after.schemaFloor).toEqual(before.schemaFloor);
		expect(await tableRows(PRESERVED_TABLES)).toEqual(committed);
	});

	it("blocks on a transferred time approval until its replacement decides it; pausing keeps the transfer", async () => {
		await setAppendMode("active");
		await ownEscalation();
		const request = await submitManual("2026-07-20");
		expect(request.approver_id).toBe(ids.manager);
		expect(await escalateAt(request.created_at, 60)).toMatchObject({ transferred: 1 });

		const transferred = await readReport();
		expect(transferred.escalation).toMatchObject({
			verdict: "blocked",
			pendingTransferred: [
				{ authorityMode: "legacy", workflowType: "manual_time_submission", count: 1 },
			],
			findings: [
				{ code: "escalation_automation_running", severity: "hold" },
				{ code: "transferred_approvals_pending", severity: "blocker", count: 1 },
			],
		});

		// Pausing stops new transfers only: the committed one and its request stay.
		await admin.query(
			"update approval_escalation_control set automation_paused = true where organization_id = $1",
			[ids.organization],
		);
		const second = await submitManual("2026-07-21");
		const journal = await tableRows(["approval_escalation_transfer"]);
		expect(await escalateAt(second.created_at, 120)).toMatchObject({ transferred: 0 });
		expect(await tableRows(["approval_escalation_transfer"])).toEqual(journal);
		expect((await readReport()).escalation.findings).toEqual([
			{ code: "transferred_approvals_pending", severity: "blocker", count: 1 },
		]);

		// The replacement decides it; the former holder no longer could.
		expect(await approveAs(ids.managerUser, request.id)).not.toBe(200);
		expect(await approveAs(ids.backupUser, request.id)).toBe(200);
		expect((await readReport()).escalation).toMatchObject({ verdict: "ready", findings: [] });
	});

	it("blocks on a pending rebuild intent from a real timezone change until it is processed", async () => {
		await setAppendMode("active");
		await liveWork("2026-07-06T06:00:00Z", "2026-07-06T14:00:00Z");
		await expect(
			changeOrganizationTimezone({
				organizationId: ids.organization,
				actorUserId: ids.ownerUser,
				timezone: "Europe/Lisbon",
			}),
		).resolves.toEqual({ status: "changed", rebuild: "intent" });

		const pending = await readReport();
		expect(pending.durable).toMatchObject({
			rebuildIntents: { organization: 1, user: 0 },
			verdict: "blocked",
			findings: [{ code: "rebuild_intents_pending", severity: "blocker", count: 1 }],
		});
		expect(pending.schemaFloor.pins).toContainEqual({
			migration: "0099_work_balance_rebuild_intent",
			subject: "organization rebuild intents",
			rows: 1,
		});

		// The drain before a code rollback: the real consumer processes the intent.
		await processWorkBalanceRebuildIntents({ organizationId: ids.organization });
		const drained = await readReport();
		expect(drained.durable).toMatchObject({ verdict: "ready", findings: [] });
		expect(drained.schemaFloor.pins.map((pin) => pin.subject)).not.toContain(
			"organization rebuild intents",
		);
		// The other organization's intent is untouched by this organization's drain.
		const { rows } = await admin.query<{ count: number }>(
			"select count(*)::int as count from work_balance_rebuild_intent where organization_id = $1",
			[ids.otherOrganization],
		);
		expect(only(rows).count).toBe(1);
	});
});
