/**
 * #1408 (spec #1307): document requests at departure, retention and purge,
 * against a disposable PostgreSQL database. Departures and rehires go through
 * the real lifecycle commands; requests through the real request store;
 * purges through the officer-confirmed purge; the automatic deletion of
 * requests without documents through its job. Notification delivery is
 * replaced.
 */

import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { CreateNotificationParams } from "@/lib/notifications/types";

const harness = vi.hoisted(() => ({ notifications: [] as CreateNotificationParams[] }));

vi.mock("@/lib/notifications/notification-service", () => ({
	createNotification: async (params: CreateNotificationParams) => {
		harness.notifications.push(params);
		return null;
	},
}));

vi.setConfig({ testTimeout: 60_000 });

const { db } = await import("@/db");
const { parseInstant } = await import("@/lib/datetime/temporal-core");
const { createDepartureCommands } = await import("@/lib/employee-lifecycle/commands");
const { createLifecycleDatabaseFixture } = await import(
	"@/lib/employee-lifecycle/testing/database.test.fixture"
);
const { resolvePersonnelFileAccess } = await import("./access-store");
const store = await import("./document-request-store");
const { linkDocumentRequestUpload } = await import("./document-request-uploads");
const { purgeDueDocuments, saveRetentionPeriods } = await import("./retention-store");
const { runDocumentRequestRetention } = await import("./document-request-retention");

type Fixture = Awaited<ReturnType<typeof createLifecycleDatabaseFixture>>;
type Seeded = Awaited<ReturnType<Fixture["seedEmployee"]>>;
type Instant = ReturnType<typeof parseInstant>;

const BERLIN = "Europe/Berlin";
const CREATED = parseInstant("2026-09-01T08:00:00Z");
const DEPARTED = parseInstant("2026-09-14T09:30:00Z");

let fixture: Fixture;
let now: Instant = CREATED;

function commands() {
	return createDepartureCommands({
		db: fixture.db,
		clock: { nowInstant: () => now },
		clockOut: {
			async close() {
				return { kind: "not_running" };
			},
		},
	});
}

async function accessOf(userId: string, at: Instant) {
	const access = await resolvePersonnelFileAccess(db, {
		userId,
		organizationId: fixture.organizationId,
		now: at,
	});
	if (!access) throw new Error(`${userId} has no personnel file access`);
	return access;
}

const ownerAccess = (at: Instant = CREATED) => accessOf(fixture.ownerUserId, at);

async function createRequest(
	employee: Seeded,
	input: { category?: "certificate" | "other"; title?: string; note?: string | null } = {},
) {
	const result = await store.createDocumentRequest(
		db,
		await ownerAccess(),
		{
			employeeId: employee.employeeId,
			category: input.category ?? "certificate",
			title: input.title ?? "First aid card",
			note: input.note === undefined ? "Bring the original" : input.note,
			deadline: "2026-09-30",
		},
		CREATED,
	);
	if (result.kind !== "created") throw new Error(`create failed: ${JSON.stringify(result)}`);
	return result.request.id;
}

let documentCounter = 0;

/** A shared document the employee uploaded from the request (not handed in yet). */
async function upload(employee: Seeded, requestId: string, category = "certificate") {
	documentCounter += 1;
	const id = randomUUID();
	await fixture.pool.query(
		`insert into employee_document
		 (id, organization_id, employee_id, category, title, document_date, visibility, storage_provider,
		  storage_bucket, storage_key, file_name, mime_type, size_bytes, checksum_sha256, uploaded_by)
		 values ($1,$2,$3,$4,$5,'2026-09-02','shared','s3-private','t1408',$7,'card.pdf',
		  'application/pdf',10,'x',$6)`,
		[
			id,
			fixture.organizationId,
			employee.employeeId,
			category,
			`Card ${documentCounter}`,
			employee.userId,
			`t1408/${id}`,
		],
	);
	await db.transaction((tx) =>
		linkDocumentRequestUpload(tx, {
			organizationId: fixture.organizationId,
			requestId,
			documentId: id,
			at: new Date("2026-09-02T08:00:00Z"),
		}),
	);
	return id;
}

async function submit(employee: Seeded, requestId: string, note: string | null) {
	const result = await store.submitDocumentRequest(
		db,
		await accessOf(employee.userId, CREATED),
		{ requestId, note },
		CREATED,
	);
	if (result.kind !== "submitted") throw new Error(`submit failed: ${JSON.stringify(result)}`);
}

async function returnRequest(requestId: string, reason: string) {
	const result = await store.returnDocumentRequest(
		db,
		await ownerAccess(),
		{ requestId, reason },
		CREATED,
	);
	if (result.kind !== "returned") throw new Error(`return failed: ${JSON.stringify(result)}`);
}

