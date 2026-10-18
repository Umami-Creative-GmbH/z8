/**
 * #1402 (spec #1307): the review loop of a document request, against a
 * disposable PostgreSQL database. The employee uploads through the real upload
 * route and submits, officers return or accept through the real server
 * actions. The session, notification delivery and object storage are replaced.
 */

import type { NextRequest } from "next/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { CreateNotificationParams } from "@/lib/notifications/types";
import { integrationAdminPool } from "@/test/integration-database";

const harness = vi.hoisted(() => ({
	userId: null as string | null,
	organizationId: "t1402-org",
	tus: new Map<string, Buffer>(),
	objects: new Map<string, Buffer>(),
	notifications: [] as CreateNotificationParams[],
}));

vi.mock("next/headers", async () => (await import("@/test/integration-harness")).nextHeaders());
vi.mock("next/server", async (original) =>
	(await import("@/test/integration-harness")).nextServer(original),
);
vi.mock("next/cache", async (original) =>
	(await import("@/test/integration-harness")).nextCache(original),
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
vi.mock("@/lib/notifications/notification-service", () => ({
	createNotification: async (params: CreateNotificationParams) => {
		harness.notifications.push(params);
		return null;
	},
}));
vi.mock("@/lib/storage/s3-client", () => ({
	S3_PUBLIC_BUCKET: "t1402-public",
	s3Client: {
		async send(command: { input: { Key: string } }) {
			if (command.constructor.name === "DeleteObjectCommand") {
				harness.tus.delete(command.input.Key);
				return {};
			}
			const bytes = harness.tus.get(command.input.Key);
			if (!bytes) throw new Error("NoSuchKey");
			return {
				ContentLength: bytes.length,
				Body: { transformToByteArray: async () => new Uint8Array(bytes) },
			};
		},
	},
}));
vi.mock("@/lib/storage/export-s3-client", () => ({
	async uploadPrivateObject(_organizationId: string, key: string, data: Uint8Array) {
		harness.objects.set(key, Buffer.from(data));
		return { bucket: "t1402-private", versionId: null };
	},
	async readPrivateObject(input: { key: string }) {
		const bytes = harness.objects.get(input.key);
		if (!bytes) throw Object.assign(new Error("NoSuchKey"), { name: "NoSuchKey" });
		return new Uint8Array(bytes);
	},
	async deletePrivateObject(input: { key: string }) {
		harness.objects.delete(input.key);
	},
	async deletePrivateObjectVersions(input: { key: string }) {
		harness.objects.delete(input.key);
	},
	async privateObjectExists(input: { key: string }) {
		return harness.objects.has(input.key);
	},
}));

vi.setConfig({ testTimeout: 60_000 });

const { POST: finalizeUpload } = await import("@/app/api/upload/personnel-file/route");
const requestActions = await import(
	"@/app/[locale]/(app)/personnel-files/document-request-actions"
);
const fileActions = await import("@/app/[locale]/(app)/personnel-files/actions");
const { db } = await import("@/db");
const { resolvePersonnelFileAccess } = await import("./access-store");
const { acceptDocumentRequest, returnDocumentRequest } = await import("./document-request-store");
const { seedPersonnelFileOfficerGrant, deactivateSeededPersonnelFileOfficerGrant } = await import(
	"./testing/officer-grant.test.fixture"
);
const { createOwnedTusFileKey } = await import("@/lib/upload/tus-ownership");

const ORG = "t1402-org";
const OTHER_ORG = "t1402-other";

const ids = {
	owner: "e1402000-0000-4000-8000-000000000001",
	admin: "e1402000-0000-4000-8000-000000000002",
	officer: "e1402000-0000-4000-8000-000000000003",
	anna: "e1402000-0000-4000-8000-000000000004",
	ben: "e1402000-0000-4000-8000-000000000005",
	stranger: "e1402000-0000-4000-8000-000000000006",
	berlin: "e1402100-0000-4000-8000-000000000001",
} as const;
type Person = "owner" | "admin" | "officer" | "anna" | "ben" | "stranger";
const userOf = (person: Person) => `t1402-${person}`;

const admin = integrationAdminPool();
let officerGrantId = "";
const pdf = (text: string) => Buffer.from(`%PDF-1.4\n% ${text}\n%%EOF`);

async function cleanup() {
	await admin.query("delete from organization where id = any($1)", [[ORG, OTHER_ORG]]);
	await admin.query("delete from personnel_file_upload where organization_id = any($1)", [
		[ORG, OTHER_ORG],
	]);
	await admin.query('delete from "user" where id like $1', ["t1402-%"]);
}

async function seedOrganization(id: string) {
	await admin.query(
		`insert into organization (id, name, slug, timezone, personnel_files_enabled, created_at)
		 values ($1, $1, $1, 'Europe/Berlin', true, now())`,
		[id],
	);
}

async function seedPerson(
	person: Person,
	displayName: string,
	memberRole: string,
	options: { organizationId?: string; teamId?: string | null } = {},
) {
	const organizationId = options.organizationId ?? ORG;
	await admin.query(
		'insert into "user" (id,name,email,created_at,updated_at) values ($1,$2,$3,now(),now())',
		[userOf(person), displayName, `${userOf(person)}@example.test`],
	);
	await admin.query(
		"insert into member (id,organization_id,user_id,role,status,created_at) values ($1,$2,$3,$4,'approved',now())",
		[`t1402-member-${person}`, organizationId, userOf(person), memberRole],
	);
	await admin.query(
		"insert into employee (id,user_id,organization_id,role,team_id,is_active,updated_at) values ($1,$2,$3,'employee',$4,true,now())",
		[ids[person], userOf(person), organizationId, options.teamId ?? null],
	);
}

async function seed() {
	await cleanup();
	await seedOrganization(ORG);
	await seedOrganization(OTHER_ORG);
	await admin.query(
		"insert into team (id, organization_id, name, updated_at) values ($1, $2, 'Berlin', now())",
		[ids.berlin, ORG],
	);
	await seedPerson("owner", "Olga Owner", "owner");
	await seedPerson("admin", "Adam Admin", "admin");
	await seedPerson("officer", "Otto Officer", "member");
	await seedPerson("anna", "Anna Example", "member", { teamId: ids.berlin });
	await seedPerson("ben", "Ben Example", "member", { teamId: ids.berlin });
	await seedPerson("stranger", "Sam Stranger", "owner", { organizationId: OTHER_ORG });
	// Otto covers Berlin's certificates only.
	officerGrantId = await seedPersonnelFileOfficerGrant(admin, {
		organizationId: ORG,
		officerEmployeeId: ids.officer,
		createdBy: userOf("owner"),
		teamIds: [ids.berlin],
		categories: ["certificate"],
	});
}

function signIn(person: Person, organizationId = ORG) {
	harness.userId = userOf(person);
	harness.organizationId = organizationId;
}

async function createRequest(
	person: Person,
	input: { employeeId?: string; category?: "certificate" | "other"; title?: string } = {},
): Promise<string> {
	signIn(person);
	const result = await requestActions.createDocumentRequestAction({
		employeeId: input.employeeId ?? ids.anna,
		category: input.category ?? "certificate",
		title: input.title ?? "First aid refresher",
		note: "Please upload the new card.",
		deadline: "2099-11-30",
	});
	if (!result.success) throw new Error(`create failed: ${result.error} (${result.code})`);
	return result.data.id;
}

async function uploadForRequest(input: {
	requestId: string;
	employeeId?: string;
	title?: string;
	category?: string;
}) {
	if (!harness.userId) throw new Error("not signed in");
	const tusFileKey = createOwnedTusFileKey(harness.userId);
	const title = input.title ?? "First aid card 2026";
	harness.tus.set(tusFileKey, pdf(title));
	return finalizeUpload(
		new Request("http://localhost/api/upload/personnel-file", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				tusFileKey,
				employeeId: input.employeeId ?? ids.anna,
				source: "own",
				documentRequestId: input.requestId,
				fileName: "card.pdf",
				metadata: {
					category: input.category ?? "certificate",
					title,
					documentDate: "2026-10-01",
					expiryDate: "2028-09-30",
				},
			}),
		}) as unknown as NextRequest,
	);
}

