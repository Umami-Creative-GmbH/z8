/**
 * #1407 (spec #1307): an officer creates the same document request for
 * several employees and teams at once. Each eligible employee gets their own
 * request and notification; out-of-coverage employees, the officer themself,
 * former employees and employees with an identical active request are
 * skipped and counted. Against a disposable PostgreSQL database; the session
 * and notification delivery are replaced.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { CreateNotificationParams } from "@/lib/notifications/types";
import { integrationAdminPool } from "@/test/integration-database";

const harness = vi.hoisted(() => ({
	userId: null as string | null,
	organizationId: "t1407-org",
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
const {
	createDocumentRequest,
	createDocumentRequestsInBulk,
	listDocumentRequestRecipientOptions,
} = await import("./document-request-store");
const { seedPersonnelFileOfficerGrant } = await import("./testing/officer-grant.test.fixture");

const ORG = "t1407-org";
const OTHER_ORG = "t1407-other";

const ids = {
	owner: "e1407000-0000-4000-8000-000000000001",
	officer: "e1407000-0000-4000-8000-000000000002",
	anna: "e1407000-0000-4000-8000-000000000003",
	ben: "e1407000-0000-4000-8000-000000000004",
	carl: "e1407000-0000-4000-8000-000000000005",
	dana: "e1407000-0000-4000-8000-000000000006",
	leaver: "e1407000-0000-4000-8000-000000000007",
	stranger: "e1407000-0000-4000-8000-000000000008",
	berlin: "e1407100-0000-4000-8000-000000000001",
	hamburg: "e1407100-0000-4000-8000-000000000002",
	annaCertificate: "e1407200-0000-4000-8000-000000000001",
} as const;
type Person = "owner" | "officer" | "anna" | "ben" | "carl" | "dana" | "leaver" | "stranger";
const userOf = (person: Person) => `t1407-${person}`;

const admin = integrationAdminPool();

async function cleanup() {
	await admin.query("delete from organization where id = any($1)", [[ORG, OTHER_ORG]]);
	await admin.query('delete from "user" where id like $1', ["t1407-%"]);
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
		[`t1407-member-${person}`, organizationId, userOf(person), memberRole],
	);
	await admin.query(
		"insert into employee (id,user_id,organization_id,role,team_id,is_active,updated_at) values ($1,$2,$3,'employee',$4,$5,now())",
		[ids[person], userOf(person), organizationId, options.teamId ?? null, options.isActive ?? true],
	);
}

/**
 * Berlin: Otto (the officer), Anna, Lea (former). Hamburg: Dana and Carl as
 * their primary team, Anna as a member. Ben has no team. Otto covers the
 * certificates of Berlin and of Dana, so Hamburg mixes covered and uncovered
 * employees.
 */
