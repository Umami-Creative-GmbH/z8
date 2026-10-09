/**
 * #900 runtime evidence: billable work across the work writers.
 *
 * Local contract: pnpm --filter webapp test:integration
 *
 * The real web clock-in/out, break, manual entry, split and project-change actions
 * and the real reviewed-import worker run against PostgreSQL in both admissions
 * (legacy and adopted append). After every writer the legacy period and its
 * canonical record must agree on project and billability. Only the request/session,
 * billing provisioning, notification delivery, the import queue and the Next cache
 * boundaries are replaced; the authoritative clock is pinned.
 */

import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { type Instant, parseInstant } from "@/lib/datetime/temporal-core";
import type { ManualTimeEntryCommand } from "@/lib/time-tracking/manual-command";
import { integrationAdminPool } from "@/test/integration-database";

const harness = vi.hoisted(() => ({
	userId: null as string | null,
	organizationId: null as string | null,
	now: null as Instant | null,
}));

vi.mock("@/lib/datetime/temporal-core", async (importOriginal) => {
	const original = await importOriginal<typeof import("@/lib/datetime/temporal-core")>();
	return {
		...original,
		systemClock: Object.freeze({
			nowInstant: () => harness.now ?? original.systemClock.nowInstant(),
		}),
	};
});

// getRequestSession awaits connection(), which throws outside a Next request scope.
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
							user: { id: harness.userId, role: "user" },
							session: {
								id: `t900-session-${harness.userId}`,
								userId: harness.userId,
								activeOrganizationId: harness.organizationId,
							},
						}
					: null,
		},
	},
}));

vi.mock("@/lib/auth-helpers", async (importOriginal) => {
	const original = await importOriginal<typeof import("@/lib/auth-helpers")>();
	const { db } = await import("@/db");
	const { loadOrganizationPrincipalContext } = await import("@/lib/authorization/principal-loader");
	return {
		...original,
		// The real loader on the test database, without Better Auth's session store.
		getPrincipalContext: async () =>
			harness.userId && harness.organizationId
				? loadOrganizationPrincipalContext(db, {
						userId: harness.userId,
						organizationId: harness.organizationId,
					})
				: null,
	};
});

vi.mock("@/lib/billing/guard", async () =>
	(await import("@/test/integration-harness")).billingGuard(),
);

vi.mock("@/lib/notifications/triggers", async (importOriginal) =>
	(await import("@/test/integration-harness")).notificationTriggers(importOriginal),
);

vi.mock("./approvals", async (importOriginal) => ({
	...(await importOriginal<typeof import("./approvals")>()),
	sendManualEntryApprovalNotifications: async () => undefined,
	sendManualEntryApprovedNotification: async () => undefined,
}));

vi.mock("@/lib/import-review/queue", () => ({
	enqueueImportCommitJob: async () => {},
	enqueueImportScanJob: async () => {},
}));

const { clockIn, clockOut, addBreakToActiveSession } = await import("./clocking");
const { createManualTimeEntry, splitWorkPeriod, updateWorkPeriodProject } = await import(
	"../actions"
);
const { processImportReviewJob } = await import("@/lib/import-review/worker");
const { POST: diagnosticsRoute } = await import("@/app/api/time-entries/diagnostics/route");
const { reconcileLegacyToCanonical } = await import("@/lib/time-record/migration/reconciliation");
const { runCanonicalBackfill } = await import("@/lib/time-record/migration/backfill");

