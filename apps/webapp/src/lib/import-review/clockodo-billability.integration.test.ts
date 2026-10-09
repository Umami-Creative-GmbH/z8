/**
 * #907 runtime evidence: Clockodo's billable value reaches imported work.
 *
 * Local contract: pnpm --filter webapp test:integration
 *
 * The real project-mapping action saves the organization's Clockodo project
 * mappings, the real Clockodo adapter scans fixture entries (shaped like the
 * Clockodo API's `GET /api/v2/entries` response, enhanced list) into the review
 * batch, the real review decision accepts them and the real reviewed-import
 * worker commits them in both admissions (legacy and adopted append). Only the
 * Clockodo HTTP client, the request/session, the import queue and the Next cache
 * boundaries are replaced; the authoritative clock is pinned.
 */

import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { type Instant, parseInstant } from "@/lib/datetime/temporal-core";
import { integrationAdminPool } from "@/test/integration-database";

const harness = vi.hoisted(() => ({
	userId: null as string | null,
	organizationId: null as string | null,
	now: null as Instant | null,
	entries: [] as unknown[],
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
								id: `t907-session-${harness.userId}`,
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
		getPrincipalContext: async () =>
			harness.userId && harness.organizationId
				? loadOrganizationPrincipalContext(db, {
						userId: harness.userId,
						organizationId: harness.organizationId,
					})
				: null,
	};
});

vi.mock("@/lib/import-review/queue", () => ({
	enqueueImportCommitJob: async () => {},
	enqueueImportScanJob: async () => {},
}));

/** The Clockodo HTTP boundary: the scan reads the fixture entries. */
vi.mock("@/lib/clockodo/client", () => ({
	ClockodoClient: class {
		async getEntries() {
			return harness.entries;
		}
	},
}));

const { saveProjectMappings } = await import(
	"@/app/[locale]/(app)/settings/clockodo-import/actions"
);
const { scanClockodoImportPartition } = await import("./clockodo-adapter");
const { applyImportRowDecision, saveImportJobSecret } = await import("./repository");
const { encryptImportCredential } = await import("./credential-secret");
const { processImportReviewJob } = await import("./worker");
const { env } = await import("@/env");
const { db } = await import("@/db");
const { listImportReviewRows } = await import("./repository");
const { listImportRowBillability } = await import("./import-row-billability");

function only<T>(rows: readonly T[]): T {
	const [row] = rows;
	if (rows.length !== 1 || row === undefined) {
		throw new Error(`Expected exactly one row, received ${rows.length}`);
	}
	return row;
}

const ids = {
	organization: "t907-clockodo-org",
	employeeUser: "t907-employee-user",
	ownerUser: "t907-owner-user",
	employee: "e9070000-0000-4000-8000-000000000001",
	owner: "e9070000-0000-4000-8000-000000000002",
	customer: "e9070000-0000-4000-8000-000000000010",
	/** A customer's project; its billable default is off, so billability comes from Clockodo. */
	customerProject: "e9070000-0000-4000-8000-000000000021",
	/** An internal project without a customer. */
	internalProject: "e9070000-0000-4000-8000-000000000022",
} as const;
const users = [ids.employeeUser, ids.ownerUser];
const clockodo = {
	user: 501,
	customer: 601,
	customerProject: 701,
	internalProject: 702,
	unmappedProject: 703,
};
const now = parseInstant("2026-07-22T18:00:00Z");

/** One Clockodo time entry as `GET /api/v2/entries?enhanced_list=true` returns it. */
function clockodoEntry(input: {
	id: number;
	day: string;
	projectId: number | null;
	billable: 0 | 1 | 2;
}) {
	return {
		id: input.id,
		customers_id: clockodo.customer,
		projects_id: input.projectId,
		users_id: clockodo.user,
		billable: input.billable,
		texts_id: null,
		time_since: `${input.day}T08:00:00Z`,
		time_until: `${input.day}T10:00:00Z`,
		time_insert: `${input.day}T10:00:05Z`,
		time_last_change: `${input.day}T10:00:05Z`,
		type: 1,
		services_id: 801,
		duration: 7200,
		offset: 0,
		clocked: true,
		clocked_offline: false,
		text: null,
		customers_name: "Acme GmbH",
		projects_name: null,
		users_name: "Erika Mustermann",
		services_name: "Development",
	};
}

type Committed = {
	provider_source_id: string;
	row_status: string;
	project_id: string | null;
	is_billable: boolean;
	allocations: { projectId: string; isBillable: boolean }[] | null;
};

