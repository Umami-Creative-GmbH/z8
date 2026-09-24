/**
 * #295 / T31 runtime evidence: frozen expense submissions and receipt content identity.
 *
 * Local contract: pnpm --filter webapp test:approval-workflow-repository:integration
 * The runner creates, migrates, verifies, and removes a label-owned PostgreSQL 16 database.
 *
 * The real draft/submit/approve server actions, the real receipt upload route and
 * the real cleanup worker run against that database. Only the session, e-mail/
 * notification delivery and object storage are replaced; storage is an
 * in-memory bucket so late uploads, failed deletes and versions are observable.
 */

import { createHash } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
	resolveApprovalWorkflowRepositoryTestConfiguration,
	verifyApprovalWorkflowRepositoryTestDatabase,
} from "@/lib/approvals/workflow/repository-integration-harness";

const harness = vi.hoisted(() => ({
	userId: null as string | null,
	organizationId: null as string | null,
	notifications: [] as string[],
	privateObjects: new Map<string, { bytes: Buffer; versionId: string }>(),
	publicObjects: new Map<string, Uint8Array>(),
	versionCounter: 0,
	beforePrivatePut: null as null | (() => Promise<void>),
	deleteFailure: null as Error | null,
	deletedPrivate: [] as Array<{ key: string; versionId: string | null }>,
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
	connection: async () => undefined,
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
								id: `session-${harness.userId}`,
								userId: harness.userId,
								activeOrganizationId: harness.organizationId,
							},
						}
					: null,
		},
	},
}));

vi.mock("@/lib/notifications/triggers", async (importOriginal) => {
	const original = await importOriginal<typeof import("@/lib/notifications/triggers")>();
	return {
		...original,
		onTravelExpenseApproved: async () => {
			harness.notifications.push("approved");
		},
		onTravelExpenseRejected: async () => {
			harness.notifications.push("rejected");
		},
	};
});

vi.mock("@/lib/storage/s3-client", () => ({
	S3_PUBLIC_BUCKET: "t295-public",
	s3Client: {
		send: async (command: { constructor: { name: string }; input: { Key: string } }) => {
			const key = command.input.Key;
			if (command.constructor.name === "GetObjectCommand") {
				const bytes = harness.publicObjects.get(key);
				if (!bytes) throw new Error(`NoSuchKey ${key}`);
				return {
					ContentLength: bytes.length,
					Body: { transformToByteArray: async () => bytes },
				};
			}
			if (command.constructor.name === "DeleteObjectCommand") {
				harness.publicObjects.delete(key);
				return {};
			}
			throw new Error(`Unexpected public storage command ${command.constructor.name}`);
		},
	},
}));

vi.mock("@/lib/storage/export-s3-client", () => ({
	uploadPrivateObject: async (_organizationId: string, key: string, data: Buffer) => {
		await harness.beforePrivatePut?.();
		harness.versionCounter += 1;
		const versionId = `v${harness.versionCounter}`;
		harness.privateObjects.set(key, { bytes: Buffer.from(data), versionId });
		return { bucket: "t295-private", versionId };
	},
	deletePrivateObject: async (input: {
		key: string;
		bucket: string | null;
		versionId: string | null;
	}) => {
		if (harness.deleteFailure) throw harness.deleteFailure;
		if (input.bucket !== null && input.bucket !== "t295-private") {
			throw new Error("wrong bucket");
		}
		harness.deletedPrivate.push({ key: input.key, versionId: input.versionId });
		harness.privateObjects.delete(input.key);
	},
}));

const { createTravelExpenseDraft, submitTravelExpenseClaim, approveTravelExpenseClaim } =
	await import("@/app/[locale]/(app)/travel-expenses/actions");