const ids = {
	organization: "t900-billable-org",
	employeeUser: "t900-employee-user",
	ownerUser: "t900-owner-user",
	employee: "e9000000-0000-4000-8000-000000000001",
	owner: "e9000000-0000-4000-8000-000000000002",
	customer: "e9000000-0000-4000-8000-000000000010",
	/** A customer's project whose billable default is on. */
	billableProject: "e9000000-0000-4000-8000-000000000021",
	/** A customer's project whose billable default is off. */
	customerProject: "e9000000-0000-4000-8000-000000000022",
	/** An internal project without a customer. */
	internalProject: "e9000000-0000-4000-8000-000000000023",
} as const;
const users = [ids.employeeUser, ids.ownerUser];
const now = parseInstant("2026-07-22T18:00:00Z");
const workStart = parseInstant("2026-07-22T08:00:00Z");
const workEnd = parseInstant("2026-07-22T12:00:00Z");

function only<T>(rows: readonly T[]): T {
	const [row] = rows;
	if (rows.length !== 1 || row === undefined) {
		throw new Error(`Expected exactly one row, received ${rows.length}`);
	}
	return row;
}

type Attribution = {
	id: string;
	project_id: string | null;
	is_billable: boolean;
	is_active: boolean;
	canonical_record_id: string | null;
	allocations: { projectId: string; isBillable: boolean }[] | null;
};

