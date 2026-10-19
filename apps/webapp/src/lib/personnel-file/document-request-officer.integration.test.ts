/**
 * #1403 (spec #1307): the officer "Document requests" page lists the requests
 * the viewer covers across employees, filtered by status and overdue (in the
 * organization's calendar); covering officers edit the deadline and note of
 * open and submitted requests; an officer who loses coverage loses sight of
 * the request and every action on it. Against a disposable PostgreSQL
 * database; the session and notification delivery are replaced.
 */

import { Temporal } from "temporal-polyfill";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { CreateNotificationParams } from "@/lib/notifications/types";
import { integrationAdminPool } from "@/test/integration-database";

const harness = vi.hoisted(() => ({
	userId: null as string | null,
	organizationId: "t1403-org",
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
const { listManagedDocumentRequests, lockManagedDocumentRequest } = await import(
	"./document-request-store"
);
const { parseDocumentRequestOverviewParams } = await import("./document-request-overview");
const { seedPersonnelFileOfficerGrant } = await import("./testing/officer-grant.test.fixture");

const ORG = "t1403-org";
const OTHER_ORG = "t1403-other";

const ids = {
	owner: "e1403000-0000-4000-8000-000000000001",
	admin: "e1403000-0000-4000-8000-000000000002",
	officer: "e1403000-0000-4000-8000-000000000003",
	anna: "e1403000-0000-4000-8000-000000000004",
	ben: "e1403000-0000-4000-8000-000000000005",
	stranger: "e1403000-0000-4000-8000-000000000006",
	berlin: "e1403100-0000-4000-8000-000000000001",
} as const;
type Person = "owner" | "admin" | "officer" | "anna" | "ben" | "stranger";
const userOf = (person: Person) => `t1403-${person}`;

const admin = integrationAdminPool();
let officerGrantId = "";

async function cleanup() {
	await admin.query("delete from organization where id = any($1)", [[ORG, OTHER_ORG]]);
	await admin.query('delete from "user" where id like $1', ["t1403-%"]);
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
		[`t1403-member-${person}`, organizationId, userOf(person), memberRole],
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
	await seedPerson("ben", "Ben Example", "member");
	await seedPerson("stranger", "Sam Stranger", "owner", { organizationId: OTHER_ORG });
}

/** Otto covers Berlin's certificates only. */
async function grantOfficer() {
	await admin.query("delete from personnel_file_officer_grant where organization_id = $1", [ORG]);
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

async function accessOf(person: Person) {
	const access = await resolvePersonnelFileAccess(db, {
		userId: userOf(person),
		organizationId: ORG,
	});
	if (!access) throw new Error(`no access for ${person}`);
	return access;
}

async function create(
	person: Person,
	input: { employeeId: string; category?: "certificate" | "other"; title: string },
): Promise<string> {
	signIn(person);
	const result = await actions.createDocumentRequestAction({
		category: "certificate",
		note: "Please upload it.",
		deadline: "2099-11-30",
		...input,
	});
	if (!result.success) throw new Error(`create failed: ${result.error} (${result.code})`);
	return result.data.id;
}

async function setRow(requestId: string, values: { deadline?: string; status?: string }) {
	if (values.deadline) {
		await admin.query("update employee_document_request set deadline = $2 where id = $1", [
			requestId,
			values.deadline,
		]);
	}
	if (values.status) {
		await admin.query("update employee_document_request set status = $2 where id = $1", [
			requestId,
			values.status,
		]);
	}
}

async function listAs(person: Person, params: Record<string, string> = {}, now?: Temporal.Instant) {
	const result = await listManagedDocumentRequests(
		db,
		await accessOf(person),
		parseDocumentRequestOverviewParams(params),
		now,
	);
	if (result.kind !== "ok") throw new Error(`list refused for ${person}`);
	return result;
}

async function titlesFor(person: Person, params: Record<string, string> = {}) {
	return (await listAs(person, params)).rows.map((row) => row.title).toSorted();
}

async function rowOf(requestId: string) {
	const { rows } = await admin.query<{
		employee_id: string;
		category: string;
		title: string;
		note: string | null;
		deadline: string;
		status: string;
		version: number;
		renewed_document_id: string | null;
	}>(
		`select employee_id, category, title, note, to_char(deadline, 'YYYY-MM-DD') as deadline,
		        status, version, renewed_document_id
		 from employee_document_request where id = $1`,
		[requestId],
	);
	return rows[0];
}

async function versionOf(requestId: string): Promise<number> {
	return (await rowOf(requestId))?.version ?? 0;
}

describe("the officer Document requests page (#1403)", () => {
	beforeAll(seed);
	afterAll(async () => {
		await cleanup();
		await admin.end();
	});
	beforeEach(async () => {
		harness.notifications.length = 0;
		await admin.query("delete from employee_document_request where organization_id = $1", [ORG]);
		await grantOfficer();
	});

	describe("contents", () => {
		it("lists the requests the viewer covers, across employees, with whose they are", async () => {
			await create("owner", { employeeId: ids.anna, title: "Anna certificate" });
			await create("owner", { employeeId: ids.anna, category: "other", title: "Anna other" });
			await create("owner", { employeeId: ids.ben, title: "Ben certificate" });
			await create("owner", { employeeId: ids.admin, title: "Adam certificate" });

			const officer = await listAs("officer");
			expect(officer.rows).toEqual([
				expect.objectContaining({
					title: "Anna certificate",
					employeeId: ids.anna,
					employeeName: "Anna Example",
					isFormer: false,
					status: "open",
					history: [expect.objectContaining({ kind: "created", actorName: "Olga Owner" })],
				}),
			]);
			expect(officer.total).toBe(1);

			// Owners and admins see every request, except those on their own file.
			expect(await titlesFor("admin")).toEqual([
				"Anna certificate",
				"Anna other",
				"Ben certificate",
			]);
			expect(await titlesFor("owner")).toEqual([
				"Adam certificate",
				"Anna certificate",
				"Anna other",
				"Ben certificate",
			]);
		});

		it("is refused to someone who covers no requestable category", async () => {
			const result = await listManagedDocumentRequests(
				db,
				await accessOf("anna"),
				parseDocumentRequestOverviewParams({}),
			);
			expect(result).toEqual({ kind: "refused" });
		});

		it("pages the list", async () => {
			for (const title of ["One", "Two", "Three"]) {
				await create("admin", { employeeId: ids.ben, title });
			}
			const first = await listAs("admin", { pageSize: "10" });
			expect(first).toMatchObject({ total: 3, page: 1, pageCount: 1 });
			expect(first.rows).toHaveLength(3);
		});
	});

	describe("filters", () => {
		it("shows open and submitted requests by default; a status filter narrows it", async () => {
			await create("admin", { employeeId: ids.anna, title: "Open" });
			await setRow(await create("admin", { employeeId: ids.anna, title: "Submitted" }), {
				status: "submitted",
			});
			await setRow(await create("admin", { employeeId: ids.anna, title: "Accepted" }), {
				status: "accepted",
			});
			const cancelled = await create("admin", { employeeId: ids.anna, title: "Cancelled" });
			signIn("admin");
			await actions.cancelDocumentRequestAction({
				requestId: cancelled,
				reason: "Not needed",
				expectedVersion: 1,
			});

			expect(await titlesFor("admin")).toEqual(["Open", "Submitted"]);
			expect(await titlesFor("admin", { status: "submitted" })).toEqual(["Submitted"]);
			expect(await titlesFor("admin", { status: "accepted" })).toEqual(["Accepted"]);
			expect(await titlesFor("admin", { status: "cancelled" })).toEqual(["Cancelled"]);
			expect(await titlesFor("admin", { status: "all" })).toEqual([
				"Accepted",
				"Cancelled",
				"Open",
				"Submitted",
			]);
		});

		it("finds overdue requests by the organization's calendar day, open ones only", async () => {
			const due = await create("admin", { employeeId: ids.anna, title: "Due 30 Nov" });
			const later = await create("admin", { employeeId: ids.anna, title: "Due 1 Dec" });
			const handedIn = await create("admin", { employeeId: ids.anna, title: "Submitted 30 Nov" });
			await setRow(due, { deadline: "2026-11-30" });
			await setRow(later, { deadline: "2026-12-01" });
			await setRow(handedIn, { deadline: "2026-11-30", status: "submitted" });

			// 23:30 UTC on 30 Nov is already 1 Dec in Berlin: the 30 Nov deadline has passed.
			const berlinFirstOfDecember = Temporal.Instant.from("2026-11-30T23:30:00Z");
			const overdue = await listAs("admin", { overdue: "1" }, berlinFirstOfDecember);
			expect(overdue.rows.map((row) => [row.title, row.overdue])).toEqual([["Due 30 Nov", true]]);
			const active = await listAs("admin", {}, berlinFirstOfDecember);
			expect(Object.fromEntries(active.rows.map((row) => [row.title, row.overdue]))).toEqual({
				"Due 30 Nov": true,
				"Due 1 Dec": false,
				"Submitted 30 Nov": false,
			});

			// 22:30 UTC is still 30 Nov in Berlin: nothing is overdue yet.
			const berlinLastOfNovember = Temporal.Instant.from("2026-11-30T22:30:00Z");
			expect((await listAs("admin", { overdue: "1" }, berlinLastOfNovember)).rows).toEqual([]);
		});
	});

	describe("edit", () => {
		it("changes the deadline and note of an open request, with history and audit", async () => {
			const requestId = await create("admin", { employeeId: ids.anna, title: "First aid" });
			harness.notifications.length = 0;
			signIn("officer");
			const result = await actions.editDocumentRequestAction({
				requestId,
				deadline: "2099-12-15",
				note: "  Bring the new card. ",
				expectedVersion: 1,
			});
			if (!result.success) throw new Error(`${result.error} (${result.code})`);
			expect(result.data).toMatchObject({
				deadline: "2099-12-15",
				note: "Bring the new card.",
				status: "open",
				version: 2,
			});
			expect(result.data.history.at(-1)).toMatchObject({
				kind: "edited",
				actorName: "Otto Officer",
				changes: { deadline: { from: "2099-11-30", to: "2099-12-15" }, noteChanged: true },
			});

			const { rows } = await admin.query<{
				action: string;
				performed_by: string;
				metadata: string;
			}>(
				`select action, performed_by, metadata from audit_log
				 where entity_type = 'employee_document_request' and entity_id = $1
				 order by timestamp, id`,
				[requestId],
			);
			expect(rows.map((row) => [row.action, row.performed_by])).toEqual([
				["personnel_file.document_request_created", userOf("admin")],
				["personnel_file.document_request_edited", userOf("officer")],
			]);
			expect(JSON.parse(rows[1]?.metadata ?? "{}")).toMatchObject({
				status: { from: "open", to: "open" },
				changes: { deadline: { from: "2099-11-30", to: "2099-12-15" }, noteChanged: true },
			});
			// Edits notify no one.
			expect(harness.notifications).toEqual([]);

			// The employee sees the new deadline and note and the edit in the history.
			signIn("anna");
			const mine = await actions.getMyDocumentRequestsAction();
			if (!mine.success) throw new Error(mine.error);
			expect(mine.data[0]).toMatchObject({
				deadline: "2099-12-15",
				note: "Bring the new card.",
				history: [
					expect.objectContaining({ kind: "created" }),
					expect.objectContaining({ kind: "edited" }),
				],
			});
		});

		it("edits a submitted request and clears a note, keeping its status", async () => {
			const requestId = await create("admin", { employeeId: ids.anna, title: "Handed in" });
			await setRow(requestId, { status: "submitted" });
			signIn("officer");
			const result = await actions.editDocumentRequestAction({
				requestId,
				note: "",
				expectedVersion: await versionOf(requestId),
			});
			expect(result).toMatchObject({
				success: true,
				data: { status: "submitted", note: null, deadline: "2099-11-30" },
			});
		});

		it("records nothing when nothing changes", async () => {
			const requestId = await create("admin", { employeeId: ids.anna, title: "Same" });
			signIn("officer");
			const result = await actions.editDocumentRequestAction({
				requestId,
				deadline: "2099-11-30",
				note: "Please upload it.",
				expectedVersion: 1,
			});
			expect(result).toMatchObject({ success: true, data: { version: 1 } });
			expect((await rowOf(requestId))?.version).toBe(1);
		});

		it("moves the deadline of an overdue request and changes its note without moving it", async () => {
			const requestId = await create("admin", { employeeId: ids.anna, title: "Late" });
			await setRow(requestId, { deadline: "2020-01-31" });
			signIn("officer");
			expect(
				await actions.editDocumentRequestAction({
					requestId,
					note: "Still waiting.",
					expectedVersion: await versionOf(requestId),
				}),
			).toMatchObject({ success: true, data: { deadline: "2020-01-31", overdue: true } });
			expect(
				await actions.editDocumentRequestAction({
					requestId,
					deadline: "2020-02-15",
					expectedVersion: await versionOf(requestId),
				}),
			).toMatchObject({ success: false, code: "deadline_in_past" });
			expect(
				await actions.editDocumentRequestAction({
					requestId,
					deadline: "2099-01-31",
					expectedVersion: await versionOf(requestId),
				}),
			).toMatchObject({ success: true, data: { deadline: "2099-01-31", overdue: false } });
		});

		it("refuses every other field server-side and changes nothing", async () => {
			const requestId = await create("admin", { employeeId: ids.anna, title: "Fixed" });
			const before = await rowOf(requestId);
			signIn("admin");
			for (const extra of [
				{ title: "Renamed" },
				{ employeeId: ids.ben },
				{ category: "other" },
				{ renewedDocumentId: "e1403200-0000-4000-8000-000000000001" },
				{ status: "accepted" },
			]) {
				expect(
					await actions.editDocumentRequestAction({
						requestId,
						deadline: "2099-12-31",
						expectedVersion: 1,
						...extra,
					} as never),
				).toMatchObject({ success: false, code: "not_editable" });
			}
			expect(await rowOf(requestId)).toEqual(before);
		});

		it("refuses closed requests and stale views with a conflict", async () => {
			const requestId = await create("admin", { employeeId: ids.anna, title: "Closing" });
			signIn("officer");
			expect(
				await actions.editDocumentRequestAction({
					requestId,
					note: "Stale",
					expectedVersion: 5,
				}),
			).toMatchObject({ success: false, code: "conflict" });
			await actions.cancelDocumentRequestAction({ requestId, reason: "Not needed", expectedVersion: 1 });
			expect(
				await actions.editDocumentRequestAction({
					requestId,
					deadline: "2099-12-31",
					expectedVersion: await versionOf(requestId),
				}),
			).toMatchObject({ success: false, code: "conflict" });
			expect((await rowOf(requestId))?.deadline).toBe("2099-11-30");
		});

		it("refuses the employee, officers not covering it and the actor's own file", async () => {
			const annas = await create("admin", { employeeId: ids.anna, title: "Anna's" });
			const adams = await create("owner", { employeeId: ids.admin, title: "Adam's" });
			const bens = await create("admin", { employeeId: ids.ben, title: "Ben's" });
			signIn("anna");
			expect(
				await actions.editDocumentRequestAction({ requestId: annas, note: "Mine", expectedVersion: 1 }),
			).toMatchObject({ success: false });
			signIn("officer");
			expect(
				await actions.editDocumentRequestAction({ requestId: bens, note: "Not covered", expectedVersion: 1 }),
			).toMatchObject({ success: false });
			signIn("admin");
			expect(
				await actions.editDocumentRequestAction({ requestId: adams, note: "My own", expectedVersion: 1 }),
			).toMatchObject({ success: false, code: "own_file" });
			signIn("stranger", OTHER_ORG);
			expect(
				await actions.editDocumentRequestAction({ requestId: annas, note: "Foreign", expectedVersion: 1 }),
			).toMatchObject({ success: false });
			for (const requestId of [annas, adams, bens]) {
				expect((await rowOf(requestId))?.version).toBe(1);
			}
		});
	});

	describe("lost coverage", () => {
		async function expectOfficerLostSight(requestId: string) {
			// Not on the page: an empty list, or none at all without any requestable coverage.
			const page = await listManagedDocumentRequests(
				db,
				await accessOf("officer"),
				parseDocumentRequestOverviewParams({ status: "all" }),
			);
			expect(page.kind === "ok" ? page.rows : []).toEqual([]);
			// Not on the employee's file.
			signIn("officer");
			const section = await actions.listEmployeeDocumentRequestsAction({ employeeId: ids.anna });
			expect(section.success ? section.data : []).toEqual([]);
			expect(
				await actions.editDocumentRequestAction({
					requestId,
					deadline: "2099-12-31",
					expectedVersion: 1,
				}),
			).toMatchObject({ success: false, error: "Document request not found" });
			expect(
				await actions.cancelDocumentRequestAction({ requestId, reason: "Still mine?", expectedVersion: 1 }),
			).toMatchObject({ success: false, error: "Document request not found" });
			// Deciding (#1402) starts from the same lookup.
			const access = await accessOf("officer");
			const lookup = await db.transaction((tx) =>
				lockManagedDocumentRequest(tx, access, requestId),
			);
			expect(lookup).toEqual({ kind: "not_found" });
			const row = await rowOf(requestId);
			expect(row).toMatchObject({ status: "open", version: 1, deadline: "2099-11-30" });
		}

		it("hides the request from an officer whose grant no longer covers the category", async () => {
			const requestId = await create("officer", { employeeId: ids.anna, title: "Narrowed" });
			await admin.query(
				"update personnel_file_officer_grant set categories = '{other}' where id = $1",
				[officerGrantId],
			);
			await expectOfficerLostSight(requestId);
		});

		it("hides the request from an officer whose grant no longer covers the employee", async () => {
			const requestId = await create("officer", { employeeId: ids.anna, title: "Moved" });
			await admin.query("delete from personnel_file_officer_team where grant_id = $1", [
				officerGrantId,
			]);
			await admin.query(
				`insert into personnel_file_officer_employee (organization_id, grant_id, employee_id, created_by)
				 values ($1, $2, $3, $4)`,
				[ORG, officerGrantId, ids.ben, userOf("owner")],
			);
			await expectOfficerLostSight(requestId);
		});

		it("hides the request from an officer whose grant is revoked", async () => {
			const requestId = await create("officer", { employeeId: ids.anna, title: "Revoked" });
			await admin.query("update personnel_file_officer_grant set is_active = false where id = $1", [
				officerGrantId,
			]);
			await expectOfficerLostSight(requestId);
			// Owners and admins still cover it.
			expect(await titlesFor("admin")).toEqual(["Revoked"]);
		});
	});
});