async function accept(requestId: string) {
	const result = await store.acceptDocumentRequest(db, await ownerAccess(), { requestId }, CREATED);
	if (result.kind !== "accepted") throw new Error(`accept failed: ${JSON.stringify(result)}`);
}

async function cancel(requestId: string, reason: string, at: Instant = CREATED) {
	const result = await store.cancelDocumentRequest(
		db,
		await accessOf(fixture.ownerUserId, at),
		{ requestId, reason },
		at,
	);
	if (result.kind !== "cancelled") throw new Error(`cancel failed: ${JSON.stringify(result)}`);
}

async function offboard(employee: Seeded, at: Instant = DEPARTED) {
	now = at;
	await commands().offboardNow(
		{ userId: fixture.ownerUserId, organizationId: fixture.organizationId },
		{
			employeeId: employee.employeeId,
			requestId: randomUUID(),
			replacementEmployeeId: null,
			acknowledgeUnassignedDuties: true,
		},
	);
	const departure = await fixture.pool.query<{ id: string; status: string }>(
		"select id, status from employee_departure where employee_id = $1 order by created_at desc limit 1",
		[employee.employeeId],
	);
	expect(departure.rows[0]?.status).toBe("effective");
	return departure.rows[0]?.id ?? "";
}

async function requestRow(id: string) {
	const result = await fixture.pool.query<{ status: string; version: number; note: string | null }>(
		"select status, version, note from employee_document_request where id = $1",
		[id],
	);
	return result.rows[0] ?? null;
}

async function events(requestId: string) {
	const result = await fixture.pool.query<{
		kind: string;
		reason: string | null;
		reason_code: string | null;
		actor_user_id: string | null;
		occurred_at: Date;
	}>(
		`select kind, reason, reason_code, actor_user_id, occurred_at
		 from employee_document_request_event where request_id = $1 order by occurred_at, id`,
		[requestId],
	);
	return result.rows;
}

async function submissionNotes(requestId: string) {
	const result = await fixture.pool.query<{ note: string | null }>(
		"select note from employee_document_request_submission where request_id = $1 order by submitted_at, id",
		[requestId],
	);
	return result.rows.map((row) => row.note);
}

async function requestAudits(requestId: string) {
	const result = await fixture.pool.query<{
		action: string;
		performed_by: string;
		metadata: string | null;
	}>(
		`select action, performed_by, metadata from audit_log
		 where entity_type = 'employee_document_request' and entity_id = $1 order by timestamp, id`,
		[requestId],
	);
	return result.rows.map((row) => ({
		action: row.action,
		performedBy: row.performed_by,
		metadata: row.metadata ? (JSON.parse(row.metadata) as Record<string, unknown>) : null,
	}));
}

beforeAll(async () => {
	fixture = await createLifecycleDatabaseFixture();
	await fixture.pool.query(
		"update organization set timezone = $2, personnel_files_enabled = true where id = $1",
		[fixture.organizationId, BERLIN],
	);
});

afterAll(async () => {
	await fixture.pool.query("delete from personnel_file_upload where organization_id = $1", [
		fixture.organizationId,
	]);
	await fixture?.close();
});