describe("billable work across the work writers on PostgreSQL", () => {
	vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
	const admin = integrationAdminPool();

	function actAs(userId: string = ids.employeeUser) {
		harness.userId = userId;
		harness.organizationId = ids.organization;
	}

	async function setAdmission(mode: "active" | "inactive") {
		await admin.query(
			`insert into time_entry_append_control (organization_id, mode) values ($1, $2)
			 on conflict (organization_id) do update set mode = excluded.mode, updated_at = now()`,
			[ids.organization, mode],
		);
	}

	/** Every period with its canonical project allocations, oldest first. */
	async function attributions(): Promise<Attribution[]> {
		const { rows } = await admin.query<Attribution>(
			`select wp.id, wp.project_id, wp.is_billable, wp.is_active, wp.canonical_record_id,
			        (select json_agg(json_build_object('projectId', a.project_id, 'isBillable', a.is_billable)
			                         order by a.id)
			           from time_record_allocation a
			          where a.record_id = wp.canonical_record_id and a.allocation_kind = 'project') as allocations
			   from work_period wp
			  where wp.organization_id = $1 and wp.deleted_at is null
			  order by wp.start_time, wp.created_at`,
			[ids.organization],
		);
		return rows;
	}

	async function attributionOf(periodId: string) {
		const row = (await attributions()).find((period) => period.id === periodId);
		if (!row) throw new Error(`Work period ${periodId} missing`);
		return row;
	}

	/**
	 * The period records the expected project and billability, and its canonical
	 * record (when it has one) carries exactly the same project and billability.
	 */
	function expectAgreement(
		period: Attribution,
		expected: { projectId: string | null; billable: boolean },
		options: { canonical: boolean } = { canonical: true },
	) {
		expect({ projectId: period.project_id, billable: period.is_billable }).toEqual(expected);
		if (!options.canonical) return;
		expect(period.canonical_record_id).not.toBeNull();
		expect(period.allocations ?? []).toEqual(
			expected.projectId ? [{ projectId: expected.projectId, isBillable: expected.billable }] : [],
		);
	}

	/** Every work row, to prove a refused write left nothing behind. */
	async function snapshot() {
		const { rows } = await admin.query(
			`select
			   (select json_agg(row_to_json(t) order by t.id) from work_period t where organization_id = $1) as periods,
			   (select json_agg(row_to_json(t) order by t.id) from time_entry t where organization_id = $1) as entries,
			   (select json_agg(row_to_json(t) order by t.id) from time_record t where organization_id = $1) as records,
			   (select json_agg(row_to_json(t) order by t.id) from time_record_allocation t where organization_id = $1) as allocations,
			   (select json_agg(row_to_json(t) order by t.id) from completed_work_operation t where organization_id = $1) as receipts`,
			[ids.organization],
		);
		return only(rows);
	}

	async function startWork(start: Instant = workStart) {
		actAs();
		await expect(
			clockIn("office", { instant: start, browserTimezone: "UTC" }),
		).resolves.toMatchObject({ success: true });
		const { rows } = await admin.query<{ id: string }>(
			"select id from work_period where employee_id = $1 and end_time is null and deleted_at is null",
			[ids.employee],
		);
		return only(rows).id;
	}

	function endWork(
		projectId: string | null | undefined,
		options: { billable?: boolean; end?: Instant } = {},
	) {
		actAs();
		return clockOut(projectId, undefined, {
			submissionId: randomUUID(),
			instant: options.end ?? workEnd,
			browserTimezone: "UTC",
			...(options.billable === undefined ? {} : { billable: options.billable }),
		});
	}

	/** Real clock-in and clock-out; returns the closed period. */
	async function recordWork(
		projectId: string | null | undefined,
		options: { billable?: boolean; start?: Instant; end?: Instant } = {},
	) {
		const periodId = await startWork(options.start);
		await expect(endWork(projectId, options)).resolves.toMatchObject({ success: true });
		return attributionOf(periodId);
	}

	function manualCommand(overrides: Partial<ManualTimeEntryCommand> = {}): ManualTimeEntryCommand {
		return {
			version: 2,
			submissionId: randomUUID(),
			targetEmployeeId: ids.employee,
			date: "2026-07-21",
			clockIn: { time: "08:00", occurrence: null, displayedOffsetMinutes: 0 },
			clockOut: { time: "10:00", occurrence: null, displayedOffsetMinutes: 0 },
			zone: { basis: "target", timezone: "UTC" },
			browserTimezone: "UTC",
			reason: "Forgot to clock in",
			projectId: null,
			workCategoryId: null,
			...overrides,
		};
	}

	/**
	 * A manual entry in either representation: a version-2 command in adopted
	 * organizations, the legacy form input otherwise.
	 */
	function recordManual(
		admission: "legacy" | "append",
		input: { projectId: string | null; billable?: boolean },
	) {
		actAs();
		const billable = input.billable === undefined ? {} : { billable: input.billable };
		if (admission === "append") {
			return createManualTimeEntry(
				manualCommand({ projectId: input.projectId, ...billable }) as never,
			);
		}
		return createManualTimeEntry({
			submissionId: randomUUID(),
			date: "2026-07-21",
			clockInTime: "08:00",
			clockOutTime: "10:00",
			reason: "Forgot to clock in",
			timezone: "UTC",
			browserTimezone: "UTC",
			...(input.projectId ? { projectId: input.projectId } : {}),
			...billable,
		});
	}

	async function cleanup() {
		// Deleting the organization cascades through billable work (project set null
		// against the billable CHECKs), which the next seed relies on.
		await admin.query("delete from organization where id = $1", [ids.organization]);
		await admin.query('delete from "user" where id = any($1::text[])', [users]);
	}

	async function seed() {
		await cleanup();
		const timestamp = new Date("2026-07-01T00:00:00Z");
		await admin.query(
			`insert into organization (id, name, slug, timezone, projects_enabled, created_at)
			 values ($1, 'T900 billable', $1, 'UTC', true, $2)`,
			[ids.organization, timestamp],
		);
		await admin.query(
			`insert into approval_workflow_rollout
			 (organization_id, workflow_type, lifecycle_mode, side_effect_mode, created_at, updated_at)
			 values ($1, 'policy_clock_out', 'legacy', 'legacy', $2, $2),
			        ($1, 'manual_time_submission', 'legacy', 'legacy', $2, $2)`,
			[ids.organization, timestamp],
		);
		await admin.query(
			`insert into "user" (id, name, email, created_at, updated_at)
			 select user_id, user_id, user_id || '@example.test', $2, $2 from unnest($1::text[]) as user_id`,
			[users, timestamp],
		);
		await admin.query(
			`insert into member (id, organization_id, user_id, role, status, created_at) values
			 ('t900-m-employee', $1, $2, 'member', 'approved', $4),
			 ('t900-m-owner', $1, $3, 'owner', 'approved', $4)`,
			[ids.organization, ids.employeeUser, ids.ownerUser, timestamp],
		);
		await admin.query(
			`insert into employee (id, user_id, organization_id, role, updated_at) values
			 ($1, $2, $5, 'employee', $6), ($3, $4, $5, 'admin', $6)`,
			[ids.employee, ids.employeeUser, ids.owner, ids.ownerUser, ids.organization, timestamp],
		);
		await admin.query(
			`insert into user_settings (user_id, timezone, updated_at)
			 select user_id, 'UTC', $2 from unnest($1::text[]) as user_id`,
			[users, timestamp],
		);
		await admin.query(
			`insert into customer (id, organization_id, name, created_by, updated_at)
			 values ($1, $2, 'Acme', $3, $4)`,
			[ids.customer, ids.organization, ids.ownerUser, timestamp],
		);
		await admin.query(
			`insert into project (id, organization_id, name, status, is_active, customer_id, billable_default, created_by, updated_at) values
			 ($1, $4, 'Billable by default', 'active', true, $5, true, $6, $7),
			 ($2, $4, 'Customer project', 'active', true, $5, false, $6, $7),
			 ($3, $4, 'Internal', 'active', true, null, false, $6, $7)`,
			[
				ids.billableProject,
				ids.customerProject,
				ids.internalProject,
				ids.organization,
				ids.customer,
				ids.ownerUser,
				timestamp,
			],
		);
		await admin.query(
			`insert into project_assignment (id, project_id, organization_id, assignment_type, employee_id, created_by)
			 select gen_random_uuid(), project_id, $2, 'employee', $3, $4 from unnest($1::uuid[]) as project_id`,
			[
				[ids.billableProject, ids.customerProject, ids.internalProject],
				ids.organization,
				ids.employee,
				ids.ownerUser,
			],
		);
	}

	beforeEach(async () => {
		harness.now = now;
		await seed();
	});

	afterAll(async () => {
		await cleanup();
	});

	describe.each([
		["legacy", "inactive"],
		["append", "active"],
	] as const)("%s admission", (admission, mode) => {
		beforeEach(async () => {
			await setAdmission(mode);
		});

		describe("clock-out", () => {
			it("records work on a project whose billable default is on as billable", async () => {
				const period = await recordWork(ids.billableProject);
				expectAgreement(period, { projectId: ids.billableProject, billable: true });
			});

			it("records work on a project whose billable default is off as non-billable", async () => {
				const period = await recordWork(ids.customerProject);
				expectAgreement(period, { projectId: ids.customerProject, billable: false });
			});

			it("lets an explicit billable choice override the project default", async () => {
				const off = await recordWork(ids.billableProject, { billable: false });
				expectAgreement(off, { projectId: ids.billableProject, billable: false });
				const on = await recordWork(ids.customerProject, {
					billable: true,
					start: parseInstant("2026-07-22T13:00:00Z"),
					end: parseInstant("2026-07-22T14:00:00Z"),
				});
				expectAgreement(on, { projectId: ids.customerProject, billable: true });
			});

			it("never records work without a project as billable", async () => {
				const period = await recordWork(null);
				expectAgreement(period, { projectId: null, billable: false });
			});

			it.each([
				["a project without a customer", ids.internalProject],
				["no project", null],
			])("refuses billable work on %s and writes nothing", async (_label, projectId) => {
				const periodId = await startWork();
				const before = await snapshot();

				const result = await endWork(projectId, { billable: true });

				expect(result).toMatchObject({ success: false });
				expect(await snapshot()).toEqual(before);
				expect((await attributionOf(periodId)).is_active).toBe(true);
			});
		});

		describe("manual entry", () => {
			it("records manual work with the project's billable default", async () => {
				await expect(
					recordManual(admission, { projectId: ids.billableProject }),
				).resolves.toMatchObject({ success: true });
				expectAgreement(only(await attributions()), {
					projectId: ids.billableProject,
					billable: true,
				});
			});

			it("lets an explicit billable choice override the project default", async () => {
				await expect(
					recordManual(admission, { projectId: ids.customerProject, billable: true }),
				).resolves.toMatchObject({ success: true });
				expectAgreement(only(await attributions()), {
					projectId: ids.customerProject,
					billable: true,
				});
			});

			it("refuses billable manual work on a project without a customer", async () => {
				const before = await snapshot();
				await expect(
					recordManual(admission, { projectId: ids.internalProject, billable: true }),
				).resolves.toMatchObject({ success: false });
				expect(await snapshot()).toEqual(before);
			});
		});

		describe("project change", () => {
			it("re-applies the new project's billable default", async () => {
				const period = await recordWork(ids.customerProject);
				expect(period.is_billable).toBe(false);

				actAs();
				await expect(
					updateWorkPeriodProject(period.id, ids.billableProject),
				).resolves.toMatchObject({ success: true });
				expectAgreement(await attributionOf(period.id), {
					projectId: ids.billableProject,
					billable: true,
				});

				await expect(
					updateWorkPeriodProject(period.id, ids.internalProject),
				).resolves.toMatchObject({ success: true });
				expectAgreement(await attributionOf(period.id), {
					projectId: ids.internalProject,
					billable: false,
				});

				await expect(updateWorkPeriodProject(period.id, null)).resolves.toMatchObject({
					success: true,
				});
				expectAgreement(await attributionOf(period.id), { projectId: null, billable: false });
			});

			it("keeps an explicit billability while the project stays", async () => {
				// Explicitly non-billable work on a billable-by-default project.
				const period = await recordWork(ids.billableProject, { billable: false });

				actAs();
				await expect(
					updateWorkPeriodProject(period.id, ids.billableProject),
				).resolves.toMatchObject({ success: admission === "legacy" });
				expectAgreement(await attributionOf(period.id), {
					projectId: ids.billableProject,
					billable: false,
				});
			});

			it("applies the default when the project is chosen on live work, and the closure keeps it", async () => {
				const periodId = await startWork();
				actAs();
				await expect(
					updateWorkPeriodProject(periodId, ids.billableProject),
				).resolves.toMatchObject({ success: true });
				const live = await attributionOf(periodId);
				expect({ projectId: live.project_id, billable: live.is_billable }).toEqual({
					projectId: ids.billableProject,
					billable: true,
				});

				// The clock-out preserves the live work's project and billability.
				await expect(endWork(undefined)).resolves.toMatchObject({ success: true });
				expectAgreement(await attributionOf(periodId), {
					projectId: ids.billableProject,
					billable: true,
				});
			});
		});

		it("keeps billability through a break", async () => {
			const periodId = await startWork();
			actAs();
			await expect(
				updateWorkPeriodProject(periodId, ids.billableProject),
			).resolves.toMatchObject({ success: true });
			harness.now = parseInstant("2026-07-22T10:00:00Z");

			await expect(
				addBreakToActiveSession(30, { submissionId: randomUUID(), browserTimezone: "UTC" }),
			).resolves.toMatchObject({ success: true });

			const [closed, resumed] = await attributions();
			if (!closed || !resumed) throw new Error("Break did not split the work");
			expectAgreement(closed, { projectId: ids.billableProject, billable: true });
			// Adopted breaks carry the work's attribution to the resumed work (#304);
			// the established legacy break resumes without a project.
			expect({ projectId: resumed.project_id, billable: resumed.is_billable }).toEqual(
				admission === "append"
					? { projectId: ids.billableProject, billable: true }
					: { projectId: null, billable: false },
			);
		});

		it("keeps the source's billability on both halves of a split", async () => {
			const period = await recordWork(ids.billableProject);
			actAs();

			await expect(
				splitWorkPeriod(
					period.id,
					"2026-07-22",
					"10:00",
					undefined,
					undefined,
					undefined,
					randomUUID(),
				),
			).resolves.toMatchObject({ success: true });

			const [first, second] = await attributions();
			if (!first || !second) throw new Error("Split did not produce two periods");
			expectAgreement(first, { projectId: ids.billableProject, billable: true });
			// The established legacy split writes no canonical rows for the second half.
			expectAgreement(
				second,
				{ projectId: ids.billableProject, billable: true },
				{ canonical: admission === "append" },
			);
		});

		it("never changes existing work when the project's billable default changes", async () => {
			const billable = await recordWork(ids.billableProject);
			await admin.query("update project set billable_default = false where id = $1", [
				ids.billableProject,
			]);

			expectAgreement(await attributionOf(billable.id), {
				projectId: ids.billableProject,
				billable: true,
			});
			const later = await recordWork(ids.billableProject, {
				start: parseInstant("2026-07-22T13:00:00Z"),
				end: parseInstant("2026-07-22T14:00:00Z"),
			});
			expectAgreement(later, { projectId: ids.billableProject, billable: false });
		});

		describe("reviewed import", () => {
			async function importRow(attribution: unknown) {
				const batchId = randomUUID();
				const jobId = randomUUID();
				await admin.query(
					`insert into import_batch
					 (id, organization_id, provider, status, selected_scope, date_range, started_by, committed_by, created_at, updated_at)
					 values ($1, $2, 'clockodo', 'committing', '{}', '{"startDate":"2026-01-01","endDate":"2026-12-31"}', $3, $3, now(), now())`,
					[batchId, ids.organization, ids.ownerUser],
				);
				await admin.query(
					`insert into import_batch_job
					 (id, batch_id, organization_id, kind, status, entity_type, partition_key, created_at, updated_at)
					 values ($1, $2, $3, 'commit', 'queued', 'work_period', 'work_period', now(), now())`,
					[jobId, batchId, ids.organization],
				);
				const rowId = randomUUID();
				const sourcePayload = { id: rowId };
				await admin.query(
					`insert into import_staged_row
					 (id, batch_id, organization_id, entity_type, provider_source_id, source_payload_hash,
					  source_payload, normalized_payload, row_status, issue_severity, created_at, updated_at)
					 values ($1, $2, $3, 'work_period', $4, $5, $6, $7, 'accepted', 'none', now(), now())`,
					[
						rowId,
						batchId,
						ids.organization,
						rowId,
						createHash("sha256").update(JSON.stringify(sourcePayload)).digest("hex"),
						sourcePayload,
						{
							employeeId: ids.employee,
							startsAt: "2026-07-20T08:00:00Z",
							endsAt: "2026-07-20T10:00:00Z",
							...(attribution === undefined ? {} : { attribution }),
						},
					],
				);
				// A held row fails the job's final attempt; the row keeps its hold.
				await processImportReviewJob({
					data: {
						type: "import-review-commit",
						batchId,
						jobId,
						organizationId: ids.organization,
						entityType: "work_period",
						committedBy: ids.ownerUser,
					},
					opts: { attempts: 3 },
					attemptsMade: 2,
				} as never).catch(() => undefined);
				const { rows } = await admin.query<{
					row_status: string;
					commit_hold: { reason?: string; detail?: string } | null;
				}>("select row_status, commit_hold from import_staged_row where id = $1", [rowId]);
				return only(rows);
			}

			it("commits rows staged without attribution with no project, as before", async () => {
				await expect(importRow(undefined)).resolves.toMatchObject({ row_status: "committed" });
				expectAgreement(
					only(await attributions()),
					{ projectId: null, billable: false },
					{ canonical: admission === "append" },
				);
			});

			it("records an imported project with its billable default", async () => {
				await expect(importRow({ projectId: ids.billableProject })).resolves.toMatchObject({
					row_status: "committed",
				});
				expectAgreement(
					only(await attributions()),
					{ projectId: ids.billableProject, billable: true },
					{ canonical: admission === "append" },
				);
			});

			it("records an imported billability over the project default", async () => {
				await expect(
					importRow({ projectId: ids.customerProject, billable: true }),
				).resolves.toMatchObject({ row_status: "committed" });
				expectAgreement(
					only(await attributions()),
					{ projectId: ids.customerProject, billable: true },
					{ canonical: admission === "append" },
				);
			});

			it("holds billable imported work on a project without a customer", async () => {
				await expect(
					importRow({ projectId: ids.internalProject, billable: true }),
				).resolves.toMatchObject({
					row_status: "blocked",
					commit_hold: { reason: "attribution_not_allowed", detail: "no_customer" },
				});
				expect(await attributions()).toEqual([]);
			});
		});
	});

	describe("legacy/canonical agreement checks", () => {
		/** Makes the canonical record disagree with its period on billability only. */
		async function divergeBillability(period: Attribution) {
			await admin.query(
				"update time_record_allocation set is_billable = not is_billable where record_id = $1",
				[period.canonical_record_id],
			);
		}

		async function diagnose() {
			actAs(ids.ownerUser);
			const response = await diagnosticsRoute(
				new Request("http://localhost/api/time-entries/diagnostics", {
					method: "POST",
					body: JSON.stringify({
						employeeId: ids.employee,
						startDate: "2026-07-01",
						endDate: "2026-07-31",
					}),
				}) as never,
			);
			expect(response.status).toBe(200);
			return (await response.json()).work.findings as {
				kind: string;
				shape: string;
				workPeriodIds: string[];
				details: Record<string, unknown>;
			}[];
		}

		it("holds adopted work whose canonical record disagrees only on billability for review", async () => {
			await setAdmission("active");
			const period = await recordWork(ids.billableProject);
			await divergeBillability(period);
			const before = await snapshot();

			actAs();
			await expect(
				updateWorkPeriodProject(period.id, ids.customerProject),
			).resolves.toMatchObject({ success: false });
			await expect(
				splitWorkPeriod(period.id, "2026-07-22", "10:00", undefined, undefined, undefined, randomUUID()),
			).resolves.toMatchObject({ success: false });
			expect(await snapshot()).toEqual(before);
		});

		it.each([
			["legacy", "inactive"],
			["append", "active"],
		] as const)("reports a %s billability divergence in diagnostics and reconciliation", async (_admission, mode) => {
			await setAdmission(mode);
			const period = await recordWork(ids.billableProject);
			expect(await diagnose()).toEqual([]);
			expect((await reconcileLegacyToCanonical(ids.organization)).missingProjectAllocationRows).toBe(0);

			await divergeBillability(period);

			expect(await diagnose()).toContainEqual(
				expect.objectContaining({
					kind: "metadata_conflict",
					shape: "conflicting",
					workPeriodIds: [period.id],
					details: { field: "billable", periodValue: true, canonicalValue: false },
				}),
			);
			expect((await reconcileLegacyToCanonical(ids.organization)).missingProjectAllocationRows).toBe(1);
		});

		it("backfills a billable legacy period's canonical record with its billability", async () => {
			await setAdmission("inactive");
			const period = await recordWork(ids.billableProject);
			await admin.query("update work_period set canonical_record_id = null where id = $1", [
				period.id,
			]);
			await admin.query("delete from time_record where id = $1", [period.canonical_record_id]);

			await runCanonicalBackfill({ organizationId: ids.organization, actorId: ids.ownerUser });

			expectAgreement(await attributionOf(period.id), {
				projectId: ids.billableProject,
				billable: true,
			});
			expect((await reconcileLegacyToCanonical(ids.organization)).missingProjectAllocationRows).toBe(0);
		});
	});
});
