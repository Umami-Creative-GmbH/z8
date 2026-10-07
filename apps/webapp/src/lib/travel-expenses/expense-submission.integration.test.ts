/**
 * #295 / T31 runtime evidence: frozen expense submissions and receipt content identity.
 *
 * Local contract: pnpm --filter webapp test:approval-workflow-repository:integration
 * The runner creates, migrates, verifies, and removes a label-owned PostgreSQL 16 database.
 *
 * No server action submits a legacy claim any more (#621); claims are seeded and
 * submitted through the historical submission writers. The real approve server
 * action, the real receipt upload route and the real cleanup worker run against
 * that database. Only the session, e-mail/notification delivery and object
 * storage are replaced; storage is an in-memory bucket so late uploads, failed
 * deletes and versions are observable.
 */

import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { integrationAdminPool } from "@/test/integration-database";

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

vi.mock("next/headers", async () => (await import("@/test/integration-harness")).nextHeaders());

vi.mock("next/server", async (importOriginal) =>
	(await import("@/test/integration-harness")).nextServer(importOriginal),
);

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

const { approveTravelExpenseClaim } = await import("@/app/[locale]/(app)/travel-expenses/actions");
const { insertLegacyTravelExpenseDraft, submitLegacyTravelExpenseClaim } = await import(
	"./__tests__/legacy-claim"
);
const { POST: processUpload } = await import("@/app/api/upload/travel-expense/process/route");
const { db } = await import("@/db");
const {
	markTravelExpenseReceiptUploadFailed,
	runTravelExpenseReceiptCleanup,
	stageTravelExpenseReceiptUpload,
} = await import("./receipt-upload");
const { deleteApproval, listApprovals } = await import("@/lib/approvals/maintenance");
const { loadLegacyTravelExpenseSubmittedRevision } = await import("@/lib/approvals/evidence/store");
const { createOwnedTusFileKey } = await import("@/lib/upload/tus-ownership");
const { instantFromDate, systemClock } = await import("@/lib/datetime/temporal-core");

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

describe("expense submission evidence (PostgreSQL)", () => {
	const admin = integrationAdminPool();

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

	const requester = {
		organizationId: ids.organization,
		employeeId: ids.requester,
		userId: ids.requesterUser,
	};

	function createDraft(input: { amount?: string } = {}): Promise<string> {
		return insertLegacyTravelExpenseDraft(db, {
			...requester,
			...(input.amount ? { amount: input.amount } : {}),
			notes: "Private note that is never copied into evidence",
		});
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

	function submit(claimId: string) {
		return submitLegacyTravelExpenseClaim(db, { ...requester, claimId });
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
	});

	it("freezes logical dates, money pairs and a content-identified receipt manifest with the historical submission", async () => {
		await seed();
		const claimId = await createDraft();
		const first = await upload(claimId, PDF_BYTES, "hotel.pdf");
		const second = await upload(claimId, OTHER_PDF_BYTES, "train.pdf");
		expect([first.status, second.status]).toEqual([200, 200]);
		expect(harness.publicObjects.size).toBe(0);

		const result = await submit(claimId);
		expect(result.status).toBe("submitted");

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
			expect(submitted.status).toBe("submitted");
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
		expect((await racingSubmit).status).toBe("submitted");
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
		expect((await firstSubmit).status).toBe("submitted");
		expect((await lateUpload).status).toBe(409);
		expect((await revisionRow(submittedFirst)).facts.receipts.manifest).toHaveLength(1);
		expect((await claimState(submittedFirst)).attachments).toBe(1);
		expect(await stagedUploads()).toEqual([]);
	});

	it("holds decisions after the frozen receipt set changes and decides the unchanged claim", async () => {
		await seed();
		const claimId = await createDraft();
		expect((await upload(claimId)).status).toBe(200);
		expect((await submit(claimId)).status).toBe("submitted");
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

		expect((await submit(claimId)).status).toBe("approved");

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
		expect((await submit(claimId)).status).toBe("submitted");
		const other = await createDraft({ amount: "15.00" });
		expect((await upload(other)).status).toBe(200);
		expect((await submit(other)).status).toBe("submitted");
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

	it("re-records an upload that stores its object after cleanup swept it as abandoned", async () => {
		await seed();
		const claimId = await createDraft();
		const now = systemClock.nowInstant();
		const slow = {
			attachmentId: "e2952000-0000-4000-8000-000000000004",
			organizationId: ids.organization,
			claimId,
			uploadedBy: ids.requester,
			storageKey: `travel-expenses/${ids.organization}/${claimId}/slow.pdf`,
		};
		await stageTravelExpenseReceiptUpload(db, slow, now.subtract({ hours: 2 }));
		// The sweep finds nothing stored yet and settles the row.
		const swept = await runTravelExpenseReceiptCleanup(db, {
			now,
			deleteObject: async () => undefined,
		});
		expect(swept).toMatchObject({ claimed: 1, deleted: 1 });
		expect(await stagedUploads()).toEqual([]);

		// The slow upload then stores its object and fails to finalize.
		harness.privateObjects.set(slow.storageKey, { bytes: PDF_BYTES, versionId: "v-slow" });
		await markTravelExpenseReceiptUploadFailed(db, {
			...slow,
			stored: { bucket: "t295-private", versionId: "v-slow" },
			reason: "finalization_failed",
		});
		expect(only(await stagedUploads())).toMatchObject({
			status: "cleanup_required",
			reason: "finalization_failed",
			storage_version_id: "v-slow",
		});

		const recovered = await runTravelExpenseReceiptCleanup(db, {
			deleteObject: async (input) => {
				expect(input.versionId).toBe("v-slow");
				harness.privateObjects.delete(input.key);
			},
		});
		expect(recovered).toMatchObject({ claimed: 1, deleted: 1 });
		expect(harness.privateObjects.has(slow.storageKey)).toBe(false);
		expect(await stagedUploads()).toEqual([]);
	});
});