describe("departure", () => {
	it("cancels the employee's open and submitted requests silently, in the departure, and a rehire does not reopen them", async () => {
		const leaver = await fixture.seedEmployee();
		const colleague = await fixture.seedEmployee();
		const open = await createRequest(leaver, { title: "Open" });
		const submitted = await createRequest(leaver, { title: "Submitted" });
		const submittedDocument = await upload(leaver, submitted);
		await submit(leaver, submitted, "Front and back");
		const accepted = await createRequest(leaver, { title: "Accepted" });
		await upload(leaver, accepted);
		await submit(leaver, accepted, null);
		await accept(accepted);
		const cancelled = await createRequest(leaver, { title: "Cancelled" });
		await cancel(cancelled, "Not needed");
		const colleagues = await createRequest(colleague, { title: "Colleague" });
		const before = {
			accepted: await requestRow(accepted),
			cancelled: await requestRow(cancelled),
			colleagues: await requestRow(colleagues),
		};
		harness.notifications.length = 0;

		const departureId = await offboard(leaver);

		for (const id of [open, submitted]) {
			expect(await requestRow(id)).toMatchObject({ status: "cancelled" });
			expect((await events(id)).at(-1)).toEqual({
				kind: "cancelled",
				reason: null,
				reason_code: "employment_ended",
				actor_user_id: fixture.ownerUserId,
				occurred_at: new Date(DEPARTED.epochMilliseconds),
			});
			expect((await requestAudits(id)).at(-1)).toMatchObject({
				action: "personnel_file.document_request_cancelled",
				performedBy: fixture.ownerUserId,
				metadata: {
					status: { to: "cancelled" },
					reasonCode: "employment_ended",
					departureId,
					employmentPeriodId: leaver.employmentPeriodId,
				},
			});
		}
		expect(await requestRow(accepted)).toEqual(before.accepted);
		expect(await requestRow(cancelled)).toEqual(before.cancelled);
		expect(await requestRow(colleagues)).toEqual(before.colleagues);
		// The uploaded documents stay in the file under retention.
		const kept = await fixture.pool.query("select 1 from employee_document where id = $1", [
			submittedDocument,
		]);
		expect(kept.rows).toHaveLength(1);
		expect(
			harness.notifications.filter((n) => n.type.startsWith("personnel_file_document_request")),
		).toEqual([]);

		const policy = await fixture.pool.query<{ id: string }>(
			`insert into work_policy (organization_id, name, created_by, updated_at)
			 values ($1, $2, $3, now()) returning id`,
			[fixture.organizationId, `Policy ${randomUUID()}`, fixture.ownerUserId],
		);
		now = parseInstant("2026-11-02T08:00:00Z");
		await commands().rehireEmployee(
			{ userId: fixture.ownerUserId, organizationId: fixture.organizationId },
			{
				employeeId: leaver.employeeId,
				requestId: randomUUID(),
				previousEmploymentPeriodId: leaver.employmentPeriodId,
				role: "employee",
				teamId: null,
				primaryManagerId: fixture.ownerEmployeeId,
				workPolicyId: policy.rows[0]?.id ?? "",
				weeklyContractMinutes: 2400,
				contractType: "fixed",
				workModel: "onsite",
				hourlyRate: null,
				currency: "EUR",
				probationStartsOn: null,
				probationEndsOn: null,
				changeReason: "Returning",
			},
		);

		expect(await requestRow(open)).toMatchObject({ status: "cancelled" });
		expect(await requestRow(submitted)).toMatchObject({ status: "cancelled" });
	});
});

/** The leaver's documents (dated 2026, employment ended 2026) are due on 2028-01-01. */
const PURGE_DAY = parseInstant("2028-01-05T09:00:00Z");

async function retainCertificatesOneYear() {
	const saved = await saveRetentionPeriods(db, {
		organizationId: fixture.organizationId,
		actorUserId: fixture.ownerUserId,
		periods: { certificate: 1 },
	});
	expect(saved.kind).toBe("saved");
}

async function purge(documentIds: string[]) {
	return purgeDueDocuments(db, await ownerAccess(PURGE_DAY), { documentIds }, PURGE_DAY);
}

const FREE_TEXT_KEYS = ["note", "reason", "submissionNote"];

function freeTextIn(metadata: Record<string, unknown> | null): string[] {
	if (!metadata) return [];
	const request = (metadata.request ?? {}) as Record<string, unknown>;
	return [
		...FREE_TEXT_KEYS.filter((key) => metadata[key] !== undefined),
		...(request.note !== undefined ? ["request.note"] : []),
	];
}