describe("Clockodo billable values in reviewed imports on PostgreSQL (#907)", () => {
	vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
	const admin = integrationAdminPool();

	async function cleanup() {
		await admin.query("delete from organization where id = $1", [ids.organization]);
		await admin.query('delete from "user" where id = any($1::text[])', [users]);
	}

	async function seed() {
		await cleanup();
		const timestamp = new Date("2026-07-01T00:00:00Z");
		await admin.query(
			`insert into organization (id, name, slug, timezone, projects_enabled, created_at)
			 values ($1, 'T907 clockodo', $1, 'UTC', true, $2)`,
			[ids.organization, timestamp],
		);
		await admin.query(
			`insert into "user" (id, name, email, created_at, updated_at)
			 select user_id, user_id, user_id || '@example.test', $2, $2 from unnest($1::text[]) as user_id`,
			[users, timestamp],
		);
		await admin.query(
			`insert into member (id, organization_id, user_id, role, status, created_at) values
			 ('t907-m-employee', $1, $2, 'member', 'approved', $4),
			 ('t907-m-owner', $1, $3, 'owner', 'approved', $4)`,
			[ids.organization, ids.employeeUser, ids.ownerUser, timestamp],
		);
		await admin.query(
			`insert into employee (id, user_id, organization_id, role, updated_at) values
			 ($1, $2, $5, 'employee', $6), ($3, $4, $5, 'admin', $6)`,
			[ids.employee, ids.employeeUser, ids.owner, ids.ownerUser, ids.organization, timestamp],
		);
		await admin.query(
			`insert into customer (id, organization_id, name, created_by, updated_at)
			 values ($1, $2, 'Acme', $3, $4)`,
			[ids.customer, ids.organization, ids.ownerUser, timestamp],
		);
		await admin.query(
			`insert into project (id, organization_id, name, status, is_active, customer_id, billable_default, created_by, updated_at) values
			 ($1, $3, 'Website', 'active', true, $4, false, $5, $6),
			 ($2, $3, 'Internal', 'active', true, null, false, $5, $6)`,
			[
				ids.customerProject,
				ids.internalProject,
				ids.organization,
				ids.customer,
				ids.ownerUser,
				timestamp,
			],
		);
		await admin.query(
			`insert into clockodo_user_mapping
			 (organization_id, clockodo_user_id, clockodo_user_name, clockodo_user_email, user_id, employee_id, mapping_type, updated_at)
			 values ($1, $2, 'Erika Mustermann', 'erika@example.test', $3, $4, 'manual', $5)`,
			[ids.organization, clockodo.user, ids.employeeUser, ids.employee, timestamp],
		);
	}

	async function setAdmission(mode: "active" | "inactive") {
		await admin.query(
			`insert into time_entry_append_control (organization_id, mode) values ($1, $2)
			 on conflict (organization_id) do update set mode = excluded.mode, updated_at = now()`,
			[ids.organization, mode],
		);
	}

	/** The real mapping step: the owner maps two Clockodo projects and leaves one unmapped. */
	async function mapProjects() {
		harness.userId = ids.ownerUser;
		harness.organizationId = ids.organization;
		await expect(
			saveProjectMappings(ids.organization, [
				{
					clockodoProjectId: clockodo.customerProject,
					clockodoProjectName: "Website",
					clockodoCustomerName: "Acme GmbH",
					projectId: ids.customerProject,
					source: "name",
				},
				{
					clockodoProjectId: clockodo.internalProject,
					clockodoProjectName: "Internal tooling",
					clockodoCustomerName: "Acme GmbH",
					projectId: ids.internalProject,
					source: "manual",
				},
				{
					clockodoProjectId: clockodo.unmappedProject,
					clockodoProjectName: "Support",
					clockodoCustomerName: "Acme GmbH",
					projectId: null,
					source: null,
				},
			]),
		).resolves.toEqual({ success: true, data: undefined });
	}

	/** Scans the fixture entries into a new batch and accepts every staged row. */
	async function scanAndAccept(extraRows: (batchId: string) => Promise<void> = async () => {}) {
		const batchId = randomUUID();
		await admin.query(
			`insert into import_batch
			 (id, organization_id, provider, status, selected_scope, date_range, started_by, created_at, updated_at)
			 values ($1, $2, 'clockodo', 'scanning', '{}', '{"startDate":"2026-07-01","endDate":"2026-07-21"}', $3, now(), now())`,
			[batchId, ids.organization, ids.ownerUser],
		);
		const secret = await saveImportJobSecret({
			batchId,
			organizationId: ids.organization,
			credential: encryptImportCredential(
				JSON.stringify({ email: "admin@example.test", apiKey: "fixture" }),
				env.BETTER_AUTH_SECRET,
				new Date("2099-01-01T00:00:00Z"),
			),
		});
		await scanClockodoImportPartition({
			batchId,
			jobId: randomUUID(),
			organizationId: ids.organization,
			provider: "clockodo",
			entityType: "work_period",
			dateRange: { startDate: "2026-07-01", endDate: "2026-07-21" },
			secretId: secret.id,
		});
		await extraRows(batchId);
		await admin.query("update import_batch set status = 'needs_review' where id = $1", [batchId]);
		const { rows } = await admin.query<{ id: string }>(
			"select id from import_staged_row where batch_id = $1",
			[batchId],
		);
		await applyImportRowDecision({
			batchId,
			organizationId: ids.organization,
			rowIds: rows.map((row) => row.id),
			decision: "accepted",
			decidedBy: ids.ownerUser,
		});
		return batchId;
	}

	async function commit(batchId: string) {
		const jobId = randomUUID();
		await admin.query(
			"update import_batch set status = 'committing', committed_by = $2 where id = $1",
			[batchId, ids.ownerUser],
		);
		await admin.query(
			`insert into import_batch_job
			 (id, batch_id, organization_id, kind, status, entity_type, partition_key, created_at, updated_at)
			 values ($1, $2, $3, 'commit', 'queued', 'work_period', 'work_period', now(), now())`,
			[jobId, batchId, ids.organization],
		);
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
		} as never);
	}

	/** Each staged row with the work it committed and that work's canonical allocations. */
	async function committedWork(batchId: string): Promise<Map<string, Committed>> {
		const { rows } = await admin.query<Committed>(
			`select r.provider_source_id, r.row_status, wp.project_id, wp.is_billable,
			        (select json_agg(json_build_object('projectId', a.project_id, 'isBillable', a.is_billable))
			           from time_record_allocation a
			          where a.record_id = wp.canonical_record_id and a.allocation_kind = 'project') as allocations
			   from import_staged_row r
			   left join work_period wp on wp.id = r.commit_target_id::uuid
			  where r.batch_id = $1`,
			[batchId],
		);
		return new Map(rows.map((row) => [row.provider_source_id, row]));
	}

	beforeEach(async () => {
		harness.now = now;
		harness.entries = [
			clockodoEntry({ id: 1, day: "2026-07-13", projectId: clockodo.customerProject, billable: 1 }),
			clockodoEntry({ id: 2, day: "2026-07-14", projectId: clockodo.customerProject, billable: 2 }),
			clockodoEntry({ id: 3, day: "2026-07-15", projectId: clockodo.customerProject, billable: 0 }),
			clockodoEntry({ id: 4, day: "2026-07-16", projectId: clockodo.internalProject, billable: 1 }),
			clockodoEntry({ id: 5, day: "2026-07-17", projectId: clockodo.unmappedProject, billable: 1 }),
			clockodoEntry({ id: 6, day: "2026-07-20", projectId: null, billable: 1 }),
		];
		await seed();
		await mapProjects();
	});

	afterAll(async () => {
		await cleanup();
	});

	it("saves only mappings to the organization's existing projects", async () => {
		const { rows } = await admin.query(
			`select clockodo_project_id, project_id from clockodo_project_mapping
			  where organization_id = $1 order by clockodo_project_id`,
			[ids.organization],
		);
		expect(rows).toEqual([
			{ clockodo_project_id: clockodo.customerProject, project_id: ids.customerProject },
			{ clockodo_project_id: clockodo.internalProject, project_id: ids.internalProject },
		]);

		await expect(
			saveProjectMappings(ids.organization, [
				{
					clockodoProjectId: clockodo.unmappedProject,
					clockodoProjectName: "Support",
					clockodoCustomerName: null,
					projectId: randomUUID(),
					source: "manual",
				},
			]),
		).resolves.toEqual({
			success: false,
			error: "One or more projects do not belong to this organization",
		});
	});

	describe.each([
		["legacy", "inactive"],
		["append", "active"],
	] as const)("%s admission", (admission, mode) => {
		beforeEach(async () => {
			await setAdmission(mode);
		});

		/**
		 * The period records the expected project and billability; in adopted
		 * organizations its canonical record carries exactly the same.
		 */
		function expectWork(
			row: Committed | undefined,
			expected: { projectId: string | null; billable: boolean },
		) {
			expect(row?.row_status).toBe("committed");
			expect({ projectId: row?.project_id, billable: row?.is_billable }).toEqual(expected);
			if (admission !== "append") return;
			expect(row?.allocations ?? []).toEqual(
				expected.projectId
					? [{ projectId: expected.projectId, isBillable: expected.billable }]
					: [],
			);
		}

		it("commits Clockodo billable values as billable work only on a mapped customer's project", async () => {
			const batchId = await scanAndAccept();
			await commit(batchId);
			const work = await committedWork(batchId);

			expectWork(work.get("clockodo:entry:1"), { projectId: ids.customerProject, billable: true });
			// "Already billed" imports as billable work, never as invoiced work.
			expectWork(work.get("clockodo:entry:2"), { projectId: ids.customerProject, billable: true });
			expectWork(work.get("clockodo:entry:3"), { projectId: ids.customerProject, billable: false });
			expectWork(work.get("clockodo:entry:4"), { projectId: ids.internalProject, billable: false });
			expectWork(work.get("clockodo:entry:5"), { projectId: null, billable: false });
			expectWork(work.get("clockodo:entry:6"), { projectId: null, billable: false });
		});

		it.each([
			["is removed from the project", "update project set customer_id = null where id = $1"],
			["is deleted", "update customer set is_active = false where id = $1"],
		])(
			"imports billable entries as non-billable when the mapped project's customer %s after the scan, and the review screen says why",
			async (label, change) => {
				harness.entries = harness.entries.slice(0, 3);
				const batchId = await scanAndAccept();
				await admin.query(change, [label === "is deleted" ? ids.customer : ids.customerProject]);

				await commit(batchId);
				const work = await committedWork(batchId);
				expectWork(work.get("clockodo:entry:1"), {
					projectId: ids.customerProject,
					billable: false,
				});
				expectWork(work.get("clockodo:entry:2"), {
					projectId: ids.customerProject,
					billable: false,
				});
				expectWork(work.get("clockodo:entry:3"), {
					projectId: ids.customerProject,
					billable: false,
				});

				const rows = await listImportReviewRows({
					batchId,
					organizationId: ids.organization,
					limit: 10,
					offset: 0,
				});
				const shown = await listImportRowBillability(db, ids.organization, rows);
				const byEntry = new Map(rows.map((row, index) => [row.providerSourceId, shown[index]]));
				expect(byEntry.get("clockodo:entry:1")).toEqual({
					providerValue: 1,
					billable: false,
					note: "no_customer",
				});
				expect(byEntry.get("clockodo:entry:2")).toEqual({
					providerValue: 2,
					billable: false,
					note: "no_customer",
				});
				expect(byEntry.get("clockodo:entry:3")).toEqual({
					providerValue: 0,
					billable: false,
					note: null,
				});
			},
		);

		it("stages entries on a mapped project whose customer was deleted as without customer", async () => {
			await admin.query("update customer set is_active = false where id = $1", [ids.customer]);
			harness.entries = harness.entries.slice(0, 1);
			const batchId = await scanAndAccept();
			const { rows } = await admin.query<{ normalized_payload: Record<string, unknown> }>(
				"select normalized_payload from import_staged_row where batch_id = $1",
				[batchId],
			);
			expect(only(rows).normalized_payload).toMatchObject({
				attribution: { projectId: ids.customerProject, billable: false },
				billability: { providerValue: 1, billable: false, note: "no_customer" },
			});
		});

		it("commits a work row staged before #907 as non-billable work without a project", async () => {
			harness.entries = [];
			const batchId = await scanAndAccept(async (id) => {
				// The adapter's pre-#907 row: the raw entry says billable, the
				// normalized payload has neither attribution nor billability.
				const source = clockodoEntry({
					id: 9,
					day: "2026-07-21",
					projectId: clockodo.customerProject,
					billable: 1,
				});
				await admin.query(
					`insert into import_staged_row
					 (batch_id, organization_id, entity_type, provider_source_id, source_payload_hash,
					  source_payload, normalized_payload, row_status, issue_severity, created_at, updated_at)
					 values ($1, $2, 'work_period', 'clockodo:entry:9', $3, $4, $5, 'staged', 'none', now(), now())`,
					[
						id,
						ids.organization,
						"pre-907-hash",
						source,
						{
							employeeId: ids.employee,
							startsAt: source.time_since,
							endsAt: source.time_until,
							serviceId: null,
							providerEmployeeId: clockodo.user,
							providerServiceId: source.services_id,
							durationSeconds: source.duration,
							suspiciousFlags: [],
						},
					],
				);
			});
			await commit(batchId);

			expectWork((await committedWork(batchId)).get("clockodo:entry:9"), {
				projectId: null,
				billable: false,
			});
		});
	});
});