const { POST: processUpload } = await import("@/app/api/upload/travel-expense/process/route");
const { db } = await import("@/db");
const { runTravelExpenseReceiptCleanup, stageTravelExpenseReceiptUpload } = await import(
	"./receipt-upload"
);
const { deleteApproval, listApprovals } = await import("@/lib/approvals/maintenance");
const { loadLegacyTravelExpenseSubmittedRevision } = await import("@/lib/approvals/evidence/store");
const { createOwnedTusFileKey } = await import("@/lib/upload/tus-ownership");
const { instantFromDate, systemClock } = await import("@/lib/datetime/temporal-core");

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
	describe.skip(`expense submission evidence PostgreSQL unavailable: ${integrationConfiguration.reason}`, () => {
		it("requires the label-owned disposable PostgreSQL runner", () => {});
	});
}

const ids = {
	organization: "t295-expense-org",
	otherOrganization: "t295-other-org",
	requesterUser: "t295-requester-user",
	managerUser: "t295-manager-user",
	otherUser: "t295-other-user",
	requester: "e2950000-0000-4000-8000-000000000001",
	manager: "e2950000-0000-4000-8000-000000000002",
	otherEmployee: "e2950000-0000-4000-8000-000000000003",
	managerLink: "e2951000-0000-4000-8000-000000000001",
} as const;

const PDF_BYTES = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n", "utf8");
const OTHER_PDF_BYTES = Buffer.from("%PDF-1.4\n2 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n", "utf8");

function sha256(value: Buffer): string {
	return createHash("sha256").update(value).digest("hex");
}

function only<T>(rows: readonly T[]): T {
	const [row] = rows;
	if (rows.length !== 1 || row === undefined) {
		throw new Error(`Expected exactly one row, received ${rows.length}`);
	}
	return row;
}