async function uploadedId(requestId: string, title?: string): Promise<string> {
	const response = await uploadForRequest({ requestId, ...(title ? { title } : {}) });
	const body = (await response.json()) as { document?: { id: string }; error?: string };
	if (response.status !== 200 || !body.document) {
		throw new Error(`upload failed: ${response.status} ${body.error}`);
	}
	return body.document.id;
}

/** Anna uploads one document for the request and submits it. */
async function submittedRequest(
	input: { creator?: Person; category?: "certificate" | "other" } = {},
): Promise<{ requestId: string; documentId: string; version: number }> {
	const requestId = await createRequest(input.creator ?? "officer", {
		...(input.category ? { category: input.category } : {}),
	});
	signIn("anna");
	const response = await uploadForRequest({
		requestId,
		...(input.category ? { category: input.category } : {}),
	});
	const body = (await response.json()) as { document?: { id: string }; error?: string };
	if (!body.document) throw new Error(`upload failed: ${body.error}`);
	const submitted = await requestActions.submitDocumentRequestAction({ requestId, note: null });
	if (!submitted.success) throw new Error(`submit failed: ${submitted.error}`);
	harness.notifications.length = 0;
	return { requestId, documentId: body.document.id, version: submitted.data.version };
}

async function myRequest(requestId: string) {
	signIn("anna");
	const mine = await requestActions.getMyDocumentRequestsAction();
	if (!mine.success) throw new Error(mine.error);
	const request = mine.data.find((entry) => entry.id === requestId);
	if (!request) throw new Error("request not listed");
	return request;
}

