/**
 * #1401 (spec #1307): officers create and cancel document requests; the
 * employee sees theirs with history, against a disposable PostgreSQL database.
 * Officers and employees use the real server actions; the session and
 * notification delivery are replaced.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { CreateNotificationParams } from "@/lib/notifications/types";
import { integrationAdminPool } from "@/test/integration-database";

const harness = vi.hoisted(() => ({
	userId: null as string | null,
	organizationId: "t1401-org",
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

vi.setConfig({ testTimeout: 60_000 });

const actions = await import("@/app/[locale]/(app)/personnel-files/document-request-actions");
const { db } = await import("@/db");
const { resolvePersonnelFileAccess } = await import("./access-store");
const { cancelDocumentRequest } = await import("./document-request-store");
const { seedPersonnelFileOfficerGrant, deactivateSeededPersonnelFileOfficerGrant } = await import(
	"./testing/officer-grant.test.fixture"
);

const ORG = "t1401-org";
const OTHER_ORG = "t1401-other";

const ids = {
	owner: "e1401000-0000-4000-8000-000000000001",
	admin: "e1401000-0000-4000-8000-000000000002",
	officer: "e1401000-0000-4000-8000-000000000003",
	anna: "e1401000-0000-4000-8000-000000000004",
	ben: "e1401000-0000-4000-8000-000000000005",
	leaver: "e1401000-0000-4000-8000-000000000006",
	stranger: "e1401000-0000-4000-8000-000000000007",
	berlin: "e1401100-0000-4000-8000-000000000001",
	annaCertificate: "e1401200-0000-4000-8000-000000000001",
	annaHrOnlyCertificate: "e1401200-0000-4000-8000-000000000002",
	annaOther: "e1401200-0000-4000-8000-000000000003",
	benCertificate: "e1401200-0000-4000-8000-000000000004",
} as const;
type Person = "owner" | "admin" | "officer" | "anna" | "ben" | "leaver" | "stranger";
const userOf = (person: Person) => `t1401-${person}`;

const admin = integrationAdminPool();
let officerGrantId = "";

async function cleanup() {
	await admin.query("delete from organization where id = any($1)", [[ORG, OTHER_ORG]]);
	await admin.query("delete from personnel_file_upload where organization_id = any($1)", [
		[ORG, OTHER_ORG],
	]);
	await admin.query('delete from "user" where id like $1', ["t1401-%"]);
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
	options: { organizationId?: string; teamId?: string | null; isActive?: boolean } = {},
) {
	const organizationId = options.organizationId ?? ORG;
	await admin.query(
		'insert into "user" (id,name,email,created_at,updated_at) values ($1,$2,$3,now(),now())',
		[userOf(person), displayName, `${userOf(person)}@example.test`],
	);
	await admin.query(
		"insert into member (id,organization_id,user_id,role,status,created_at) values ($1,$2,$3,$4,'approved',now())",
		[`t1401-member-${person}`, organizationId, userOf(person), memberRole],
	);
	await admin.query(
		"insert into employee (id,user_id,organization_id,role,team_id,is_active,updated_at) values ($1,$2,$3,'employee',$4,$5,now())",
		[ids[person], userOf(person), organizationId, options.teamId ?? null, options.isActive ?? true],
	);
}

async function seedDocument(input: {
	id: string;
	employeeId: string;
	category: "certificate" | "other";
	title: string;
	visibility: "shared" | "hr_only";
}) {
	await admin.query(
		`insert into employee_document
		 (id, organization_id, employee_id, category, title, document_date, visibility, expiry_date,
		  storage_provider, storage_key, file_name, mime_type, size_bytes, checksum_sha256, created_at, updated_at)
		 values ($1, $2, $3, $4, $5, '2024-10-01', $6, '2026-10-31',
		  's3-private', $7, 'card.pdf', 'application/pdf', 10, 'x', now(), now())`,
		[
			input.id,
			ORG,
			input.employeeId,
			input.category,
			input.title,
			input.visibility,
			`personnel-files/${ORG}/${input.employeeId}/${input.id}-card.pdf`,
		],
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
	await seedPerson("ben", "Ben Example", "member");
	await seedPerson("leaver", "Lea Leaver", "member", { teamId: ids.berlin, isActive: false });
	await seedPerson("stranger", "Sam Stranger", "owner", { organizationId: OTHER_ORG });
	// Otto covers Berlin's certificates only.
	officerGrantId = await seedPersonnelFileOfficerGrant(admin, {
		organizationId: ORG,
		officerEmployeeId: ids.officer,
		createdBy: userOf("owner"),
		teamIds: [ids.berlin],
		categories: ["certificate"],
	});
	await seedDocument({
		id: ids.annaCertificate,
		employeeId: ids.anna,
		category: "certificate",
		title: "First aid card 2024",
		visibility: "shared",
	});
	await seedDocument({
		id: ids.annaHrOnlyCertificate,
		employeeId: ids.anna,
		category: "certificate",
		title: "Confidential medical fitness",
		visibility: "hr_only",
	});
	await seedDocument({
		id: ids.annaOther,
		employeeId: ids.anna,
		category: "other",
		title: "Language course",
		visibility: "shared",
	});
	await seedDocument({
		id: ids.benCertificate,
		employeeId: ids.ben,
		category: "certificate",
		title: "Forklift licence",
		visibility: "shared",
	});
}

function signIn(person: Person, organizationId = ORG) {
	harness.userId = userOf(person);
	harness.organizationId = organizationId;
}

const certificateRequest = {
	employeeId: ids.anna,
	category: "certificate",
	title: "First aid refresher",
	note: "Please upload the new card.",
	deadline: "2099-11-30",
};

async function createAs(person: Person, input: Record<string, unknown> = {}) {
	signIn(person);
	return actions.createDocumentRequestAction({ ...certificateRequest, ...input } as never);
}

async function createdId(person: Person, input: Record<string, unknown> = {}): Promise<string> {
	const result = await createAs(person, input);
	if (!result.success) throw new Error(`create failed: ${result.error} (${result.code})`);
	return result.data.id;
}

async function auditOf(requestId: string) {
	const { rows } = await admin.query<{
		action: string;
		performed_by: string;
		employee_id: string;
		metadata: string;
	}>(
		`select action, performed_by, employee_id, metadata from audit_log
		 where entity_type = 'employee_document_request' and entity_id = $1 order by timestamp, id`,
		[requestId],
	);
	return rows.map((row) => ({ ...row, metadata: JSON.parse(row.metadata) }));
}

describe("document requests: create and cancel (#1401)", () => {
	beforeAll(seed);
	afterAll(async () => {
		await cleanup();
		await admin.end();
	});
	beforeEach(async () => {
		harness.notifications.length = 0;
		await admin.query("delete from employee_document_request where organization_id = $1", [ORG]);
		await admin.query("update personnel_file_officer_grant set is_active = true where id = $1", [
			officerGrantId,
		]);
	});

	it("lets a covering officer create a request the employee sees with its history", async () => {
		const result = await createAs("officer");
		if (!result.success) throw new Error(result.error);
		expect(result.data).toMatchObject({
			employeeId: ids.anna,
			category: "certificate",
			title: "First aid refresher",
			note: "Please upload the new card.",
			deadline: "2099-11-30",
			status: "open",
			overdue: false,
			version: 1,
			renewedDocument: null,
			createdByName: "Otto Officer",
			submissions: [],
		});
		expect(result.data.history).toEqual([
			expect.objectContaining({ kind: "created", actorName: "Otto Officer", reason: null }),
		]);

		signIn("anna");
		const mine = await actions.getMyDocumentRequestsAction();
		if (!mine.success) throw new Error(mine.error);
		expect(mine.data).toEqual([
			expect.objectContaining({
				id: result.data.id,
				title: "First aid refresher",
				note: "Please upload the new card.",
				category: "certificate",
				deadline: "2099-11-30",
				status: "open",
				history: [expect.objectContaining({ kind: "created" })],
			}),
		]);
	});

	it("notifies the employee of the new request, with a link to My documents", async () => {
		const requestId = await createdId("officer");
		expect(
			harness.notifications.map((notification) => ({
				userId: notification.userId,
				type: notification.type,
				entityType: notification.entityType,
				entityId: notification.entityId,
				actionUrl: notification.actionUrl,
			})),
		).toEqual([
			{
				userId: userOf("anna"),
				type: "personnel_file_document_requested",
				entityType: "employee_document_request",
				entityId: requestId,
				actionUrl: "/my-documents",
			},
		]);
		expect(harness.notifications[0]?.message).toContain("First aid refresher");
	});

	it("audits the creation with the actor", async () => {
		const requestId = await createdId("officer");
		const records = await auditOf(requestId);
		expect(records).toHaveLength(1);
		expect(records[0]).toMatchObject({
			action: "personnel_file.document_request_created",
			performed_by: userOf("officer"),
			employee_id: ids.anna,
			metadata: {
				request: { category: "certificate", title: "First aid refresher", deadline: "2099-11-30" },
			},
		});
	});

	it("lets owners and admins create requests for any employee, other documents included", async () => {
		for (const person of ["owner", "admin"] as const) {
			const result = await createAs(person, {
				employeeId: ids.ben,
				category: "other",
				title: `Driving record (${person})`,
			});
			expect(result).toMatchObject({ success: true, data: { status: "open" } });
		}
	});

	describe("refusals", () => {
		it("refuses payslip, contract and sick note requests", async () => {
			for (const category of ["payslip", "contract", "sick_note"]) {
				expect(await createAs("admin", { category })).toMatchObject({
					success: false,
					code: "category_not_requestable",
				});
			}
		});

		it("refuses an employee or category the officer's grant does not cover", async () => {
			expect(await createAs("officer", { category: "other" })).toMatchObject({ success: false });
			expect(await createAs("officer", { employeeId: ids.ben })).toMatchObject({ success: false });
			// An employee without a grant, for a colleague.
			expect(await createAs("anna", { employeeId: ids.ben })).toMatchObject({ success: false });
			const { rows } = await admin.query(
				"select id from employee_document_request where organization_id = $1",
				[ORG],
			);
			expect(rows).toEqual([]);
		});

		it("refuses everyone on their own personnel file, owners and admins included", async () => {
			expect(await createAs("admin", { employeeId: ids.admin })).toMatchObject({
				success: false,
				code: "own_file",
			});
			expect(await createAs("anna", { employeeId: ids.anna })).toMatchObject({
				success: false,
				code: "own_file",
			});
		});

		it("refuses former employees and a deadline before today", async () => {
			expect(await createAs("admin", { employeeId: ids.leaver })).toMatchObject({
				success: false,
				code: "former_employee",
			});
			expect(await createAs("admin", { deadline: "2020-01-01" })).toMatchObject({
				success: false,
				code: "deadline_in_past",
			});
		});
	});

	describe("cancel", () => {
		it("lets a covering officer cancel with a reason; the employee is notified and sees it", async () => {
			const requestId = await createdId("admin");
			harness.notifications.length = 0;
			signIn("officer");
			const result = await actions.cancelDocumentRequestAction({
				requestId,
				reason: "  Training was cancelled. ",
				expectedVersion: 1,
			});
			if (!result.success) throw new Error(result.error);
			expect(result.data).toMatchObject({ status: "cancelled", version: 2 });
			expect(
				result.data.history.map((event) => [event.kind, event.actorName, event.reason]),
			).toEqual([
				["created", "Adam Admin", null],
				["cancelled", "Otto Officer", "Training was cancelled."],
			]);
			expect(
				harness.notifications.map((notification) => [
					notification.userId,
					notification.type,
					notification.actionUrl,
				]),
			).toEqual([[userOf("anna"), "personnel_file_document_request_decided", "/my-documents"]]);
			expect(harness.notifications[0]?.message).toContain("Training was cancelled.");

			signIn("anna");
			const mine = await actions.getMyDocumentRequestsAction();
			if (!mine.success) throw new Error(mine.error);
			expect(mine.data.find((request) => request.id === requestId)).toMatchObject({
				status: "cancelled",
				history: [
					expect.objectContaining({ kind: "created" }),
					expect.objectContaining({ kind: "cancelled", reason: "Training was cancelled." }),
				],
			});

			const records = await auditOf(requestId);
			expect(records.map((record) => [record.action, record.performed_by])).toEqual([
				["personnel_file.document_request_created", userOf("admin")],
				["personnel_file.document_request_cancelled", userOf("officer")],
			]);
			expect(records[1]?.metadata).toMatchObject({
				reason: "Training was cancelled.",
				status: { from: "open", to: "cancelled" },
			});
		});

		it("requires a reason", async () => {
			const requestId = await createdId("officer");
			expect(
				await actions.cancelDocumentRequestAction({
					requestId,
					reason: "  ",
					expectedVersion: 1,
				}),
			).toMatchObject({
				success: false,
				code: "reason_required",
			});
		});

		it("refuses the employee and anyone not covering the request", async () => {
			const requestId = await createdId("officer");
			signIn("anna");
			expect(
				await actions.cancelDocumentRequestAction({
					requestId,
					reason: "I don't want to",
					expectedVersion: 1,
				}),
			).toMatchObject({ success: false });
			signIn("ben");
			expect(
				await actions.cancelDocumentRequestAction({
					requestId,
					reason: "Not mine",
					expectedVersion: 1,
				}),
			).toMatchObject({ success: false });
			const { rows } = await admin.query(
				"select status from employee_document_request where id = $1",
				[requestId],
			);
			expect(rows).toEqual([{ status: "open" }]);
		});

		it("refuses a second or stale cancel with a conflict", async () => {
			const requestId = await createdId("officer");
			signIn("admin");
			expect(
				await actions.cancelDocumentRequestAction({
					requestId,
					reason: "Done",
					expectedVersion: 1,
				}),
			).toMatchObject({ success: true });
			expect(
				await actions.cancelDocumentRequestAction({
					requestId,
					reason: "Again",
					expectedVersion: 2,
				}),
			).toMatchObject({ success: false, code: "conflict" });

			const second = await createdId("officer");
			signIn("admin");
			expect(
				await actions.cancelDocumentRequestAction({
					requestId: second,
					reason: "Stale view",
					expectedVersion: 7,
				}),
			).toMatchObject({ success: false, code: "conflict" });
		});

		it("applies exactly one of two concurrent cancels; the other conflicts", async () => {
			const requestId = await createdId("officer");
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
					cancelDocumentRequest(db, officerAccess, {
						requestId,
						reason: "Officer cancels",
						expectedVersion: 1,
					}),
					cancelDocumentRequest(db, adminAccess, {
						requestId,
						reason: "Admin cancels",
						expectedVersion: 1,
					}),
				]);
				await new Promise((resolve) => setTimeout(resolve, 300));
				await holder.query("commit");
				const results = await decisions;
				expect(results.map((result) => result.kind).toSorted()).toEqual(["cancelled", "conflict"]);
			} finally {
				holder.release();
			}
			const { rows } = await admin.query(
				"select kind from employee_document_request_event where request_id = $1 order by occurred_at",
				[requestId],
			);
			expect(rows).toEqual([{ kind: "created" }, { kind: "cancelled" }]);
		});
	});

	describe("the requests section of an employee's file", () => {
		it("lists the employee's requests of the categories the officer covers", async () => {
			const certificate = await createdId("officer");
			await createdId("admin", { category: "other", title: "Language certificate" });
			signIn("officer");
			const result = await actions.listEmployeeDocumentRequestsAction({ employeeId: ids.anna });
			if (!result.success) throw new Error(result.error);
			expect(result.data.map((request) => request.id)).toEqual([certificate]);

			signIn("admin");
			const all = await actions.listEmployeeDocumentRequestsAction({ employeeId: ids.anna });
			if (!all.success) throw new Error(all.error);
			expect(all.data).toHaveLength(2);
		});

		it("is not there for the employee, other employees and officers not covering them", async () => {
			await createdId("officer");
			for (const [person, employeeId] of [
				["anna", ids.anna],
				["ben", ids.anna],
				["officer", ids.ben],
			] as const) {
				signIn(person);
				expect(await actions.listEmployeeDocumentRequestsAction({ employeeId })).toMatchObject({
					success: false,
				});
			}
		});

		it("is gone, with the right to cancel, when the officer loses coverage", async () => {
			const requestId = await createdId("officer");
			await deactivateSeededPersonnelFileOfficerGrant(admin, officerGrantId);
			signIn("officer");
			expect(
				await actions.listEmployeeDocumentRequestsAction({ employeeId: ids.anna }),
			).toMatchObject({ success: false });
			expect(
				await actions.cancelDocumentRequestAction({
					requestId,
					reason: "Still mine?",
					expectedVersion: 1,
				}),
			).toMatchObject({ success: false });
			signIn("admin");
			const all = await actions.listEmployeeDocumentRequestsAction({ employeeId: ids.anna });
			expect(all).toMatchObject({
				success: true,
				data: [expect.objectContaining({ id: requestId })],
			});
		});
	});

	describe("renewed documents", () => {
		it("names a document of the same employee and category, once while active", async () => {
			const first = await createAs("officer", { renewedDocumentId: ids.annaCertificate });
			expect(first).toMatchObject({
				success: true,
				data: { renewedDocument: { id: ids.annaCertificate, title: "First aid card 2024" } },
			});
			expect(await createAs("admin", { renewedDocumentId: ids.annaCertificate })).toMatchObject({
				success: false,
				code: "renewal_already_requested",
			});
			if (!first.success) return;
			signIn("admin");
			await actions.cancelDocumentRequestAction({
				requestId: first.data.id,
				reason: "Redo",
				expectedVersion: first.data.version,
			});
			expect(await createAs("admin", { renewedDocumentId: ids.annaCertificate })).toMatchObject({
				success: true,
			});
		});

		it("keeps the request when the renewed document is deleted, without the link", async () => {
			const disposable = "e1401200-0000-4000-8000-000000000099";
			await seedDocument({
				id: disposable,
				employeeId: ids.anna,
				category: "certificate",
				title: "Old card",
				visibility: "shared",
			});
			const requestId = await createdId("officer", { renewedDocumentId: disposable });
			await admin.query("delete from employee_document where id = $1", [disposable]);
			const { rows } = await admin.query(
				"select organization_id, renewed_document_id, status from employee_document_request where id = $1",
				[requestId],
			);
			expect(rows).toEqual([{ organization_id: ORG, renewed_document_id: null, status: "open" }]);
		});

		it("refuses a document of another employee or category", async () => {
			for (const renewedDocumentId of [ids.benCertificate, ids.annaOther]) {
				expect(await createAs("admin", { renewedDocumentId })).toMatchObject({
					success: false,
					code: "renewed_document_mismatch",
				});
			}
		});

		it("never shows the employee an HR-only renewed document", async () => {
			const requestId = await createdId("officer", {
				renewedDocumentId: ids.annaHrOnlyCertificate,
			});
			signIn("officer");
			const officerView = await actions.listEmployeeDocumentRequestsAction({
				employeeId: ids.anna,
			});
			expect(officerView).toMatchObject({
				success: true,
				data: [
					expect.objectContaining({
						renewedDocument: expect.objectContaining({ id: ids.annaHrOnlyCertificate }),
					}),
				],
			});
			signIn("anna");
			const mine = await actions.getMyDocumentRequestsAction();
			if (!mine.success) throw new Error(mine.error);
			const request = mine.data.find((entry) => entry.id === requestId);
			expect(request?.renewedDocument).toBeNull();
			expect(JSON.stringify(request)).not.toContain("Confidential medical fitness");
		});
	});

	describe("organization isolation", () => {
		it("never lets another organization's user read or change a request", async () => {
			const requestId = await createdId("officer");
			signIn("stranger", OTHER_ORG);
			expect(
				await actions.listEmployeeDocumentRequestsAction({ employeeId: ids.anna }),
			).toMatchObject({ success: false });
			expect(
				await actions.cancelDocumentRequestAction({
					requestId,
					reason: "Foreign",
					expectedVersion: 1,
				}),
			).toMatchObject({ success: false });
			expect(
				await actions.createDocumentRequestAction({ ...certificateRequest } as never),
			).toMatchObject({ success: false });
			const mine = await actions.getMyDocumentRequestsAction();
			expect(mine).toMatchObject({ success: true, data: [] });
			const { rows } = await admin.query(
				"select status from employee_document_request where id = $1",
				[requestId],
			);
			expect(rows).toEqual([{ status: "open" }]);
		});
	});
});
