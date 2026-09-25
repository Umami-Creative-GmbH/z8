/**
 * #324 / T59 runtime evidence for graph-aware verification and audit assurance.
 *
 * Local contract: pnpm --filter webapp test:approval-workflow-repository:integration
 * The runner creates, migrates, verifies, and removes a label-owned PostgreSQL 16 database.
 *
 * The real verify route (membership/employee lookups, SSO admission, principal loader,
 * CASL ability, time-entry service), the real `clockIn` action with append admission,
 * the real audit-pack job and payroll readiness run against that database. Only the
 * session, request headers, billing provisioning, notification delivery, Next cache
 * and the audit-export hardening (signing/S3) boundary are replaced. Append adoption
 * is enabled per test organization by inserting its control row directly.
 */

import JSZip from "jszip";
import { DateTime } from "luxon";
import type { NextRequest } from "next/server";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
	resolveApprovalWorkflowRepositoryTestConfiguration,
	verifyApprovalWorkflowRepositoryTestDatabase,
} from "@/lib/approvals/workflow/repository-integration-harness";
import { parseInstant } from "@/lib/datetime/temporal-core";
import { calculateHash } from "@/lib/time-tracking/blockchain";

const harness = vi.hoisted(() => ({
	userId: null as string | null,
	organizationId: null as string | null,
	packageId: null as string | null,
	zips: [] as Buffer[],
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
							user: { id: harness.userId, role: "user" },
							session: {
								id: `t324-session-${harness.userId}`,
								userId: harness.userId,
								activeOrganizationId: harness.organizationId,
							},
						}
					: null,
		},
	},
}));

vi.mock("@/lib/billing/guard", () => ({
	requireBillingForMutation: async () => ({ canAccess: true }),
	isBillingMutationAllowed: (access: { canAccess: boolean }) => access.canAccess,
}));

vi.mock("@/app/[locale]/(app)/time-tracking/actions/approvals", async (importOriginal) => ({
	...(await importOriginal<
		typeof import("@/app/[locale]/(app)/time-tracking/actions/approvals")
	>()),
	sendClockOutApprovalNotifications: async () => {},
	sendClockOutApprovedNotification: async () => {},
}));

// Signing and S3 upload are the external boundary; the assembled zip is captured.
vi.mock("@/lib/audit-export", async (importOriginal) => {
	const original = await importOriginal<typeof import("@/lib/audit-export")>();
	return {
		...original,
		auditExportOrchestrator: {
			hardenExport: async ({ zipBuffer }: { zipBuffer: Buffer }) => {
				harness.zips.push(zipBuffer);
				return { auditPackageId: harness.packageId, s3Key: "t324/audit-pack.zip" };
			},
		},
	};
});

const { POST } = await import("@/app/api/time-entries/verify/route");
const { clockIn } = await import("@/app/[locale]/(app)/time-tracking/actions/clocking");
const { processAuditPack } = await import("@/lib/audit-pack/application/audit-pack-processor");
const { getPayrollReadiness } = await import("@/lib/payroll-readiness/get-payroll-readiness");

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
	describe.skip(`append assurance PostgreSQL unavailable: ${integrationConfiguration.reason}`, () => {
		it("requires the label-owned disposable PostgreSQL runner", () => {});
	});
}

const ids = {
	organization: "t324-assurance-org",
	otherOrganization: "t324-assurance-other-org",
	ownerUser: "t324-owner-user",
	managerUser: "t324-manager-user",
	workerUser: "t324-worker-user",
	peerUser: "t324-peer-user",
	foreignUser: "t324-foreign-user",
	owner: "d3240000-0000-4000-8000-000000000001",
	manager: "d3240000-0000-4000-8000-000000000002",
	worker: "d3240000-0000-4000-8000-000000000003",
	peer: "d3240000-0000-4000-8000-000000000004",
	foreign: "d3240000-0000-4000-8000-000000000005",
	pack: "d3240000-0000-4000-8000-0000000000aa",
	packRequest: "d3240000-0000-4000-8000-0000000000ab",
} as const;

type SeedEntry = {
	id: string;
	employeeId: string;
	organizationId: string;
	type: "clock_in" | "clock_out";
	timestamp: string;
	previousHash: string | null;
	previousEntryId: string | null;
	hash: string;
	replacesEntryId?: string | null;
};