async function statusOf(requestId: string) {
	const { rows } = await admin.query<{ status: string }>(
		"select status from employee_document_request where id = $1",
		[requestId],
	);
	return rows[0]?.status;
}

async function documentCount(employeeId: string) {
	const { rows } = await admin.query<{ count: string }>(
		"select count(*) from employee_document where employee_id = $1",
		[employeeId],
	);
	return Number(rows[0]?.count);
}

function notified() {
	return harness.notifications
		.map((notification) => ({
			userId: notification.userId,
			type: notification.type,
			actionUrl: notification.actionUrl,
		}))
		.toSorted((a, b) => a.userId.localeCompare(b.userId));
}

describe("document requests: submit, return and accept (#1402)", () => {
	beforeAll(seed);
	afterAll(async () => {
		await cleanup();
		await admin.end();
	});
	beforeEach(async () => {
		harness.notifications.length = 0;
		await admin.query("delete from employee_document_request where organization_id = $1", [ORG]);
		await admin.query("delete from employee_document where organization_id = $1", [ORG]);
		await admin.query("update personnel_file_officer_grant set is_active = true where id = $1", [
			officerGrantId,
		]);
	});

	describe("upload and submit", () => {
		it("puts each upload from the request in the file as a shared document at once", async () => {
			const requestId = await createRequest("officer");
			signIn("anna");
			const first = await uploadedId(requestId, "First aid card");
			const second = await uploadedId(requestId, "First aid card (back)");

			const mine = await fileActions.getMyDocumentsAction();
			if (!mine.success) throw new Error(mine.error);
			expect(
				mine.data
					.filter((document) => [first, second].includes(document.id))
					.map((document) => document.visibility),
			).toEqual(["shared", "shared"]);

			const request = await myRequest(requestId);
			expect(request).toMatchObject({ status: "open", submissions: [] });
			expect(request.pendingDocuments.map((document) => document.id).toSorted()).toEqual(
				[first, second].toSorted(),
			);
			// Officers hear of the submission, not of every upload for it.
			expect(harness.notifications).toEqual([
				expect.objectContaining({ type: "personnel_file_document_requested" }),
			]);
		});

		it("submits the uploads with an optional note and notifies the covering officer", async () => {
			const requestId = await createRequest("admin");
			signIn("anna");
			const documentId = await uploadedId(requestId);
			harness.notifications.length = 0;

			const result = await requestActions.submitDocumentRequestAction({
				requestId,
				note: "  The back side follows. ",
				expectedVersion: 1,
			});
			if (!result.success) throw new Error(result.error);
			expect(result.data).toMatchObject({ status: "submitted", version: 2, pendingDocuments: [] });
			expect(result.data.submissions).toEqual([
				expect.objectContaining({
					note: "The back side follows.",
					documents: [expect.objectContaining({ id: documentId, title: "First aid card 2026" })],
				}),
			]);
			expect(result.data.history.map((event) => [event.kind, event.actorName])).toEqual([
				["created", "Adam Admin"],
				["submitted", "Anna Example"],
			]);
			expect(result.data.history[1]?.submissionId).toBe(result.data.submissions[0]?.id);

			expect(notified()).toEqual([
				{
					userId: userOf("officer"),
					type: "personnel_file_document_request_submitted",
					actionUrl: `/personnel-files/${ids.anna}`,
				},
			]);
			expect(harness.notifications[0]?.message).toContain("Anna Example");
			expect(harness.notifications[0]?.message).toContain("First aid refresher");

			const { rows } = await admin.query<{ performed_by: string; metadata: string }>(
				`select performed_by, metadata from audit_log
				 where entity_type = 'employee_document_request' and entity_id = $1
				   and action = 'personnel_file.document_request_submitted'`,
				[requestId],
			);
			expect(rows).toHaveLength(1);
			expect(rows[0]?.performed_by).toBe(userOf("anna"));
			expect(JSON.parse(rows[0]?.metadata ?? "{}")).toMatchObject({
				submissionNote: "The back side follows.",
				documentIds: [documentId],
				status: { from: "open", to: "submitted" },
			});
		});

		it("notifies owners and admins when no officer covers the employee and category", async () => {
			const requestId = await createRequest("admin", {
				category: "other",
				title: "Driving record",
			});
			signIn("anna");
			await uploadForRequest({ requestId, category: "other", title: "Driving record 2026" });
			harness.notifications.length = 0;
			const result = await requestActions.submitDocumentRequestAction({ requestId });
			expect(result).toMatchObject({ success: true });
			expect(notified().map((entry) => [entry.userId, entry.type])).toEqual([
				[userOf("admin"), "personnel_file_document_request_submitted"],
				[userOf("owner"), "personnel_file_document_request_submitted"],
			]);
		});

		it("refuses a submission without new documents, and a second submission", async () => {
			const requestId = await createRequest("officer");
			signIn("anna");
			expect(await requestActions.submitDocumentRequestAction({ requestId })).toMatchObject({
				success: false,
				code: "no_documents",
			});
			await uploadedId(requestId);
			expect(await requestActions.submitDocumentRequestAction({ requestId })).toMatchObject({
				success: true,
			});
			expect(await requestActions.submitDocumentRequestAction({ requestId })).toMatchObject({
				success: false,
				code: "conflict",
			});
		});

		it("lets only the request's employee upload and submit", async () => {
			const requestId = await createRequest("officer");
			for (const person of ["ben", "officer", "admin"] as const) {
				signIn(person);
				expect(await requestActions.submitDocumentRequestAction({ requestId })).toMatchObject({
					success: false,
				});
				const response = await uploadForRequest({ requestId });
				expect(response.status).toBeGreaterThanOrEqual(400);
			}
			// Ben uploading into his own file with Anna's request.
			signIn("ben");
			const response = await uploadForRequest({ requestId, employeeId: ids.ben });
			expect(response.status).toBe(409);
			expect(await documentCount(ids.ben)).toBe(0);
			expect(await documentCount(ids.anna)).toBe(0);
			expect(await statusOf(requestId)).toBe("open");
		});

		it("refuses uploads of another category and uploads once the request is submitted", async () => {
			const requestId = await createRequest("officer");
			signIn("anna");
			expect((await uploadForRequest({ requestId, category: "other" })).status).toBe(409);
			await uploadedId(requestId);
			await requestActions.submitDocumentRequestAction({ requestId });
			expect((await uploadForRequest({ requestId })).status).toBe(409);
			expect(await documentCount(ids.anna)).toBe(1);
		});

		it("keeps plain own uploads out of requests", async () => {
			const requestId = await createRequest("officer");
			signIn("anna");
			const tusFileKey = createOwnedTusFileKey(userOf("anna"));
			harness.tus.set(tusFileKey, pdf("plain"));
			const response = await finalizeUpload(
				new Request("http://localhost/api/upload/personnel-file", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						tusFileKey,
						employeeId: ids.anna,
						source: "own",
						fileName: "card.pdf",
						metadata: { category: "certificate", title: "Plain", documentDate: "2026-10-01" },
					}),
				}) as unknown as NextRequest,
			);
			expect(response.status).toBe(200);
			expect(await requestActions.submitDocumentRequestAction({ requestId })).toMatchObject({
				success: false,
				code: "no_documents",
			});
		});
	});

	describe("return", () => {
		it("requires a reason", async () => {
			const { requestId, version } = await submittedRequest();
			signIn("officer");
			expect(
				await requestActions.returnDocumentRequestAction({
					requestId,
					reason: " ",
					expectedVersion: version,
				}),
			).toMatchObject({ success: false, code: "reason_required" });
			expect(await statusOf(requestId)).toBe("submitted");
		});

		it("reopens the request, keeps the documents and tells the employee why; a resubmission adds new ones", async () => {
			const { requestId, documentId, version } = await submittedRequest();
			signIn("officer");
			const returned = await requestActions.returnDocumentRequestAction({
				requestId,
				reason: "The card is unreadable.",
				expectedVersion: version,
			});
			if (!returned.success) throw new Error(returned.error);
			expect(returned.data).toMatchObject({ status: "open" });
			expect(notified()).toEqual([
				{
					userId: userOf("anna"),
					type: "personnel_file_document_request_decided",
					actionUrl: "/my-documents",
				},
			]);
			expect(harness.notifications[0]?.message).toContain("The card is unreadable.");
			expect(harness.notifications[0]?.metadata).toMatchObject({ decision: "returned" });

			const reopened = await myRequest(requestId);
			expect(reopened.history.at(-1)).toMatchObject({
				kind: "returned",
				reason: "The card is unreadable.",
				actorName: "Otto Officer",
			});
			const mine = await fileActions.getMyDocumentsAction();
			if (!mine.success) throw new Error(mine.error);
			expect(mine.data.map((document) => document.id)).toContain(documentId);

			signIn("anna");
			const newer = await uploadedId(requestId, "First aid card, scanned again");
			const resubmitted = await requestActions.submitDocumentRequestAction({ requestId });
			if (!resubmitted.success) throw new Error(resubmitted.error);
			expect(resubmitted.data.status).toBe("submitted");
			expect(
				resubmitted.data.submissions.map((submission) =>
					submission.documents.map((document) => document.id),
				),
			).toEqual([[documentId], [newer]]);
			expect(resubmitted.data.history.map((event) => event.kind)).toEqual([
				"created",
				"submitted",
				"returned",
				"submitted",
			]);
		});
	});

	describe("accept", () => {
		it("accepts the submission, notifies the employee and audits the decision", async () => {
			const { requestId, version } = await submittedRequest();
			signIn("officer");
			const accepted = await requestActions.acceptDocumentRequestAction({
				requestId,
				expectedVersion: version,
			});
			if (!accepted.success) throw new Error(accepted.error);
			expect(accepted.data).toMatchObject({ status: "accepted", version: version + 1 });
			expect(notified()).toEqual([
				{
					userId: userOf("anna"),
					type: "personnel_file_document_request_decided",
					actionUrl: "/my-documents",
				},
			]);
			expect(harness.notifications[0]?.metadata).toMatchObject({ decision: "accepted" });
			const { rows } = await admin.query<{ performed_by: string }>(
				`select performed_by from audit_log
				 where entity_type = 'employee_document_request' and entity_id = $1
				   and action = 'personnel_file.document_request_accepted'`,
				[requestId],
			);
			expect(rows).toEqual([{ performed_by: userOf("officer") }]);
		});

		it("cannot accept or return an open request", async () => {
			const requestId = await createRequest("officer");
			signIn("officer");
			expect(await requestActions.acceptDocumentRequestAction({ requestId })).toMatchObject({
				success: false,
				code: "conflict",
			});
			expect(
				await requestActions.returnDocumentRequestAction({ requestId, reason: "Nothing here" }),
			).toMatchObject({ success: false, code: "conflict" });
		});

		it("still lets an officer cancel a submitted request", async () => {
			const { requestId, version } = await submittedRequest();
			signIn("admin");
			expect(
				await requestActions.cancelDocumentRequestAction({
					requestId,
					reason: "No longer needed",
					expectedVersion: version,
				}),
			).toMatchObject({ success: true, data: { status: "cancelled" } });
		});
	});

	describe("who decides", () => {
		it("lets owners and admins decide everything, the covering officer only what they cover", async () => {
			const certificate = await submittedRequest();
			signIn("owner");
			expect(
				await requestActions.acceptDocumentRequestAction({ requestId: certificate.requestId }),
			).toMatchObject({ success: true });

			const other = await submittedRequest({ creator: "admin", category: "other" });
			signIn("officer");
			expect(
				await requestActions.acceptDocumentRequestAction({ requestId: other.requestId }),
			).toMatchObject({ success: false });
			expect(
				await requestActions.returnDocumentRequestAction({
					requestId: other.requestId,
					reason: "Not mine to decide",
				}),
			).toMatchObject({ success: false });
			expect(await statusOf(other.requestId)).toBe("submitted");
		});

		it("refuses the employee, colleagues and other organizations; the employee cannot cancel", async () => {
			const { requestId } = await submittedRequest();
			signIn("anna");
			expect(await requestActions.acceptDocumentRequestAction({ requestId })).toMatchObject({
				success: false,
				code: "own_file",
			});
			expect(
				await requestActions.returnDocumentRequestAction({ requestId, reason: "Try again" }),
			).toMatchObject({ success: false, code: "own_file" });
			expect(
				await requestActions.cancelDocumentRequestAction({ requestId, reason: "Decline" }),
			).toMatchObject({ success: false });
			signIn("ben");
			expect(await requestActions.acceptDocumentRequestAction({ requestId })).toMatchObject({
				success: false,
			});
			signIn("stranger", OTHER_ORG);
			expect(await requestActions.acceptDocumentRequestAction({ requestId })).toMatchObject({
				success: false,
			});
			expect(await statusOf(requestId)).toBe("submitted");
		});

		it("refuses an admin on their own file", async () => {
			const requestId = await createRequest("owner", { employeeId: ids.admin });
			signIn("admin");
			const response = await uploadForRequest({ requestId, employeeId: ids.admin });
			expect(response.status).toBe(200);
			expect(await requestActions.submitDocumentRequestAction({ requestId })).toMatchObject({
				success: true,
			});
			expect(await requestActions.acceptDocumentRequestAction({ requestId })).toMatchObject({
				success: false,
				code: "own_file",
			});
			signIn("owner");
			expect(await requestActions.acceptDocumentRequestAction({ requestId })).toMatchObject({
				success: true,
			});
		});

		it("takes the decision away from an officer who lost coverage", async () => {
			const { requestId } = await submittedRequest();
			await deactivateSeededPersonnelFileOfficerGrant(admin, officerGrantId);
			signIn("officer");
			expect(await requestActions.acceptDocumentRequestAction({ requestId })).toMatchObject({
				success: false,
			});
			expect(await statusOf(requestId)).toBe("submitted");
		});

		it("refuses a decision on a stale view with a conflict", async () => {
			const { requestId, version } = await submittedRequest();
			signIn("officer");
			expect(
				await requestActions.acceptDocumentRequestAction({
					requestId,
					expectedVersion: version - 1,
				}),
			).toMatchObject({ success: false, code: "conflict" });
			expect(await statusOf(requestId)).toBe("submitted");
		});
	});

	it("applies exactly one of two concurrent decisions; the other conflicts and changes nothing", async () => {
		const { requestId, version } = await submittedRequest();
		const [officerAccess, adminAccess] = await Promise.all(
			(["officer", "admin"] as const).map((person) =>
				resolvePersonnelFileAccess(db, { userId: userOf(person), organizationId: ORG }),
			),
		);
		if (!officerAccess || !adminAccess) throw new Error("no access");
		// Hold the request's row so both decisions queue behind the same lock.
		const holder = await admin.connect();
		try {
			await holder.query("begin");
			await holder.query("select id from employee_document_request where id = $1 for update", [
				requestId,
			]);
			const decisions = Promise.all([
				acceptDocumentRequest(db, officerAccess, { requestId, expectedVersion: version }),
				returnDocumentRequest(db, adminAccess, {
					requestId,
					reason: "Please scan it again.",
					expectedVersion: version,
				}),
			]);
			await new Promise((resolve) => setTimeout(resolve, 300));
			await holder.query("commit");
			const results = await decisions;
			const kinds = results.map((result) => result.kind);
			expect(kinds.filter((kind) => kind === "conflict")).toHaveLength(1);
			expect(kinds.filter((kind) => kind === "accepted" || kind === "returned")).toHaveLength(1);
			const winner = kinds.includes("accepted") ? "accepted" : "open";
			expect(await statusOf(requestId)).toBe(winner);
		} finally {
			holder.release();
		}
		const { rows } = await admin.query<{ kind: string }>(
			"select kind from employee_document_request_event where request_id = $1 order by occurred_at, id",
			[requestId],
		);
		expect(rows.map((row) => row.kind).slice(0, 2)).toEqual(["created", "submitted"]);
		expect(rows).toHaveLength(3);
		expect(["accepted", "returned"]).toContain(rows[2]?.kind);
		const audits = await admin.query(
			`select action from audit_log where entity_type = 'employee_document_request'
			 and entity_id = $1 and action in ('personnel_file.document_request_accepted', 'personnel_file.document_request_returned')`,
			[requestId],
		);
		expect(audits.rows).toHaveLength(1);
	});
});