describeIntegration("expense submission evidence (PostgreSQL)", () => {
	const admin = new Pool({ connectionString: databaseUrl, max: 4 });

	function actAs(userId: string, organizationId: string = ids.organization) {
		harness.userId = userId;
		harness.organizationId = organizationId;
	}

	async function cleanup() {
		await admin.query(
			"delete from travel_expense_receipt_upload where organization_id = any($1::text[])",
			[[ids.organization, ids.otherOrganization]],
		);
		await admin.query("delete from organization where id = any($1::text[])", [
			[ids.organization, ids.otherOrganization],
		]);
		await admin.query('delete from "user" where id = any($1::text[])', [
			[ids.requesterUser, ids.managerUser, ids.otherUser],
		]);
	}

	async function seed(options: { capture?: boolean; requesterSelfApproves?: boolean } = {}) {
		await cleanup();
		const timestamp = new Date("2026-07-01T00:00:00Z");
		await admin.query(
			`insert into organization (id, name, slug, created_at, timezone) values
			 ($1, 'T295 expenses', $1, $3, 'Europe/Berlin'), ($2, 'T295 other', $2, $3, 'UTC')`,
			[ids.organization, ids.otherOrganization, timestamp],
		);
		await admin.query(
			`insert into "user" (id, name, email, created_at, updated_at) values
			 ($1, 'Avery Requester', 't295-requester@example.test', $4, $4),
			 ($2, 'Morgan Manager', 't295-manager@example.test', $4, $4),
			 ($3, 'Olive Other', 't295-other@example.test', $4, $4)`,
			[ids.requesterUser, ids.managerUser, ids.otherUser, timestamp],
		);
		await admin.query(
			`insert into member (id, organization_id, user_id, role, status, created_at)
			 select 't295-member-' || user_id, $1, user_id, 'member', 'approved', $2
			 from unnest($3::text[]) as user_id`,
			[ids.organization, timestamp, [ids.requesterUser, ids.managerUser]],
		);
		await admin.query(
			`insert into member (id, organization_id, user_id, role, status, created_at)
			 values ('t295-member-other', $1, $2, 'member', 'approved', $3)`,
			[ids.otherOrganization, ids.otherUser, timestamp],
		);
		await admin.query(
			`insert into employee (id, user_id, organization_id, role, updated_at) values
			 ($1, $2, $7, $9, $8), ($3, $4, $7, 'manager', $8), ($5, $6, $10, 'manager', $8)`,
			[
				ids.requester,
				ids.requesterUser,
				ids.manager,
				ids.managerUser,
				ids.otherEmployee,
				ids.otherUser,
				ids.organization,
				timestamp,
				options.requesterSelfApproves ? "manager" : "employee",
				ids.otherOrganization,
			],
		);
		await admin.query(
			`insert into employee_managers
			 (id, employee_id, manager_id, is_primary, assigned_by, assigned_at, created_at)
			 values ($1, $2, $3, true, $4, $5, $5)`,
			[
				ids.managerLink,
				ids.requester,
				options.requesterSelfApproves ? ids.requester : ids.manager,
				ids.managerUser,
				timestamp,
			],
		);
		if (options.capture !== false) await enableCapture();
	}

	async function enableCapture() {
		await admin.query(
			`insert into approval_evidence_control (organization_id, workflow_type, mode)
			 values ($1, 'travel_expense', 'capture')
			 on conflict (organization_id, workflow_type) do update set mode = excluded.mode`,
			[ids.organization],
		);
	}

	async function createDraft(
		input: Partial<{
			type: "receipt" | "mileage";
			amount: string;
			tripStart: string;
			tripEnd: string;
		}> = {},
	): Promise<string> {
		actAs(ids.requesterUser);
		const result = await createTravelExpenseDraft({
			type: input.type ?? "receipt",
			tripStart: input.tripStart ?? "2026-03-29",
			tripEnd: input.tripEnd ?? "2026-03-31",
			destinationCity: "Hamburg",
			destinationCountry: "DE",
			originalCurrency: "EUR",
			originalAmount: input.amount ?? "120.50",
			calculatedCurrency: "EUR",
			calculatedAmount: input.amount ?? "120.50",
			notes: "Private note that is never copied into evidence",
		});
		if (!result.success) throw new Error(`Draft failed: ${result.error}`);
		return result.data.id;
	}

	async function upload(claimId: string, bytes: Buffer = PDF_BYTES, fileName = "receipt.pdf") {
		actAs(ids.requesterUser);
		const tusFileKey = createOwnedTusFileKey(ids.requesterUser);
		harness.publicObjects.set(tusFileKey, new Uint8Array(bytes));
		const response = await processUpload({
			json: async () => ({ tusFileKey, claimId, fileName }),
		} as never);
		return { status: response.status, body: await response.json(), tusFileKey };
	}

	async function submit(claimId: string) {
		actAs(ids.requesterUser);
		return submitTravelExpenseClaim({ claimId });
	}

	async function claimState(claimId: string) {
		const { rows } = await admin.query<{
			status: string;
			submitted_at: Date | null;
			decided_at: Date | null;
			trip_start_date: string | null;
			trip_end_date: string | null;
			trip_date_time_zone: string | null;
			requests: number;
			revisions: number;
			attachments: number;
		}>(
			`select claim.status, claim.submitted_at, claim.decided_at,
			   claim.trip_start_date::text, claim.trip_end_date::text, claim.trip_date_time_zone,
			   (select count(*)::int from approval_request r
			      where r.organization_id = claim.organization_id and r.entity_id = claim.id) as requests,
			   (select count(*)::int from approval_submitted_revision s
			      where s.organization_id = claim.organization_id and s.source_id = claim.id) as revisions,
			   (select count(*)::int from travel_expense_attachment a
			      where a.claim_id = claim.id) as attachments
			 from travel_expense_claim claim where claim.id = $1`,
			[claimId],
		);
		return only(rows);
	}

	async function revisionRow(claimId: string) {
		const { rows } = await admin.query(
			`select * from approval_submitted_revision
			 where organization_id = $1 and source_type = 'travel_expense_claim' and source_id = $2`,
			[ids.organization, claimId],
		);
		return only(rows);
	}

	async function stagedUploads() {
		const { rows } = await admin.query(
			`select * from travel_expense_receipt_upload where organization_id = $1 order by created_at, id`,
			[ids.organization],
		);
		return rows;
	}

	async function holdClaimLock(claimId: string): Promise<PoolClient> {
		const holder = await admin.connect();
		await holder.query("begin");
		await holder.query("select id from travel_expense_claim where id = $1 for update", [claimId]);
		return holder;
	}

	async function waitForLockWaiters(count: number) {
		for (let attempt = 0; attempt < 400; attempt += 1) {
			const { rows } = await admin.query<{ waiters: number }>(
				`select count(*)::int as waiters from pg_stat_activity
				 where datname = current_database() and wait_event_type = 'Lock'`,
			);
			if ((rows[0]?.waiters ?? 0) >= count) return;
			await new Promise((resolve) => setTimeout(resolve, 25));
		}
		throw new Error(`Expected ${count} blocked sessions`);
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
			throw new Error("Expense submission evidence PostgreSQL is disabled");
		}
	});

	beforeEach(() => {
		harness.notifications = [];
		harness.privateObjects.clear();
		harness.publicObjects.clear();
		harness.beforePrivatePut = null;
		harness.deleteFailure = null;
		harness.deletedPrivate = [];
	});

	afterAll(async () => {
		await cleanup();
		await admin.end();
	});

	it("records entered logical trip dates on the draft even while capture is inactive", async () => {
		await seed({ capture: false });
		const claimId = await createDraft({ tripStart: "2026-03-29", tripEnd: "2026-03-31" });
		expect((await upload(claimId)).status).toBe(200);

		const result = await submit(claimId);

		expect(result).toEqual({ success: true, data: { status: "submitted" } });
		const state = await claimState(claimId);
		expect(state).toMatchObject({
			status: "submitted",
			trip_start_date: "2026-03-29",
			trip_end_date: "2026-03-31",
			trip_date_time_zone: "Europe/Berlin",
			requests: 1,
			revisions: 0,
		});
	});

	it("freezes logical dates, money pairs and a content-identified receipt manifest atomically with submission", async () => {
		await seed();
		const claimId = await createDraft();
		const first = await upload(claimId, PDF_BYTES, "hotel.pdf");
		const second = await upload(claimId, OTHER_PDF_BYTES, "train.pdf");
		expect([first.status, second.status]).toEqual([200, 200]);
		expect(harness.publicObjects.size).toBe(0);

		const result = await submit(claimId);
		expect(result).toEqual({ success: true, data: { status: "submitted" } });

		const state = await claimState(claimId);
		const revision = await revisionRow(claimId);
		const { rows: requests } = await admin.query(
			"select id, status from approval_request where organization_id = $1 and entity_id = $2",
			[ids.organization, claimId],
		);
		const request = only(requests);
		expect(revision).toMatchObject({
			authority: "legacy",
			workflow_id: null,
			legacy_approval_request_id: request.id,
			workflow_type: "travel_expense",
			source_type: "travel_expense_claim",
			request_cycle_key: `travel_expense_claim:${claimId}:submission`,
			revision: 1,
			subject_employee_id: ids.requester,
			requester_employee_id: ids.requester,
			submitter_actor_kind: "employee",
			submitter_employee_id: ids.requester,
			submitter_user_id: ids.requesterUser,
			provenance: "captured_at_submission",
		});
		expect(revision.submitted_at.toISOString()).toBe(state.submitted_at?.toISOString());
		expect(revision.material_fingerprint).toMatch(/^travel_expense:v1:[0-9a-f]{64}$/);
		expect(revision.facts.tripDates).toEqual({
			startDate: "2026-03-29",
			endDate: "2026-03-31",
			interpretation: { source: "entered_logical_dates", zone: "Europe/Berlin" },
		});
		expect(revision.facts.money).toEqual({
			original: { amount: "120.50", currency: "EUR" },
			calculated: { amount: "120.50", currency: "EUR" },
		});
		const manifest = revision.facts.receipts.manifest as Array<Record<string, unknown>>;
		expect(revision.facts.receipts.required).toBe(true);
		expect(manifest.map((item) => item.attachmentId)).toEqual(
			[first.body.attachment.id, second.body.attachment.id].sort(),
		);
		const hotel = manifest.find((item) => item.attachmentId === first.body.attachment.id);
		expect(hotel).toEqual({
			attachmentId: first.body.attachment.id,
			claimId,
			object: {
				provider: "s3-private",
				bucket: "t295-private",
				key: first.body.attachment.storageKey,
				versionId: harness.privateObjects.get(first.body.attachment.storageKey)?.versionId,
			},
			checksumSha256: sha256(PDF_BYTES),
			sizeBytes: PDF_BYTES.length,
			mimeType: "application/pdf",
		});
		// The server computed the checksum over the bytes it actually stored.
		expect(
			sha256(
				harness.privateObjects.get(first.body.attachment.storageKey)?.bytes ?? Buffer.alloc(0),
			),
		).toBe(hotel?.checksumSha256);
		expect(revision.labels).toEqual({
			subjectName: "Avery Requester",
			requesterName: "Avery Requester",
			submitterName: "Avery Requester",
			projectName: null,
			receiptFileNames: {
				[first.body.attachment.id]: "hotel.pdf",
				[second.body.attachment.id]: "train.pdf",
			},
		});
		expect(JSON.stringify(revision)).not.toContain("Private note");
		expect(await stagedUploads()).toEqual([]);

		// Organization scope: the same claim is invisible to another tenant.
		expect(
			await loadLegacyTravelExpenseSubmittedRevision(db, {
				organizationId: ids.otherOrganization,
				claimId,
			}),
		).toBeNull();
		await expect(
			admin.query("update approval_submitted_revision set revision = 2 where id = $1", [
				revision.id,
			]),
		).rejects.toThrow();
	});

	it("rejects an upload that finalizes after submission and deletes its stored object", async () => {
		await seed();
		const claimId = await createDraft();
		expect((await upload(claimId)).status).toBe(200);
		// Submission commits while the late upload's object is being stored.
		harness.beforePrivatePut = async () => {
			harness.beforePrivatePut = null;
			const submitted = await submit(claimId);
			expect(submitted.success).toBe(true);
		};

		const late = await upload(claimId, OTHER_PDF_BYTES, "late.pdf");

		expect(late.status).toBe(409);
		expect(late.body.error).toMatch(/no longer a draft/);
		const state = await claimState(claimId);
		expect(state).toMatchObject({ status: "submitted", attachments: 1, revisions: 1 });
		const manifest = (await revisionRow(claimId)).facts.receipts.manifest as unknown[];
		expect(manifest).toHaveLength(1);
		expect(harness.deletedPrivate).toHaveLength(1);
		expect([...harness.privateObjects.keys()]).toHaveLength(1);
		expect(await stagedUploads()).toEqual([]);
		expect(harness.publicObjects.size).toBe(0);
	});

	it("keeps rejected storage as recoverable cleanup work when the immediate delete fails", async () => {
		await seed();
		const claimId = await createDraft();
		expect((await upload(claimId)).status).toBe(200);
		harness.beforePrivatePut = async () => {
			harness.beforePrivatePut = null;
			await submit(claimId);
			harness.deleteFailure = new Error("storage unavailable");
		};

		expect((await upload(claimId, OTHER_PDF_BYTES, "late.pdf")).status).toBe(409);

		const [pending] = await stagedUploads();
		expect(pending).toMatchObject({
			status: "cleanup_required",
			reason: "claim_not_draft",
			storage_bucket: "t295-private",
			attempts: 1,
			last_error: "storage unavailable",
		});
		expect(harness.privateObjects.has(pending.storage_key)).toBe(true);

		harness.deleteFailure = null;
		const tooEarly = await runTravelExpenseReceiptCleanup(db, {
			deleteObject: async (input) => {
				harness.privateObjects.delete(input.key);
			},
		});
		expect(tooEarly.claimed).toBe(0);

		const later = instantFromDate(new Date(Date.now() + 2 * 60 * 1000));
		const recovered = await runTravelExpenseReceiptCleanup(db, {
			now: later,
			deleteObject: async (input) => {
				expect(input.versionId).toBe(pending.storage_version_id);
				harness.privateObjects.delete(input.key);
			},
		});
		expect(recovered).toEqual({ claimed: 1, deleted: 1, released: 0, failed: 0 });
		expect(harness.privateObjects.has(pending.storage_key)).toBe(false);
		expect(await stagedUploads()).toEqual([]);
		expect((await claimState(claimId)).attachments).toBe(1);
	});

	it("serializes upload finalization and submission on the claim row in both arrival orders", async () => {
		await seed();

		// Upload finalization first: the receipt is attached and frozen in the manifest.
		const attachedFirst = await createDraft();
		expect((await upload(attachedFirst)).status).toBe(200);
		let holder = await holdClaimLock(attachedFirst);
		const racingUpload = upload(attachedFirst, OTHER_PDF_BYTES, "racing.pdf");
		await waitForLockWaiters(1);
		const racingSubmit = submit(attachedFirst);
		await waitForLockWaiters(2);
		await holder.query("commit");
		holder.release();
		expect((await racingUpload).status).toBe(200);
		expect((await racingSubmit).success).toBe(true);
		expect((await revisionRow(attachedFirst)).facts.receipts.manifest).toHaveLength(2);

		// Submission first: the late upload is rejected and cleaned up.
		const submittedFirst = await createDraft();
		expect((await upload(submittedFirst)).status).toBe(200);
		holder = await holdClaimLock(submittedFirst);
		const firstSubmit = submit(submittedFirst);
		await waitForLockWaiters(1);
		const lateUpload = upload(submittedFirst, OTHER_PDF_BYTES, "late.pdf");
		await waitForLockWaiters(2);
		await holder.query("commit");
		holder.release();
		expect((await firstSubmit).success).toBe(true);
		expect((await lateUpload).status).toBe(409);
		expect((await revisionRow(submittedFirst)).facts.receipts.manifest).toHaveLength(1);
		expect((await claimState(submittedFirst)).attachments).toBe(1);
		expect(await stagedUploads()).toEqual([]);
	});

	it("rolls back the whole submission when evidence capture fails", async () => {
		await seed();
		const claimId = await createDraft();
		expect((await upload(claimId)).status).toBe(200);
		await admin.query(`
			create or replace function t295_fail_expense_revision() returns trigger language plpgsql as $$
			begin
				if new.workflow_type = 'travel_expense' then
					raise exception 't295 injected revision failure';
				end if;
				return new;
			end $$;
			create trigger t295_fail_expense_revision before insert on approval_submitted_revision
			for each row execute function t295_fail_expense_revision();
		`);
		try {
			const failed = await submit(claimId);
			expect(failed).toEqual({ success: false, error: "Failed to submit travel expense claim" });
			expect(await claimState(claimId)).toMatchObject({
				status: "draft",
				submitted_at: null,
				requests: 0,
				revisions: 0,
			});
		} finally {
			await admin.query(`
				drop trigger t295_fail_expense_revision on approval_submitted_revision;
				drop function t295_fail_expense_revision();
			`);
		}

		expect((await submit(claimId)).success).toBe(true);
		expect(await claimState(claimId)).toMatchObject({
			status: "submitted",
			requests: 1,
			revisions: 1,
		});
	});

	it("holds historical drafts without entered dates or receipt checksums instead of guessing", async () => {
		await seed();
		// A draft created before logical dates were captured: only synthetic bounds exist.
		const { rows } = await admin.query<{ id: string }>(
			`insert into travel_expense_claim
			 (organization_id, employee_id, type, status, trip_start, trip_end,
			  original_currency, original_amount, calculated_currency, calculated_amount,
			  created_by, updated_at)
			 values ($1, $2, 'receipt', 'draft', '2026-03-28T23:00:00Z', '2026-03-31T21:59:59.999Z',
			  'EUR', '10.00', 'EUR', '10.00', $3, now())
			 returning id`,
			[ids.organization, ids.requester, ids.requesterUser],
		);
		const legacyDates = only(rows).id;
		expect((await upload(legacyDates)).status).toBe(200);

		expect(await submit(legacyDates)).toEqual({
			success: false,
			error:
				"This claim was created before its trip dates were recorded as entered. Create a new claim to submit it.",
		});
		expect(await claimState(legacyDates)).toMatchObject({
			status: "draft",
			requests: 0,
			revisions: 0,
		});

		// A receipt uploaded before checksums were computed.
		const legacyReceipt = await createDraft();
		await admin.query(
			`insert into travel_expense_attachment
			 (claim_id, organization_id, storage_provider, storage_bucket, storage_key, file_name,
			  mime_type, size_bytes, uploaded_by)
			 values ($1, $2, 's3-private', 't295-private', 'travel-expenses/legacy/receipt.pdf',
			  'receipt.pdf', 'application/pdf', 10, $3)`,
			[legacyReceipt, ids.organization, ids.requester],
		);
		expect(await submit(legacyReceipt)).toEqual({
			success: false,
			error:
				"A receipt on this claim was uploaded before receipt content was verified. Create a new claim with the receipts to submit it.",
		});
		expect(await claimState(legacyReceipt)).toMatchObject({ status: "draft", requests: 0 });
	});

	it("requires receipts and ignores foreign-organization attachment rows", async () => {
		await seed();
		const missing = await createDraft();
		expect(await submit(missing)).toEqual({
			success: false,
			error: expect.stringMatching(/receipt/i),
		});
		expect((await claimState(missing)).status).toBe("draft");

		const claimId = await createDraft();
		const own = await upload(claimId);
		await admin.query(
			`insert into travel_expense_attachment
			 (claim_id, organization_id, storage_provider, storage_bucket, storage_key, file_name,
			  mime_type, size_bytes, checksum_sha256, uploaded_by)
			 values ($1, $2, 's3-private', 't295-private', 'travel-expenses/foreign/receipt.pdf',
			  'foreign.pdf', 'application/pdf', 10, $3, $4)`,
			[claimId, ids.otherOrganization, "c".repeat(64), ids.otherEmployee],
		);

		expect((await submit(claimId)).success).toBe(true);
		const manifest = (await revisionRow(claimId)).facts.receipts.manifest as Array<{
			attachmentId: string;
		}>;
		expect(manifest.map((item) => item.attachmentId)).toEqual([own.body.attachment.id]);

		// A mileage claim needs no receipt; its manifest is honestly empty.
		const mileage = await createDraft({ type: "mileage", amount: "30.00" });
		expect((await submit(mileage)).success).toBe(true);
		expect((await revisionRow(mileage)).facts.receipts).toEqual({ required: false, manifest: [] });
	});

	it("holds decisions after the frozen receipt set changes and decides the unchanged claim", async () => {
		await seed();
		const claimId = await createDraft();
		expect((await upload(claimId)).status).toBe(200);
		expect((await submit(claimId)).success).toBe(true);
		// A writer outside the upload route adds a receipt to the submitted claim.
		const { rows } = await admin.query<{ id: string }>(
			`insert into travel_expense_attachment
			 (claim_id, organization_id, storage_provider, storage_bucket, storage_key, file_name,
			  mime_type, size_bytes, checksum_sha256, uploaded_by)
			 values ($1, $2, 's3-private', 't295-private', 'travel-expenses/extra/receipt.pdf',
			  'extra.pdf', 'application/pdf', 10, $3, $4) returning id`,
			[claimId, ids.organization, "d".repeat(64), ids.requester],
		);

		actAs(ids.managerUser);
		const held = await approveTravelExpenseClaim({ claimId });
		expect(held).toMatchObject({
			success: false,
			error: expect.stringMatching(/changed after it was submitted/),
		});
		expect(await claimState(claimId)).toMatchObject({ status: "submitted" });
		const { rows: pending } = await admin.query(
			"select status from approval_request where organization_id = $1 and entity_id = $2",
			[ids.organization, claimId],
		);
		expect(only(pending).status).toBe("pending");
		expect(harness.notifications).toEqual([]);

		await admin.query("delete from travel_expense_attachment where id = $1", [only(rows).id]);
		const approved = await approveTravelExpenseClaim({ claimId });
		expect(approved).toEqual({ success: true, data: { status: "approved" } });
		expect(await claimState(claimId)).toMatchObject({ status: "approved", revisions: 1 });
	});

	it("records requester self-approval during submission as a system activation result", async () => {
		await seed({ requesterSelfApproves: true });
		const claimId = await createDraft();
		expect((await upload(claimId)).status).toBe(200);

		expect(await submit(claimId)).toEqual({ success: true, data: { status: "approved" } });

		const state = await claimState(claimId);
		const revision = await revisionRow(claimId);
		const { rows } = await admin.query(
			"select * from approval_decision_evidence where organization_id = $1 and submitted_revision_id = $2",
			[ids.organization, revision.id],
		);
		const activation = only(rows);
		expect(activation).toMatchObject({
			authority: "legacy",
			operation_kind: "submission_activation",
			action: "approve",
			request_outcome: "approved",
			actor_kind: "system",
			actor_employee_id: null,
			legacy_approval_request_id: revision.legacy_approval_request_id,
			receipt_idempotency_key: revision.request_cycle_key,
		});
		expect(activation.decided_at.toISOString()).toBe(state.decided_at?.toISOString());
		expect(activation.result).toMatchObject({
			claimStatus: "approved",
			decidedAtSource: "travel_expense_claim.decided_at",
		});
	});

	it("participates in privileged linked-lifecycle cleanup without touching the claim", async () => {
		await seed();
		const claimId = await createDraft();
		expect((await upload(claimId)).status).toBe(200);
		expect((await submit(claimId)).success).toBe(true);
		const other = await createDraft({ amount: "15.00" });
		expect((await upload(other)).status).toBe(200);
		expect((await submit(other)).success).toBe(true);
		const revision = await revisionRow(claimId);

		const listed = await listApprovals(db, ids.organization);
		expect(listed).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					storage_type: "legacy_evidence",
					id: revision.id,
					source_type: "travel_expense_claim",
					source_id: claimId,
				}),
			]),
		);

		const deleted = await deleteApproval(db, ids.organization, revision.legacy_approval_request_id);
		expect(deleted.evidence.submittedRevisions).toContain(revision.id);
		expect(await claimState(claimId)).toMatchObject({
			status: "submitted",
			revisions: 0,
			requests: 0,
		});
		expect(await claimState(other)).toMatchObject({ revisions: 1, requests: 1 });
	});

	it("deletes abandoned staged objects but never an attached one", async () => {
		await seed();
		const claimId = await createDraft();
		const attached = await upload(claimId);
		const now = systemClock.nowInstant();
		const stale = {
			attachmentId: "e2952000-0000-4000-8000-000000000001",
			organizationId: ids.organization,
			claimId,
			uploadedBy: ids.requester,
			storageKey: `travel-expenses/${ids.organization}/${claimId}/abandoned.pdf`,
		};
		await stageTravelExpenseReceiptUpload(db, stale, now.subtract({ hours: 2 }));
		harness.privateObjects.set(stale.storageKey, { bytes: PDF_BYTES, versionId: "va" });
		const fresh = {
			...stale,
			attachmentId: "e2952000-0000-4000-8000-000000000002",
			storageKey: `${stale.storageKey}.fresh`,
		};
		await stageTravelExpenseReceiptUpload(db, fresh, now.subtract({ minutes: 5 }));
		// A stale claim on a key that is attached must release, not delete.
		const attachedClaim = {
			...stale,
			attachmentId: "e2952000-0000-4000-8000-000000000003",
			storageKey: attached.body.attachment.storageKey,
		};
		await stageTravelExpenseReceiptUpload(db, attachedClaim, now.subtract({ hours: 3 }));

		const deletedKeys: string[] = [];
		const result = await runTravelExpenseReceiptCleanup(db, {
			now,
			deleteObject: async (input) => {
				deletedKeys.push(input.key);
				harness.privateObjects.delete(input.key);
			},
		});

		expect(result).toEqual({ claimed: 2, deleted: 1, released: 1, failed: 0 });
		expect(deletedKeys).toEqual([stale.storageKey]);
		expect(harness.privateObjects.has(attached.body.attachment.storageKey)).toBe(true);
		const remaining = await stagedUploads();
		expect(remaining.map((row) => row.id)).toEqual([fresh.attachmentId]);
		expect(only(remaining).status).toBe("pending");
	});
});