let entrySequence = 0;
/** A standard-hash entry following `previous` by explicit ID+hash, or by hash only. */
function seedEntry(
	previous: SeedEntry | null,
	type: SeedEntry["type"],
	timestamp: string,
	options: { link?: "explicit" | "hash-only"; employeeId?: string; organizationId?: string } = {},
): SeedEntry {
	entrySequence += 1;
	const employeeId = options.employeeId ?? previous?.employeeId ?? ids.worker;
	const previousHash = previous?.hash ?? null;
	return {
		id: `d3250000-0000-4000-8000-${entrySequence.toString().padStart(12, "0")}`,
		employeeId,
		organizationId: options.organizationId ?? ids.organization,
		type,
		timestamp,
		previousHash,
		previousEntryId: previous && options.link !== "hash-only" ? previous.id : null,
		hash: calculateHash({
			employeeId,
			type,
			timestamp: new Date(timestamp).toISOString(),
			previousHash,
		}),
	};
}

describeIntegration("graph-aware verification and audit assurance on PostgreSQL", () => {
	vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
	const admin = new Pool({ connectionString: databaseUrl, max: 4 });

	async function verifyAs(userId: string, body: Record<string, unknown> = {}) {
		harness.userId = userId;
		harness.organizationId = ids.organization;
		const response = await POST(
			new Request("http://localhost/api/time-entries/verify", {
				method: "POST",
				body: JSON.stringify(body),
			}) as unknown as NextRequest,
		);
		return { status: response.status, body: await response.json() };
	}

	async function insertEntries(entries: readonly SeedEntry[]) {
		for (const entry of entries) {
			await admin.query(
				`insert into time_entry
				 (id, employee_id, organization_id, type, timestamp, utc_offset_minutes, timezone,
				  timezone_source, previous_entry_id, hash, previous_hash, replaces_entry_id,
				  created_at, created_by)
				 values ($1, $2, $3, $4, $5, 0, 'UTC', 'user_setting', $6, $7, $8, $9, $5, $10)`,
				[
					entry.id,
					entry.employeeId,
					entry.organizationId,
					entry.type,
					new Date(entry.timestamp),
					entry.previousEntryId,
					entry.hash,
					entry.previousHash,
					entry.replacesEntryId ?? null,
					ids.ownerUser,
				],
			);
		}
	}

	async function cleanup() {
		await admin.query("delete from organization where id in ($1, $2)", [
			ids.organization,
			ids.otherOrganization,
		]);
		await admin.query('delete from "user" where id = any($1::text[])', [
			[ids.ownerUser, ids.managerUser, ids.workerUser, ids.peerUser, ids.foreignUser],
		]);
	}

	async function seed() {
		await cleanup();
		harness.zips.length = 0;
		const timestamp = new Date("2026-06-01T00:00:00Z");
		await admin.query(
			`insert into organization (id, name, slug, created_at) values
			 ($1, 'T324 assurance', $1, $3), ($2, 'T324 other', $2, $3)`,
			[ids.organization, ids.otherOrganization, timestamp],
		);
		const users = [ids.ownerUser, ids.managerUser, ids.workerUser, ids.peerUser, ids.foreignUser];
		await admin.query(
			`insert into "user" (id, name, email, created_at, updated_at)
			 select user_id, user_id, user_id || '@example.test', $2, $2 from unnest($1::text[]) as user_id`,
			[users, timestamp],
		);
		await admin.query(
			`insert into member (id, organization_id, user_id, role, status, created_at) values
			 ('t324-member-owner', $1, $2, 'owner', 'approved', $7),
			 ('t324-member-manager', $1, $3, 'member', 'approved', $7),
			 ('t324-member-worker', $1, $4, 'member', 'approved', $7),
			 ('t324-member-peer', $1, $5, 'member', 'approved', $7),
			 ('t324-member-foreign', $6, $8, 'member', 'approved', $7)`,
			[
				ids.organization,
				ids.ownerUser,
				ids.managerUser,
				ids.workerUser,
				ids.peerUser,
				ids.otherOrganization,
				timestamp,
				ids.foreignUser,
			],
		);
		await admin.query(
			`insert into employee (id, user_id, organization_id, role, updated_at) values
			 ($1, $2, $11, 'admin', $12), ($3, $4, $11, 'manager', $12),
			 ($5, $6, $11, 'employee', $12), ($7, $8, $11, 'employee', $12),
			 ($9, $10, $13, 'employee', $12)`,
			[
				ids.owner,
				ids.ownerUser,
				ids.manager,
				ids.managerUser,
				ids.worker,
				ids.workerUser,
				ids.peer,
				ids.peerUser,
				ids.foreign,
				ids.foreignUser,
				ids.organization,
				timestamp,
				ids.otherOrganization,
			],
		);
		await admin.query(
			`insert into employee_managers (employee_id, manager_id, is_primary, assigned_by)
			 values ($1, $2, true, $3)`,
			[ids.worker, ids.manager, ids.ownerUser],
		);
		await admin.query(
			`insert into user_settings (user_id, timezone, updated_at)
			 select user_id, 'UTC', $2 from unnest($1::text[]) as user_id`,
			[users, timestamp],
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
		if (enabled.status !== "enabled") {
			throw new Error("Append assurance PostgreSQL is disabled");
		}
	});

	beforeEach(seed);

	afterAll(async () => {
		await cleanup();
		await admin.end();
		const { pool } = (await import("@/db")) as unknown as { pool: Pool };
		await pool.end();
	});

	/** Mixed history: hash-only and explicit links, a provider-format hash, a
	 * cross-organization predecessor ID and a hole, plus foreign-org evidence. */
	async function seedMixedHistory() {
		const foreignEntry = seedEntry(null, "clock_in", "2026-07-01T07:00:00Z", {
			employeeId: ids.foreign,
			organizationId: ids.otherOrganization,
		});
		const e1 = seedEntry(null, "clock_in", "2026-07-01T08:00:00Z");
		const e2 = seedEntry(e1, "clock_out", "2026-07-01T16:00:00Z", { link: "hash-only" });
		const e3 = seedEntry(e2, "clock_in", "2026-07-02T08:00:00Z");
		const providerFormat = {
			...seedEntry(e3, "clock_out", "2026-07-02T16:00:00Z"),
			hash: "clockodo-bytes",
		};
		const crossScope = {
			...seedEntry(foreignEntry, "clock_in", "2026-07-03T08:00:00Z", { employeeId: ids.worker }),
		};
		const missing = seedEntry(null, "clock_in", "2026-06-01T08:00:00Z");
		const orphan = seedEntry(missing, "clock_out", "2026-07-03T16:00:00Z", { link: "hash-only" });
		await insertEntries([foreignEntry, e1, e2, e3, providerFormat, crossScope, orphan]);
		return { foreignEntry, e1, e2, e3, providerFormat, crossScope, orphan };
	}

	it("gives an operator record-level diagnostics over mixed graph and hash families", async () => {
		const history = await seedMixedHistory();

		const { status, body } = await verifyAs(ids.ownerUser, { employeeId: ids.worker });

		expect(status).toBe(200);
		expect(body.diagnostics).toBe("record_level");
		const report = body.assurance;
		expect(report).toMatchObject({
			organizationId: ids.organization,
			employeeId: ids.worker,
			entryCount: 6,
			links: { stored: 2, derived: 1, roots: 1, unresolved: 2 },
			hashes: { reproduced: 5, notReproduced: [history.providerFormat.id] },
			continuity: { status: "not_adopted" },
			assurance: { scope: "none" },
		});
		const entries = new Map(
			(report.entries as { entryId: string }[]).map((entry) => [entry.entryId, entry]),
		);
		expect(entries.get(history.e2.id)).toEqual({
			entryId: history.e2.id,
			stored: { hash: history.e2.hash, previousHash: history.e1.hash, previousEntryId: null },
			hash: "reproduced",
			link: { kind: "derived", predecessorId: history.e1.id },
		});
		expect(entries.get(history.e3.id)).toMatchObject({
			link: { kind: "stored", predecessorId: history.e2.id },
		});
		// The stored cross-organization reference is preserved but never followed or loaded.
		expect(entries.get(history.crossScope.id)).toMatchObject({
			stored: { previousEntryId: history.foreignEntry.id },
			link: { kind: "unresolved" },
		});
		expect(entries.has(history.foreignEntry.id)).toBe(false);
		expect(report.lineage.issues.map((issue: { kind: string }) => issue.kind).toSorted()).toEqual([
			"missing_predecessor",
			"predecessor_outside_scope",
			"unverified_hash",
		]);
		expect(
			report.assurance.limitations.map((limitation: { code: string }) => limitation.code),
		).toEqual(
			expect.arrayContaining([
				"derived_links",
				"hash_not_reproduced",
				"lineage_unresolved",
				"no_continuity_position",
				"payroll_readiness_not_assessed",
			]),
		);
	});

	it("gives an employee verifying their own history status and codes without identities", async () => {
		const history = await seedMixedHistory();

		const { status, body } = await verifyAs(ids.workerUser);

		expect(status).toBe(200);
		expect(body.diagnostics).toBe("summary");
		expect(body.assurance).toMatchObject({
			entryCount: 6,
			lineage: "review_required",
			continuity: "not_adopted",
			assurance: { scope: "none" },
			hashes: { reproduced: 5, notReproduced: 1 },
		});
		const serialized = JSON.stringify(body.assurance);
		for (const entry of Object.values(history)) expect(serialized).not.toContain(entry.id);
	});

	it("limits record-level diagnostics to employees the caller manages", async () => {
		await seedMixedHistory();

		await expect(verifyAs(ids.managerUser, { employeeId: ids.peer })).resolves.toMatchObject({
			status: 403,
		});
		await expect(verifyAs(ids.workerUser, { employeeId: ids.peer })).resolves.toMatchObject({
			status: 403,
		});
		const managed = await verifyAs(ids.managerUser, { employeeId: ids.worker });
		expect(managed).toMatchObject({ status: 200, body: { diagnostics: "record_level" } });
		// Self-service management of one's own entries does not make an operator.
		await expect(verifyAs(ids.managerUser)).resolves.toMatchObject({
			status: 200,
			body: { diagnostics: "summary" },
		});
		await expect(verifyAs(ids.ownerUser)).resolves.toMatchObject({
			status: 200,
			body: { diagnostics: "record_level", assurance: { lineage: { status: "empty" } } },
		});
		// Another organization's employee is not found through the active organization.
		await expect(verifyAs(ids.ownerUser, { employeeId: ids.foreign })).resolves.toMatchObject({
			status: 404,
		});
	});

	it("discloses duplicate hashes and keeps hash-only links into them ambiguous", async () => {
		const twinA = seedEntry(null, "clock_in", "2026-07-01T08:00:00Z");
		const twinB = seedEntry(null, "clock_in", "2026-07-01T08:00:00Z");
		const afterA = seedEntry(twinA, "clock_out", "2026-07-01T16:00:00Z");
		const intoTwins = seedEntry(twinB, "clock_out", "2026-07-01T17:00:00Z", { link: "hash-only" });
		await insertEntries([twinA, twinB, afterA, intoTwins]);

		const { body } = await verifyAs(ids.ownerUser, { employeeId: ids.worker });

		expect(twinA.hash).toBe(twinB.hash);
		expect(body.assurance.hashes.duplicates).toEqual([[twinA.id, twinB.id].toSorted()]);
		expect(body.assurance.hashes.notReproduced).toEqual([]);
		expect(body.assurance.lineage.issues).toEqual(
			expect.arrayContaining([
				{
					kind: "ambiguous_predecessor",
					entryId: intoTwins.id,
					candidateIds: [twinA.id, twinB.id].toSorted(),
				},
				{ kind: "multiple_roots", rootIds: [twinA.id, twinB.id].toSorted() },
			]),
		);
		expect(body.assurance.assurance.limitations).toContainEqual({
			code: "duplicate_hashes",
			entryIdGroups: [[twinA.id, twinB.id].toSorted()],
		});
	});

	it("reports post-anchor continuity from a real admitted clock-in, separately from history", async () => {
		await admin.query(
			"insert into time_entry_append_control (organization_id, mode) values ($1, 'active')",
			[ids.organization],
		);
		const e1 = seedEntry(null, "clock_in", "2026-07-20T08:00:00Z");
		const e2 = seedEntry(e1, "clock_out", "2026-07-20T16:00:00Z", { link: "hash-only" });
		await insertEntries([e1, e2]);
		harness.userId = ids.workerUser;
		harness.organizationId = ids.organization;
		await expect(
			clockIn("office", { instant: parseInstant("2026-07-22T08:00:00Z"), browserTimezone: "UTC" }),
		).resolves.toMatchObject({ success: true });
		const {
			rows: [appended],
		} = await admin.query<{ id: string; hash: string }>(
			"select id, hash from time_entry where employee_id = $1 and previous_entry_id = $2",
			[ids.worker, e2.id],
		);

		const admitted = (await verifyAs(ids.ownerUser, { employeeId: ids.worker })).body.assurance;
		expect(admitted.continuity).toMatchObject({
			status: "established",
			provenance: {
				admission: "verified_lineage",
				anchor: { id: e2.id, hash: e2.hash },
				admittedEntryCount: 2,
				tip: { id: appended.id, hash: appended.hash },
				entryCount: 3,
			},
			postAnchorEntryIds: [appended.id],
		});
		expect(admitted.assurance.scope).toBe("whole_history");

		// A hashed field changed before the anchor: continuity after it still holds,
		// but the claim narrows to post-anchor instead of verified whole history.
		await admin.query("update time_entry set type = 'clock_out' where id = $1", [e1.id]);
		const narrowed = (await verifyAs(ids.ownerUser, { employeeId: ids.worker })).body.assurance;
		expect(narrowed.continuity.status).toBe("established");
		expect(narrowed.lineage.status).toBe("review_required");
		expect(narrowed.assurance.scope).toBe("post_anchor");
		expect(narrowed.assurance.limitations).toContainEqual({
			code: "history_before_anchor_unverified",
			anchorEntryId: e2.id,
		});

		// A write after the recorded tip that bypassed the collaborator interrupts it.
		const tip = { ...e2, id: appended.id, hash: appended.hash };
		await insertEntries([seedEntry(tip, "clock_out", "2026-07-22T16:00:00Z")]);
		const interrupted = (await verifyAs(ids.ownerUser, { employeeId: ids.worker })).body.assurance;
		expect(interrupted.continuity).toMatchObject({
			status: "interrupted",
			reasons: expect.arrayContaining([
				{ kind: "unexpected_history_change", expectedEntryCount: 3, actualEntryCount: 4 },
				expect.objectContaining({ kind: "unexpected_successor", predecessorId: appended.id }),
			]),
		});
		expect(interrupted.assurance.scope).toBe("none");
	});

	async function generatePack(range: { start: string; end: string }) {
		await admin.query(
			`insert into audit_export_package (id, organization_id, requested_by_id, export_type)
			 values ($1, $2, $3, 'audit_pack')`,
			[ids.pack, ids.organization, ids.ownerUser],
		);
		harness.packageId = ids.pack;
		await admin.query(
			`insert into audit_pack_request (id, organization_id, requested_by_id, start_date, end_date)
			 values ($1, $2, $3, $4, $5)`,
			[
				ids.packRequest,
				ids.organization,
				ids.ownerUser,
				new Date(range.start),
				new Date(range.end),
			],
		);
		const outcome = await processAuditPack({
			requestId: ids.packRequest,
			organizationId: ids.organization,
		} as never).then(
			() => null,
			(error: unknown) => error,
		);
		const {
			rows: [request],
		} = await admin.query<{ status: string; error_code: string | null }>(
			"select status, error_code from audit_pack_request where id = $1",
			[ids.packRequest],
		);
		const {
			rows: [artifact],
		} = await admin.query<{ append_assurance: unknown; entry_count: number }>(
			"select append_assurance, entry_count from audit_pack_artifact where request_id = $1",
			[ids.packRequest],
		);
		const zipBuffer = harness.zips.at(-1);
		const zip = zipBuffer ? await JSZip.loadAsync(zipBuffer) : null;
		const read = async (path: string) =>
			JSON.parse((await zip?.file(path)?.async("string")) ?? "null");
		return { outcome, request, artifact, read };
	}

	it("expands an audit pack through resolved links and discloses each employee's assurance", async () => {
		// Owner history outside the range, referenced only by a cross-employee stored ID.
		const ownerOld = seedEntry(null, "clock_in", "2026-05-01T08:00:00Z", { employeeId: ids.owner });
		const e1 = seedEntry(null, "clock_in", "2026-06-20T08:00:00Z");
		const e2 = seedEntry(e1, "clock_out", "2026-07-05T16:00:00Z", { link: "hash-only" });
		const e3 = seedEntry(e2, "clock_in", "2026-07-06T08:00:00Z");
		const peerEntry = {
			...seedEntry(null, "clock_in", "2026-07-07T08:00:00Z", { employeeId: ids.peer }),
			previousEntryId: ownerOld.id,
		};
		await insertEntries([ownerOld, e1, e2, e3, peerEntry]);

		const { outcome, request, artifact, read } = await generatePack({
			start: "2026-07-01T00:00:00Z",
			end: "2026-07-31T23:59:59Z",
		});

		expect(outcome).toBeNull();
		expect(request).toEqual({ status: "completed", error_code: null });
		const entries: { id: string; lineage: object; appendLink: object; hash: object }[] =
			await read("evidence/entries.json");
		const byId = new Map(entries.map((entry) => [entry.id, entry]));
		// e1 is outside the range and reachable only through the derived hash link.
		expect([...byId.keys()].toSorted()).toEqual([e1.id, e2.id, e3.id, peerEntry.id].toSorted());
		expect(byId.get(e2.id)).toMatchObject({
			lineage: { previousEntryId: null },
			hash: { stored: e2.hash, previousHash: e1.hash, status: "reproduced" },
			appendLink: { resolution: "derived", predecessorId: e1.id },
		});
		// The cross-employee stored ID is preserved but not followed into the owner's history.
		expect(byId.get(peerEntry.id)).toMatchObject({
			lineage: { previousEntryId: ownerOld.id },
			appendLink: { resolution: "unresolved", predecessorId: null },
		});
		expect(byId.has(ownerOld.id)).toBe(false);

		const records: { employeeId: string; assurance: { scope: string } }[] = await read(
			"evidence/append-assurance.json",
		);
		expect(records.map((record) => record.employeeId).toSorted()).toEqual(
			[ids.worker, ids.peer].toSorted(),
		);
		expect(records.every((record) => !("entries" in record))).toBe(true);
		expect(
			Object.fromEntries(records.map((record) => [record.employeeId, record.assurance.scope])),
		).toEqual({ [ids.worker]: "whole_history", [ids.peer]: "none" });
		const scope = await read("meta/scope.json");
		expect(scope.appendAssurance).toEqual({
			employeeCount: 2,
			wholeHistory: 1,
			postAnchor: 0,
			none: 1,
			limitations: [
				"derived_links",
				"hash_commits_event_fields_only",
				"lineage_unresolved",
				"no_continuity_position",
				"original_actor_and_capture_unproven",
				"payroll_readiness_not_assessed",
			],
		});
		expect(artifact.append_assurance).toEqual(scope.appendAssurance);
		expect(artifact.entry_count).toBe(4);
	});

	it("fails an audit pack honestly when required correction evidence is missing", async () => {
		const e1 = {
			...seedEntry(null, "clock_in", "2026-07-05T08:00:00Z"),
			replacesEntryId: "d3259999-0000-4000-8000-000000000000",
		};
		await insertEntries([e1]);

		const { outcome, request, artifact } = await generatePack({
			start: "2026-07-01T00:00:00Z",
			end: "2026-07-31T23:59:59Z",
		});

		expect(outcome).toBeInstanceOf(Error);
		expect(request).toEqual({ status: "failed", error_code: "lineage_broken" });
		expect(artifact).toBeUndefined();
	});

	it("keeps payroll readiness independent of an unrelated append defect", async () => {
		const e1 = seedEntry(null, "clock_in", "2026-07-01T08:00:00Z");
		const e2 = seedEntry(e1, "clock_out", "2026-07-01T16:00:00Z");
		await insertEntries([e1, e2]);
		const readiness = () =>
			getPayrollReadiness({
				organizationId: ids.organization,
				period: {
					start: DateTime.fromISO("2026-07-01T00:00:00Z", { zone: "utc" }),
					end: DateTime.fromISO("2026-07-31T00:00:00Z", { zone: "utc" }),
				},
				now: DateTime.fromISO("2026-08-01T00:00:00Z", { zone: "utc" }),
			});
		const before = await readiness();

		// A fork from e1 is an append defect, not a payroll evidence change.
		await insertEntries([seedEntry(e1, "clock_out", "2026-07-01T17:00:00Z")]);
		const report = (await verifyAs(ids.ownerUser, { employeeId: ids.worker })).body.assurance;
		expect(report.lineage.issues).toContainEqual(
			expect.objectContaining({ kind: "fork", predecessorId: e1.id }),
		);

		expect(await readiness()).toEqual(before);
	});
});