async function seed() {
	await cleanup();
	await seedOrganization(ORG);
	await seedOrganization(OTHER_ORG);
	await admin.query(
		`insert into team (id, organization_id, name, updated_at)
		 values ($1, $3, 'Berlin', now()), ($2, $3, 'Hamburg', now())`,
		[ids.berlin, ids.hamburg, ORG],
	);
	await seedPerson("owner", "Olga Owner", "owner");
	await seedPerson("officer", "Otto Officer", "member", { teamId: ids.berlin });
	await seedPerson("anna", "Anna Example", "member", { teamId: ids.berlin });
	await seedPerson("ben", "Ben Example", "member");
	await seedPerson("carl", "Carl Example", "member", { teamId: ids.hamburg });
	await seedPerson("dana", "Dana Example", "member", { teamId: ids.hamburg });
	await seedPerson("leaver", "Lea Leaver", "member", { teamId: ids.berlin, isActive: false });
	await seedPerson("stranger", "Sam Stranger", "owner", { organizationId: OTHER_ORG });
	await admin.query(
		"insert into team_membership (organization_id, team_id, employee_id) values ($1, $2, $3)",
		[ORG, ids.hamburg, ids.anna],
	);
	await seedPersonnelFileOfficerGrant(admin, {
		organizationId: ORG,
		officerEmployeeId: ids.officer,
		createdBy: userOf("owner"),
		teamIds: [ids.berlin],
		employeeIds: [ids.dana],
		categories: ["certificate"],
	});
	await admin.query(
		`insert into employee_document
		 (id, organization_id, employee_id, category, title, document_date, visibility, expiry_date,
		  storage_provider, storage_key, file_name, mime_type, size_bytes, checksum_sha256, created_at, updated_at)
		 values ($1, $2, $3, 'certificate', 'First aid card 2024', '2024-10-01', 'shared', '2026-10-31',
		  's3-private', $4, 'card.pdf', 'application/pdf', 10, 'x', now(), now())`,
		[
			ids.annaCertificate,
			ORG,
			ids.anna,
			`personnel-files/${ORG}/${ids.anna}/${ids.annaCertificate}-card.pdf`,
		],
	);
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

const bulkRequest = {
	employeeIds: [] as string[],
	teamIds: [] as string[],
	category: "certificate" as const,
	title: "First aid refresher",
	note: "Please upload the new card.",
	deadline: "2099-11-30",
};

async function bulkAs(person: Person, input: Record<string, unknown> = {}) {
	signIn(person);
	return actions.createDocumentRequestsInBulkAction({ ...bulkRequest, ...input } as never);
}

async function requestRows() {
	const { rows } = await admin.query<{
		id: string;
		employee_id: string;
		category: string;
		title: string;
		note: string | null;
		deadline: string;
		status: string;
		version: number;
		renewed_document_id: string | null;
		created_by: string | null;
	}>(
		`select id, employee_id, category, title, note, to_char(deadline, 'YYYY-MM-DD') as deadline,
		        status, version, renewed_document_id, created_by
		 from employee_document_request where organization_id = $1 order by employee_id, created_at`,
		[ORG],
	);
	return rows;
}

async function seedRequest(input: {
	employeeId: string;
	category?: "certificate" | "other";
	title: string;
	status: "open" | "submitted" | "accepted" | "cancelled";
}) {
	await admin.query(
		`insert into employee_document_request
		 (organization_id, employee_id, category, title, deadline, status, created_by)
		 values ($1, $2, $3, $4, '2099-10-31', $5, $6)`,
		[
			ORG,
			input.employeeId,
			input.category ?? "certificate",
			input.title,
			input.status,
			userOf("owner"),
		],
	);
}

describe("document requests: bulk create (#1407)", () => {
	beforeAll(seed);
	afterAll(async () => {
		await cleanup();
		await admin.end();
	});
	beforeEach(async () => {
		harness.notifications.length = 0;
		await admin.query("delete from employee_document_request where organization_id = $1", [ORG]);
	});

	it("creates one request per covered employee of the chosen employees and teams, and skips the rest", async () => {
		const result = await bulkAs("officer", {
			teamIds: [ids.berlin, ids.hamburg],
			employeeIds: [ids.ben, ids.anna],
		});

		// Berlin: Otto himself, Anna, Lea (former); Hamburg: Dana (covered), Carl and
		// Anna (a member, counted once); Ben (not covered).
		expect(result).toEqual({
			success: true,
			data: {
				created: 2,
				skipped: 4,
				skippedBy: { not_covered: 2, own_file: 1, former_employee: 1, already_requested: 0 },
			},
		});
		const rows = await requestRows();
		expect(rows.map((row) => row.employee_id).toSorted()).toEqual([ids.anna, ids.dana].toSorted());
		for (const row of rows) {
			expect(row).toMatchObject({
				category: "certificate",
				title: "First aid refresher",
				note: "Please upload the new card.",
				deadline: "2099-11-30",
				status: "open",
				version: 1,
				renewed_document_id: null,
				created_by: userOf("officer"),
			});
		}
	});

	it("re-checks coverage on the server for a team that mixes covered and uncovered employees", async () => {
		const result = await bulkAs("officer", { teamIds: [ids.hamburg] });
		// Dana is covered by name; Carl and Anna (a Hamburg member, covered through Berlin)…
		expect(result).toMatchObject({
			success: true,
			data: { created: 2, skipped: 1, skippedBy: { not_covered: 1 } },
		});
		expect((await requestRows()).map((row) => row.employee_id).toSorted()).toEqual(
			[ids.anna, ids.dana].toSorted(),
		);

		// …and a category the grant does not cover creates nothing.
		await admin.query("delete from employee_document_request where organization_id = $1", [ORG]);
		expect(await bulkAs("officer", { teamIds: [ids.hamburg], category: "other" })).toMatchObject({
			success: true,
			data: { created: 0, skipped: 3, skippedBy: { not_covered: 3 } },
		});
		expect(await requestRows()).toEqual([]);
	});

	it("notifies each employee as for a single request, and gives each request its own history and audit", async () => {
		await bulkAs("officer", { employeeIds: [ids.anna, ids.dana] });
		const rows = await requestRows();
		expect(
			harness.notifications
				.map((notification) => ({
					userId: notification.userId,
					type: notification.type,
					entityId: notification.entityId,
					actionUrl: notification.actionUrl,
				}))
				.toSorted((a, b) => a.userId.localeCompare(b.userId)),
		).toEqual(
			[
				{ person: "anna" as const, employeeId: ids.anna },
				{ person: "dana" as const, employeeId: ids.dana },
			].map(({ person, employeeId }) => ({
				userId: userOf(person),
				type: "personnel_file_document_requested",
				entityId: rows.find((row) => row.employee_id === employeeId)?.id,
				actionUrl: "/my-documents",
			})),
		);
		expect(harness.notifications[0]?.message).toContain("First aid refresher");

		for (const row of rows) {
			const { rows: events } = await admin.query(
				"select kind, actor_user_id from employee_document_request_event where request_id = $1",
				[row.id],
			);
			expect(events).toEqual([{ kind: "created", actor_user_id: userOf("officer") }]);
			const { rows: audit } = await admin.query<{
				action: string;
				performed_by: string;
				employee_id: string;
				metadata: string;
			}>(
				`select action, performed_by, employee_id, metadata from audit_log
				 where entity_type = 'employee_document_request' and entity_id = $1`,
				[row.id],
			);
			expect(audit).toHaveLength(1);
			expect(audit[0]).toMatchObject({
				action: "personnel_file.document_request_created",
				performed_by: userOf("officer"),
				employee_id: row.employee_id,
			});
			expect(JSON.parse(audit[0]?.metadata ?? "{}")).toMatchObject({
				request: { category: "certificate", title: "First aid refresher", deadline: "2099-11-30" },
				bulk: true,
			});
		}

		// From then on a bulk request behaves like a single one.
		const annaRequest = rows.find((row) => row.employee_id === ids.anna);
		signIn("officer");
		expect(
			await actions.cancelDocumentRequestAction({
				requestId: annaRequest?.id ?? "",
				reason: "Sent by mistake.",
				expectedVersion: 1,
			}),
		).toMatchObject({ success: true, data: { status: "cancelled" } });
	});

	it("skips employees who already have an active request with the same category and title", async () => {
		await seedRequest({ employeeId: ids.anna, title: "First aid refresher", status: "open" });
		await seedRequest({ employeeId: ids.dana, title: "First aid refresher", status: "submitted" });
		// Closed requests, another title or another category are no duplicates.
		await seedRequest({ employeeId: ids.carl, title: "First aid refresher", status: "cancelled" });
		await seedRequest({ employeeId: ids.ben, title: "First aid refresher", status: "accepted" });
		await seedRequest({ employeeId: ids.leaver, title: "Forklift licence", status: "open" });
		await seedRequest({
			employeeId: ids.officer,
			category: "other",
			title: "First aid refresher",
			status: "open",
		});

		const result = await bulkAs("owner", {
			employeeIds: [ids.anna, ids.dana, ids.carl, ids.ben, ids.officer],
		});
		expect(result).toEqual({
			success: true,
			data: {
				created: 3,
				skipped: 2,
				skippedBy: { not_covered: 0, own_file: 0, former_employee: 0, already_requested: 2 },
			},
		});
		expect(await requestRows()).toHaveLength(6 + 3);
		expect(harness.notifications.map((notification) => notification.userId).toSorted()).toEqual(
			[userOf("carl"), userOf("ben"), userOf("officer")].toSorted(),
		);
	});

	it("never names a renewed document", async () => {
		expect(
			await bulkAs("owner", {
				employeeIds: [ids.anna],
				renewedDocumentId: ids.annaCertificate,
			}),
		).toMatchObject({ success: false, code: "renewal_not_in_bulk" });
		expect(await requestRows()).toEqual([]);
	});

	it("refuses invalid input, an empty selection and a deadline before today", async () => {
		expect(await bulkAs("owner", {})).toMatchObject({ success: false, code: "no_recipients" });
		expect(
			await bulkAs("owner", { employeeIds: [ids.anna], deadline: "2020-01-01" }),
		).toMatchObject({ success: false, code: "deadline_in_past" });
		expect(await bulkAs("owner", { employeeIds: [ids.anna], category: "payslip" })).toMatchObject({
			success: false,
			code: "category_not_requestable",
		});
		expect(await bulkAs("owner", { employeeIds: [ids.anna], title: "  " })).toMatchObject({
			success: false,
			code: "invalid_title",
		});
		expect(await bulkAs("owner", { employeeIds: ["not-a-uuid"] })).toMatchObject({
			success: false,
		});
		expect(await requestRows()).toEqual([]);
	});

	it("refuses people without coverage and never reaches into another organization", async () => {
		// Anna covers nothing.
		expect(await bulkAs("anna", { employeeIds: [ids.dana] })).toMatchObject({ success: false });
		// An owner of another organization names this organization's employees and teams.
		signIn("stranger", OTHER_ORG);
		expect(
			await actions.createDocumentRequestsInBulkAction({
				...bulkRequest,
				employeeIds: [ids.anna, ids.dana],
				teamIds: [ids.berlin],
			}),
		).toEqual({
			success: true,
			data: {
				created: 0,
				skipped: 0,
				skippedBy: { not_covered: 0, own_file: 0, former_employee: 0, already_requested: 0 },
			},
		});
		expect(await requestRows()).toEqual([]);
		expect(harness.notifications).toEqual([]);
	});

	it("offers the current employees and their teams the officer covers, per category", async () => {
		const officer = await listDocumentRequestRecipientOptions(db, await accessOf("officer"));
		expect(officer).toEqual({
			certificate: {
				employees: [
					{ id: ids.anna, name: "Anna Example" },
					{ id: ids.dana, name: "Dana Example" },
				],
				teams: [
					{ id: ids.berlin, name: "Berlin" },
					{ id: ids.hamburg, name: "Hamburg" },
				],
			},
			other: { employees: [], teams: [] },
		});

		const owner = await listDocumentRequestRecipientOptions(db, await accessOf("owner"));
		expect(owner.other.employees.map((option) => option.name)).toEqual([
			"Anna Example",
			"Ben Example",
			"Carl Example",
			"Dana Example",
			"Otto Officer",
		]);
		expect(owner.other.teams.map((option) => option.name)).toEqual(["Berlin", "Hamburg"]);
	});

	it("creates each employee's request once when two bulk creates run at the same time", async () => {
		const access = await accessOf("owner");
		const input = {
			employeeIds: [ids.anna, ids.ben, ids.carl, ids.dana],
			teamIds: [],
			category: "certificate",
			title: "Safety briefing",
			note: null,
			deadline: "2099-11-30",
		};
		const [first, second] = await Promise.all([
			createDocumentRequestsInBulk(db, access, input),
			createDocumentRequestsInBulk(db, access, input),
		]);
		const createdCounts = [first, second].map((result) =>
			result.kind === "created" ? result.created.length : -1,
		);
		expect(createdCounts.toSorted()).toEqual([0, 4]);
		const rows = await requestRows();
		expect(rows).toHaveLength(4);
		expect(new Set(rows.map((row) => row.employee_id)).size).toBe(4);
	});

	it("waits for a single create of the same employee, then skips the identical request it made", async () => {
		const access = await accessOf("owner");
		const input = {
			category: "certificate",
			title: "Safety briefing",
			note: null,
			deadline: "2099-11-30",
		};
		let bulk: ReturnType<typeof createDocumentRequestsInBulk> | undefined;
		// The single create's transaction stays open while the bulk create starts.
		await db.transaction(async (outer) => {
			const single = await createDocumentRequest(outer as never, access, {
				...input,
				employeeId: ids.anna,
			});
			expect(single.kind).toBe("created");
			bulk = createDocumentRequestsInBulk(db, access, {
				...input,
				employeeIds: [ids.anna, ids.ben],
				teamIds: [],
			});
			const settled = await Promise.race([
				bulk.then(() => "settled"),
				new Promise((resolve) => setTimeout(() => resolve("waiting"), 300)),
			]);
			expect(settled).toBe("waiting");
		});
		const result = await bulk;
		expect(result).toMatchObject({
			kind: "created",
			skippedBy: { already_requested: 1 },
		});
		const rows = await requestRows();
		expect(rows.map((row) => row.employee_id).toSorted()).toEqual([ids.anna, ids.ben].toSorted());
	});
});