describe("purge", () => {
	it("removes a request's note, return reasons and submission notes when one of its documents is purged, and deletes it once all are", async () => {
		await retainCertificatesOneYear();
		const leaver = await fixture.seedEmployee();
		const request = await createRequest(leaver, { note: "Bring the original" });
		const first = await upload(leaver, request);
		await submit(leaver, request, "Front page only");
		await returnRequest(request, "The back page is missing");
		const second = await upload(leaver, request);
		await submit(leaver, request, "Now both pages");
		await accept(request);
		const other = await createRequest(leaver, { title: "Other card", note: "Second card" });
		const otherFirst = await upload(leaver, other);
		const otherSecond = await upload(leaver, other);
		await submit(leaver, other, "Two cards");
		await accept(other);
		await offboard(leaver);
		const auditOf = async (id: string, action: string) =>
			(await requestAudits(id)).find((audit) => audit.action === action)?.metadata ?? null;
		expect(freeTextIn(await auditOf(request, "personnel_file.document_request_created"))).toEqual([
			"request.note",
		]);
		expect(freeTextIn(await auditOf(request, "personnel_file.document_request_returned"))).toEqual([
			"reason",
		]);

		const firstPurge = await purge([first, otherFirst]);

		expect(firstPurge.purged.toSorted()).toEqual([first, otherFirst].toSorted());
		for (const id of [request, other]) {
			expect(await requestRow(id)).toMatchObject({ status: "accepted", note: null });
			expect((await events(id)).map((event) => event.reason)).toEqual(
				(await events(id)).map(() => null),
			);
			expect(await submissionNotes(id)).toEqual((await submissionNotes(id)).map(() => null));
			const audits = await requestAudits(id);
			expect(audits.length).toBeGreaterThan(0);
			for (const audit of audits) expect(freeTextIn(audit.metadata)).toEqual([]);
		}
		// The history stays (all events share the seeding instant, so compare as a set).
		expect((await events(request)).map((event) => event.kind).toSorted()).toEqual([
			"accepted",
			"created",
			"returned",
			"submitted",
			"submitted",
		]);
		expect(await auditOf(request, "personnel_file.document_request_returned")).toMatchObject({
			status: { from: "submitted", to: "open" },
			descriptionsRemoved: true,
		});

		// The last document of the request goes: the request goes with it.
		const secondPurge = await purge([second]);

		expect(secondPurge.purged).toEqual([second]);
		expect(await requestRow(request)).toBeNull();
		expect(await events(request)).toEqual([]);
		expect(await submissionNotes(request)).toEqual([]);
		const audits = await requestAudits(request);
		expect(audits.at(-1)).toMatchObject({
			action: "personnel_file.document_request_deleted",
			performedBy: fixture.ownerUserId,
			metadata: { request: { category: "certificate" }, deletion: "documents_purged" },
		});
		for (const audit of audits) expect(freeTextIn(audit.metadata)).toEqual([]);
		// The other request still has a document in the file.
		expect(await requestRow(other)).toMatchObject({ status: "accepted" });
		expect(otherSecond).toBeTruthy();
	});
});

describe("requests without documents", () => {
	const runRetention = (at: string) =>
		runDocumentRequestRetention(db, {
			now: parseInstant(at),
			organizationIds: [fixture.organizationId],
		});

	it("deletes a closed request without documents once its category's retention period has passed since its retention start", async () => {
		await retainCertificatesOneYear();
		const leaver = await fixture.seedEmployee();
		const colleague = await fixture.seedEmployee();
		// Cancelled at the departure (2026): retention start 2027-01-01, due 2028-01-01.
		const atDeparture = await createRequest(leaver, { note: "Please hurry" });
		// 'other' has no retention period: never due.
		const unretained = await createRequest(leaver, { category: "other", title: "ID copy" });
		// Closed in 2027, after the employment ended: retention start 2028-01-01, due 2029-01-01.
		const closedLater = await createRequest(leaver, { title: "Closed later" });
		await cancel(closedLater, "Not needed");
		await fixture.pool.query(
			`update employee_document_request_event set occurred_at = '2027-03-01T10:00:00Z'
			 where request_id = $1 and kind = 'cancelled'`,
			[closedLater],
		);
		// Still employed: no retention start.
		const ofColleague = await createRequest(colleague, { title: "Colleague" });
		await cancel(ofColleague, "Not needed");
		await offboard(leaver);
		// An active request is never deleted by retention, whatever the dates say.
		const stillOpen = await createRequest(colleague, { title: "Still open" });
		await fixture.pool.query(
			"update employee_document_request set employee_id = $2 where id = $1",
			[stillOpen, leaver.employeeId],
		);
		const kept = [unretained, closedLater, ofColleague, stillOpen];

		// 2027-12-31 23:59 in Berlin: not due yet.
		expect(await runRetention("2027-12-31T22:59:00Z")).toMatchObject({ deleted: 0 });
		expect(await requestRow(atDeparture)).toMatchObject({ status: "cancelled" });

		// 2028-01-01 00:00 in Berlin: due.
		expect(await runRetention("2027-12-31T23:00:00Z")).toMatchObject({ deleted: 1 });
		expect(await requestRow(atDeparture)).toBeNull();
		expect(await events(atDeparture)).toEqual([]);
		const audits = await requestAudits(atDeparture);
		expect(audits.map((audit) => audit.action).toSorted()).toEqual([
			"personnel_file.document_request_cancelled",
			"personnel_file.document_request_created",
		]);
		for (const audit of audits) expect(freeTextIn(audit.metadata)).toEqual([]);
		for (const id of kept) expect(await requestRow(id)).not.toBeNull();

		expect(await runRetention("2028-06-01T08:00:00Z")).toMatchObject({ deleted: 0 });
		expect(await runRetention("2029-01-01T08:00:00Z")).toMatchObject({ deleted: 1 });
		expect(await requestRow(closedLater)).toBeNull();
		for (const id of [unretained, ofColleague, stillOpen]) {
			expect(await requestRow(id)).not.toBeNull();
		}
	});
});
