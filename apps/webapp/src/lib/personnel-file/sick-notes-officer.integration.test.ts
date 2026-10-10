/**
 * #984: sick notes uploaded by whoever records sick leave on the employee's
 * behalf, and officers attaching, linking and unlinking sick notes on an
 * employee's absences (Personnel File ADR 0002), against a disposable
 * PostgreSQL database. Everything goes through the real server actions and
 * routes; only the session, billing guard, e-mail and notification delivery,
 * calendar queue, work balance marking and object storage are replaced.
 */

import type { NextRequest } from "next/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { CreateNotificationParams } from "@/lib/notifications/types";
import { integrationAdminPool } from "@/test/integration-database";

const harness = vi.hoisted(() => ({
	userId: null as string | null,
	organizationId: "t984-org",
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
							user: {
								id: harness.userId,
								role: "user",
								email: `${harness.userId}@example.test`,
								name: harness.userId,
							},
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
vi.mock("@/lib/billing/guard", async () =>
	(await import("@/test/integration-harness")).billingGuard(),
);
vi.mock("@/lib/app-url", async (original) => ({
	...(await original<typeof import("@/lib/app-url")>()),
	getOrganizationBaseUrl: async () => "https://t984.example.test",
}));
vi.mock("@/lib/email/email-service", async () =>
	(await import("@/test/integration-harness")).emailService(),
);
vi.mock("@/lib/email/render", async (original) =>
	(await import("@/test/integration-harness")).absenceEmailRender(original),
);
vi.mock("@/lib/notifications/triggers", async (original) =>
	(await import("@/test/integration-harness")).notificationTriggers(original),
);
vi.mock("@/lib/queue", async (original) =>
	(await import("@/test/integration-harness")).calendarSyncQueue(original),
);
vi.mock("@/lib/work-balance/service", async (original) => ({
	...(await original<typeof import("@/lib/work-balance/service")>()),
	markEmployeeWorkBalanceDirty: async () => undefined,
}));
vi.mock("@/lib/approvals/delivery/kick", async () =>
	(await import("@/test/integration-harness")).deliveryKick(),
);
vi.mock("@/lib/notifications/notification-service", () => ({
	createNotification: async (params: CreateNotificationParams) => {
		harness.notifications.push(params);
		return null;
	},
}));
vi.mock("@/lib/storage/s3-client", () => ({
	S3_PUBLIC_BUCKET: "t984-public",
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
		return { bucket: "t984-private", versionId: null };
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

const { POST: finalizeUpload } = await import("@/app/api/upload/personnel-file/route");
const { GET: serveDocument } = await import(
	"@/app/api/personnel-files/documents/[documentId]/route"
);
const { recordAbsenceWithSickNotes } = await import("@/app/[locale]/(app)/team/absences/actions");
const personnelFileActions = await import("@/app/[locale]/(app)/personnel-files/actions");
const sickNoteLinkActions = await import("@/app/[locale]/(app)/personnel-files/sick-note-actions");
const sickNoteActions = await import("@/app/[locale]/(app)/absences/sick-note-actions");
const { resolvePersonnelFileAccess } = await import("./access-store");
const { countSickNotesForAbsences } = await import("./sick-note-store");
const { seedPersonnelFileOfficerGrant } = await import("./testing/officer-grant.test.fixture");
const { createOwnedTusFileKey } = await import("@/lib/upload/tus-ownership");
const { db } = await import("@/db");

const ORG = "t984-org";
const OTHER_ORG = "t984-other-org";

const ids = {
	owner: "e9840000-0000-4000-8000-000000000001",
	officer: "e9840000-0000-4000-8000-000000000002",
	certOfficer: "e9840000-0000-4000-8000-000000000003",
	manager: "e9840000-0000-4000-8000-000000000004",
	anna: "e9840000-0000-4000-8000-000000000005",
	ben: "e9840000-0000-4000-8000-000000000006",
	outsider: "e9840000-0000-4000-8000-000000000007",
	berlin: "e9841000-0000-4000-8000-000000000001",
	sick: "e9842000-0000-4000-8000-000000000001",
	vacation: "e9842000-0000-4000-8000-000000000002",
	otherSick: "e9842000-0000-4000-8000-000000000003",
} as const;
type Person = "owner" | "officer" | "certOfficer" | "manager" | "anna" | "ben" | "outsider";
const userOf = (person: Person) => `t984-${person}`;
const SEEDED_AT = new Date("2026-06-01T00:00:00Z");

const admin = integrationAdminPool();
const pdf = (text: string) => Buffer.from(`%PDF-1.4\n% ${text}\n%%EOF`);

async function cleanup() {
	await admin.query("delete from organization where id = any($1::text[])", [[ORG, OTHER_ORG]]);
	await admin.query("delete from personnel_file_upload where organization_id = any($1::text[])", [
		[ORG, OTHER_ORG],
	]);
	await admin.query('delete from "user" where id like $1', ["t984-%"]);
}

async function seedPerson(
	person: Person,
	input: {
		name: string;
		memberRole: string;
		employeeRole?: string;
		organizationId?: string;
		teamId?: string | null;
	},
) {
	const organizationId = input.organizationId ?? ORG;
	await admin.query(
		'insert into "user" (id,name,email,created_at,updated_at) values ($1,$2,$3,$4,$4)',
		[userOf(person), input.name, `${userOf(person)}@example.test`, SEEDED_AT],
	);
	await admin.query(
		"insert into member (id,organization_id,user_id,role,status,created_at) values ($1,$2,$3,$4,'approved',$5)",
		[`t984-member-${person}`, organizationId, userOf(person), input.memberRole, SEEDED_AT],
	);
	await admin.query(
		"insert into employee (id,user_id,organization_id,role,team_id,is_active,updated_at) values ($1,$2,$3,$4,$5,true,$6)",
		[
			ids[person],
			userOf(person),
			organizationId,
			input.employeeRole ?? "employee",
			input.teamId ?? null,
			SEEDED_AT,
		],
	);
	await admin.query(
		"insert into user_settings (user_id, locale, timezone, time_format, updated_at) values ($1, 'en', 'UTC', '24h', $2)",
		[userOf(person), SEEDED_AT],
	);
	if (input.teamId) {
		await admin.query(
			"insert into team_membership (organization_id, team_id, employee_id) values ($1, $2, $3)",
			[organizationId, input.teamId, ids[person]],
		);
	}
}

async function seed() {
	await cleanup();
	for (const organizationId of [ORG, OTHER_ORG]) {
		await admin.query(
			`insert into organization (id, name, slug, timezone, personnel_files_enabled, created_at)
			 values ($1, $1, $1, 'UTC', true, $2)`,
			[organizationId, SEEDED_AT],
		);
	}
	await admin.query(
		"insert into team (id, organization_id, name, updated_at) values ($1, $2, 'Berlin', $3)",
		[ids.berlin, ORG, SEEDED_AT],
	);
	await seedPerson("owner", { name: "Olga Owner", memberRole: "owner", employeeRole: "admin" });
	// Otto is in Berlin himself: his grant covers his team, never his own file.
	await seedPerson("officer", { name: "Otto Officer", memberRole: "member", teamId: ids.berlin });
	await seedPerson("certOfficer", { name: "Carl Certificates", memberRole: "member" });
	await seedPerson("manager", {
		name: "Max Manager",
		memberRole: "member",
		employeeRole: "manager",
	});
	await seedPerson("anna", { name: "Anna Example", memberRole: "member", teamId: ids.berlin });
	await seedPerson("ben", { name: "Ben Other", memberRole: "member" });
	await seedPerson("outsider", {
		name: "Oscar Outsider",
		memberRole: "member",
		organizationId: OTHER_ORG,
	});
	for (const report of ["anna", "ben"] as const) {
		await admin.query(
			`insert into employee_managers
			 (id, employee_id, manager_id, is_primary, assigned_by, assigned_at, created_at)
			 values (gen_random_uuid(), $1, $2, true, $3, $4, $4)`,
			[ids[report], ids.manager, userOf("owner"), SEEDED_AT],
		);
	}
	await admin.query(
		`insert into absence_category
		 (id, organization_id, type, name, requires_approval, counts_against_vacation, is_active, updated_at)
		 values ($1, $3, 'sick', 'Sick leave', true, false, true, $4),
		        ($2, $3, 'vacation', 'Vacation', true, true, true, $4)`,
		[ids.sick, ids.vacation, ORG, SEEDED_AT],
	);
	await admin.query(
		`insert into absence_category
		 (id, organization_id, type, name, requires_approval, counts_against_vacation, is_active, updated_at)
		 values ($1, $2, 'sick', 'Sick leave', true, false, true, $3)`,
		[ids.otherSick, OTHER_ORG, SEEDED_AT],
	);
	// Otto covers Berlin's sick notes; Carl covers Berlin's certificates only.
	await seedPersonnelFileOfficerGrant(admin, {
		organizationId: ORG,
		officerEmployeeId: ids.officer,
		createdBy: userOf("owner"),
		teamIds: [ids.berlin],
		categories: ["sick_note"],
	});
	await seedPersonnelFileOfficerGrant(admin, {
		organizationId: ORG,
		officerEmployeeId: ids.certOfficer,
		createdBy: userOf("owner"),
		teamIds: [ids.berlin],
		categories: ["certificate"],
	});
	// Employees may not attach sick notes themselves: recorders and officers still may.
	await admin.query(
		`insert into absence_setting (organization_id, employee_sick_note_upload, updated_at, updated_by)
		 values ($1, false, $2, $3)`,
		[ORG, SEEDED_AT, userOf("owner")],
	);
}

function signIn(person: Person) {
	harness.userId = userOf(person);
	harness.organizationId = person === "outsider" ? OTHER_ORG : ORG;
}

let nextStart = 0;
/** A fresh date range per absence, so absences never overlap. */
function nextRange(days = 3): { startDate: string; endDate: string } {
	const start = new Date(Date.UTC(2026, 9, 5 + nextStart * 7));
	nextStart += 1;
	const end = new Date(start.getTime() + (days - 1) * 86_400_000);
	return {
		startDate: start.toISOString().slice(0, 10),
		endDate: end.toISOString().slice(0, 10),
	};
}

/** A finished TUS upload of the signed-in user. */
function stage(fileName: string, input: { title?: string; documentDate?: string } = {}) {
	if (!harness.userId) throw new Error("not signed in");
	const tusFileKey = createOwnedTusFileKey(harness.userId);
	harness.tus.set(tusFileKey, pdf(`${fileName}-${Math.random()}`));
	return {
		tusFileKey,
		fileName,
		title: input.title ?? `Sick note ${fileName}`,
		documentDate: input.documentDate ?? "2026-10-05",
	};
}

function recording(
	employee: "anna" | "ben",
	input: {
		category?: string;
		sickDetail?: "child_sick" | "with_certificate" | "without_certificate" | "other";
	} = {},
) {
	const category = input.category ?? ids.sick;
	return {
		employeeId: ids[employee],
		categoryId: category,
		...nextRange(),
		startPeriod: "full_day" as const,
		endPeriod: "full_day" as const,
		durationKind: "full_day" as const,
		...(category === ids.sick ? { sickDetail: input.sickDetail ?? "without_certificate" } : {}),
	};
}

/** An absence written directly, as earlier requests and decisions leave them. */
async function seedAbsence(
	employee: Person,
	input: {
		status?: "pending" | "approved" | "rejected";
		category?: string;
		organizationId?: string;
		sickDetail?: string | null;
	} = {},
): Promise<string> {
	const range = nextRange();
	const category = input.category ?? ids.sick;
	const { rows } = await admin.query<{ id: string }>(
		`insert into absence_entry
		 (employee_id, category_id, start_date, end_date, status, sick_detail, organization_id, updated_at)
		 values ($1, $2, $3, $4, $5, $6, $7, $8) returning id`,
		[
			ids[employee],
			category,
			range.startDate,
			range.endDate,
			input.status ?? "approved",
			input.sickDetail === undefined
				? category === ids.vacation
					? null
					: "without_certificate"
				: input.sickDetail,
			input.organizationId ?? ORG,
			SEEDED_AT,
		],
	);
	const id = rows[0]?.id;
	if (!id) throw new Error("absence not seeded");
	return id;
}

let documentCounter = 0;
/** A document uploaded earlier in the officer area, linked to nothing. */
async function seedDocument(
	employee: Person,
	input: { category?: string; organizationId?: string; absenceId?: string | null } = {},
): Promise<string> {
	documentCounter += 1;
	const id = `e9845000-0000-4000-8000-${String(documentCounter).padStart(12, "0")}`;
	const organizationId = input.organizationId ?? ORG;
	await admin.query(
		`insert into employee_document
		 (id, organization_id, employee_id, category, title, document_date, visibility, absence_entry_id,
		  storage_provider, storage_bucket, storage_key, file_name, mime_type, size_bytes, checksum_sha256)
		 values ($1, $2, $3, $4, $5, '2026-09-01', 'hr_only', $6,
		  's3-private', 't984-private', $7, 'note.pdf', 'application/pdf', 10, 'x')`,
		[
			id,
			organizationId,
			ids[employee],
			input.category ?? "sick_note",
			`Document ${documentCounter}`,
			input.absenceId ?? null,
			`personnel-files/${organizationId}/${ids[employee]}/${id}-note.pdf`,
		],
	);
	return id;
}

async function linkedNotes(absenceId: string) {
	const { rows } = await admin.query<{
		id: string;
		title: string;
		visibility: string;
		uploaded_by: string | null;
	}>(
		`select id, title, visibility, uploaded_by
		 from employee_document where absence_entry_id = $1 order by created_at, title`,
		[absenceId],
	);
	return rows;
}

async function linkOf(documentId: string): Promise<string | null> {
	const { rows } = await admin.query<{ absence_entry_id: string | null }>(
		"select absence_entry_id from employee_document where id = $1",
		[documentId],
	);
	return rows[0]?.absence_entry_id ?? null;
}

async function sickDetailOf(absenceId: string): Promise<string | null> {
	const { rows } = await admin.query<{ sick_detail: string | null }>(
		"select sick_detail from absence_entry where id = $1",
		[absenceId],
	);
	return rows[0]?.sick_detail ?? null;
}

async function auditOf(documentId: string, action: string) {
	const { rows } = await admin.query<{ performed_by: string; metadata: string; changes: string }>(
		"select performed_by, metadata, changes from audit_log where entity_id = $1 and action = $2",
		[documentId, action],
	);
	return rows.map((row) => ({
		performedBy: row.performed_by,
		metadata: JSON.parse(row.metadata) as Record<string, unknown>,
		changes: row.changes ? (JSON.parse(row.changes) as Record<string, unknown>) : null,
	}));
}

/** The officer area's upload, attaching a new note to an employee's absence. */
async function officerAttach(
	absenceId: string,
	input: { employeeId?: string; visibility?: "shared" | "hr_only"; title?: string } = {},
) {
	if (!harness.userId) throw new Error("not signed in");
	const tusFileKey = createOwnedTusFileKey(harness.userId);
	harness.tus.set(tusFileKey, pdf(`${absenceId}-${Math.random()}`));
	return finalizeUpload(
		new Request("http://localhost/api/upload/personnel-file", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				tusFileKey,
				employeeId: input.employeeId ?? ids.anna,
				fileName: "sick-note.pdf",
				absenceId,
				metadata: {
					category: "sick_note",
					title: input.title ?? "Sick note",
					documentDate: "2026-10-12",
					...(input.visibility ? { visibility: input.visibility } : {}),
				},
			}),
		}) as unknown as NextRequest,
	);
}

async function officerAttachOk(
	absenceId: string,
	input: Parameters<typeof officerAttach>[1] = {},
): Promise<{ id: string; visibility: string }> {
	const response = await officerAttach(absenceId, input);
	const body = (await response.json()) as {
		document?: { id: string; visibility: string };
		error?: string;
	};
	if (response.status !== 200 || !body.document) {
		throw new Error(`attach failed: ${response.status} ${body.error}`);
	}
	return body.document;
}

function serve(documentId: string) {
	return serveDocument(
		new Request(`http://localhost/api/personnel-files/documents/${documentId}`) as never,
		{ params: Promise.resolve({ documentId }) },
	);
}

describe("sick notes recorded on the employee's behalf and managed by officers (#984)", () => {
	beforeAll(seed);
	afterAll(cleanup);
	beforeEach(async () => {
		harness.notifications.length = 0;
		harness.tus.clear();
		await admin.query(
			"update organization set personnel_files_enabled = true where id = any($1::text[])",
			[[ORG, OTHER_ORG]],
		);
	});

	describe("recording sick leave with a sick note", () => {
		it("links a shared note the employee sees, while the manager sees only the marker", async () => {
			signIn("manager");
			const photo = stage("photo.pdf", { title: "Sick note from the doctor" });

			const result = await recordAbsenceWithSickNotes(recording("anna"), [photo]);

			if (!result.success) throw new Error(result.error);
			expect(result.data.sickNotes).toEqual({ attached: 1, failed: [] });
			const absenceId = result.data.absenceId;
			const [note] = await linkedNotes(absenceId);
			expect(note).toMatchObject({
				title: "Sick note from the doctor",
				visibility: "shared",
				uploaded_by: userOf("manager"),
			});
			if (!note) throw new Error("no note");
			expect(await sickDetailOf(absenceId)).toBe("with_certificate");
			expect(harness.tus.size).toBe(0);

			// Write-only: the manager may not open what they uploaded.
			expect(await sickNoteActions.listAbsenceSickNotesAction(absenceId)).toEqual({
				success: true,
				data: [],
			});
			expect((await serve(note.id)).status).toBe(404);
			const managerAccess = await resolvePersonnelFileAccess(db, {
				userId: userOf("manager"),
				organizationId: ORG,
			});
			const markers = await countSickNotesForAbsences(db, {
				organizationId: ORG,
				absenceIds: [absenceId],
				access: managerAccess,
			});
			expect(markers.get(absenceId)).toEqual({ count: 1, viewable: false });
			// Nor may they delete it.
			expect(
				await personnelFileActions.deleteEmployeeDocumentAction({ documentId: note.id }),
			).toMatchObject({ success: false });

			// The employee sees their own note.
			signIn("anna");
			const mine = await personnelFileActions.getMyDocumentsAction();
			expect(mine.success && mine.data.map((document) => document.id)).toContain(note.id);
			expect(await sickNoteActions.listAbsenceSickNotesAction(absenceId)).toMatchObject({
				success: true,
				data: [expect.objectContaining({ id: note.id, canDelete: false })],
			});
		});

		it("notifies the covering officer naming the recorder, and audits the upload as theirs", async () => {
			signIn("manager");
			const result = await recordAbsenceWithSickNotes(recording("anna"), [stage("scan.pdf")]);
			if (!result.success) throw new Error(result.error);
			const [note] = await linkedNotes(result.data.absenceId);
			if (!note) throw new Error("no note");

			const notified = harness.notifications.filter(
				(notification) => notification.type === "personnel_file_employee_upload",
			);
			expect(notified.map((notification) => notification.userId)).toEqual([userOf("officer")]);
			expect(notified[0]?.message).toMatch(/^Max Manager uploaded a sick note for Anna Example, /u);
			const [upload] = await auditOf(note.id, "personnel_file.document_uploaded");
			expect(upload).toMatchObject({
				performedBy: userOf("manager"),
				metadata: { source: "recorder", absenceId: result.data.absenceId },
			});
		});

		it("lets an admin record and attach for anyone, without notifying themselves", async () => {
			signIn("owner");
			const result = await recordAbsenceWithSickNotes(recording("ben"), [stage("ben.pdf")]);
			if (!result.success) throw new Error(result.error);
			expect(result.data.sickNotes).toEqual({ attached: 1, failed: [] });
			// Nobody covers Ben: owners and admins are told, but not the recorder.
			expect(
				harness.notifications
					.filter((notification) => notification.type === "personnel_file_employee_upload")
					.map((notification) => notification.userId),
			).not.toContain(userOf("owner"));
		});

		it("records the absence but attaches nothing to a vacation, and deletes the uploads", async () => {
			signIn("manager");
			const result = await recordAbsenceWithSickNotes(
				recording("anna", { category: ids.vacation }),
				[stage("a.pdf")],
			);
			if (!result.success) throw new Error(result.error);
			expect(result.data.sickNotes).toMatchObject({ attached: 0, failed: [{ fileName: "a.pdf" }] });
			expect(await linkedNotes(result.data.absenceId)).toEqual([]);
			expect(harness.tus.size).toBe(0);
		});

		it("records the absence but attaches nothing while personnel files are off", async () => {
			await admin.query("update organization set personnel_files_enabled = false where id = $1", [
				ORG,
			]);
			signIn("manager");
			const result = await recordAbsenceWithSickNotes(recording("anna"), [stage("a.pdf")]);
			if (!result.success) throw new Error(result.error);
			expect(result.data.sickNotes?.attached).toBe(0);
			expect(await linkedNotes(result.data.absenceId)).toEqual([]);
			expect(harness.tus.size).toBe(0);
		});

		it("stores nothing and deletes the uploads when the recording fails", async () => {
			signIn("manager");
			const leave = recording("anna");
			const first = await recordAbsenceWithSickNotes(leave, []);
			if (!first.success) throw new Error(first.error);

			const overlapping = await recordAbsenceWithSickNotes(leave, [stage("a.pdf")]);

			expect(overlapping.success).toBe(false);
			expect(harness.tus.size).toBe(0);
			expect(await linkedNotes(first.data.absenceId)).toEqual([]);
		});

		it("refuses a manager attaching to an absence outside the recording", async () => {
			const absenceId = await seedAbsence("anna");
			signIn("manager");
			const response = await officerAttach(absenceId);
			expect(response.status).toBe(404);
			expect(await linkedNotes(absenceId)).toEqual([]);
		});
	});

	describe("officers attaching a new note", () => {
		it("attaches an HR-only note the employee counts but cannot open", async () => {
			const absenceId = await seedAbsence("anna");
			signIn("officer");
			const document = await officerAttachOk(absenceId);
			expect(document.visibility).toBe("hr_only");
			expect(await linkOf(document.id)).toBe(absenceId);
			expect(await sickDetailOf(absenceId)).toBe("with_certificate");
			const [upload] = await auditOf(document.id, "personnel_file.document_uploaded");
			expect(upload).toMatchObject({ performedBy: userOf("officer"), metadata: { absenceId } });
			// Officers' own uploads do not notify other officers.
			expect(harness.notifications).toEqual([]);

			signIn("anna");
			const own = await sickNoteActions.getOwnAbsenceSickNotesAction([absenceId]);
			expect(own.success && own.data.markers[absenceId]).toEqual({ count: 1, viewable: false });
			expect(await sickNoteActions.listAbsenceSickNotesAction(absenceId)).toEqual({
				success: true,
				data: [],
			});
		});

		it("may share it with the employee, who is told", async () => {
			const absenceId = await seedAbsence("anna", { status: "pending" });
			signIn("officer");
			const document = await officerAttachOk(absenceId, { visibility: "shared" });
			expect(document.visibility).toBe("shared");
			expect(
				harness.notifications.map((notification) => [notification.type, notification.userId]),
			).toEqual([["personnel_file_document_shared", userOf("anna")]]);
		});

		it("refuses an officer without sick notes in their grant", async () => {
			const absenceId = await seedAbsence("anna");
			signIn("certOfficer");
			expect((await officerAttach(absenceId)).status).toBe(404);
			expect(await linkedNotes(absenceId)).toEqual([]);
		});

		it("refuses an officer's own absence", async () => {
			const absenceId = await seedAbsence("officer");
			signIn("officer");
			expect((await officerAttach(absenceId, { employeeId: ids.officer })).status).toBe(404);
		});

		it("refuses a rejected absence or one that is no sick leave", async () => {
			const rejected = await seedAbsence("anna", { status: "rejected" });
			const vacation = await seedAbsence("anna", { category: ids.vacation });
			signIn("officer");
			expect((await officerAttach(rejected)).status).toBe(403);
			expect((await officerAttach(vacation)).status).toBe(403);
		});

		it("refuses another employee's absence under this employee's file", async () => {
			const bensAbsence = await seedAbsence("ben");
			signIn("owner");
			expect((await officerAttach(bensAbsence, { employeeId: ids.anna })).status).toBe(404);
		});
	});

	describe("officers linking and unlinking existing notes", () => {
		it("links an unlinked sick note, switches the certificate detail, and unlinks it again", async () => {
			const absenceId = await seedAbsence("anna");
			const documentId = await seedDocument("anna");
			signIn("officer");

			const linked = await sickNoteLinkActions.linkSickNoteAction({ documentId, absenceId });
			expect(linked).toMatchObject({
				success: true,
				data: { id: documentId, absence: { id: absenceId } },
			});
			expect(await linkOf(documentId)).toBe(absenceId);
			expect(await sickDetailOf(absenceId)).toBe("with_certificate");
			expect(await auditOf(documentId, "personnel_file.sick_note_linked")).toEqual([
				expect.objectContaining({
					performedBy: userOf("officer"),
					metadata: expect.objectContaining({ absenceId }),
				}),
			]);

			const unlinked = await sickNoteLinkActions.unlinkSickNoteAction({ documentId });
			expect(unlinked).toMatchObject({ success: true, data: { id: documentId, absence: null } });
			expect(await linkOf(documentId)).toBeNull();
			// Removing the note never switches the detail back.
			expect(await sickDetailOf(absenceId)).toBe("with_certificate");
			expect(await auditOf(documentId, "personnel_file.sick_note_unlinked")).toEqual([
				expect.objectContaining({
					performedBy: userOf("officer"),
					metadata: expect.objectContaining({ absenceId }),
				}),
			]);
		});

		it("lists the employee's sick leave to link to, newest first, without rejected or other leave", async () => {
			const older = await seedAbsence("anna", { status: "pending" });
			const newer = await seedAbsence("anna");
			const rejected = await seedAbsence("anna", { status: "rejected" });
			const vacation = await seedAbsence("anna", { category: ids.vacation });
			signIn("officer");
			const result = await sickNoteLinkActions.listSickLeaveForLinkingAction(ids.anna);
			if (!result.success) throw new Error(result.error);
			const listed = result.data.map((absence) => absence.id);
			expect(listed.indexOf(newer)).toBeLessThan(listed.indexOf(older));
			expect(listed).not.toContain(rejected);
			expect(listed).not.toContain(vacation);

			signIn("certOfficer");
			expect(await sickNoteLinkActions.listSickLeaveForLinkingAction(ids.anna)).toMatchObject({
				success: false,
			});
		});

		it("refuses an officer without sick notes in their grant", async () => {
			const absenceId = await seedAbsence("anna");
			const documentId = await seedDocument("anna");
			signIn("certOfficer");
			expect(await sickNoteLinkActions.linkSickNoteAction({ documentId, absenceId })).toMatchObject(
				{ success: false },
			);
			expect(await linkOf(documentId)).toBeNull();
		});

		it("refuses another employee's document", async () => {
			const absenceId = await seedAbsence("anna");
			const bensDocument = await seedDocument("ben");
			signIn("owner");
			expect(
				await sickNoteLinkActions.linkSickNoteAction({ documentId: bensDocument, absenceId }),
			).toMatchObject({ success: false });
			expect(await linkOf(bensDocument)).toBeNull();
		});

		it("refuses a certificate", async () => {
			const absenceId = await seedAbsence("anna");
			const certificate = await seedDocument("anna", { category: "certificate" });
			signIn("owner");
			expect(
				await sickNoteLinkActions.linkSickNoteAction({ documentId: certificate, absenceId }),
			).toMatchObject({ success: false });
			expect(await linkOf(certificate)).toBeNull();
		});

		it("refuses a document or an absence of another organization", async () => {
			const absenceId = await seedAbsence("anna");
			const foreignDocument = await seedDocument("outsider", { organizationId: OTHER_ORG });
			const foreignAbsence = await seedAbsence("outsider", {
				organizationId: OTHER_ORG,
				category: ids.otherSick,
			});
			const documentId = await seedDocument("anna");
			signIn("owner");
			expect(
				await sickNoteLinkActions.linkSickNoteAction({ documentId: foreignDocument, absenceId }),
			).toMatchObject({ success: false });
			expect(
				await sickNoteLinkActions.linkSickNoteAction({ documentId, absenceId: foreignAbsence }),
			).toMatchObject({ success: false });
			expect(await linkOf(foreignDocument)).toBeNull();
			expect(await linkOf(documentId)).toBeNull();
		});

		it("refuses a rejected absence or one that is no sick leave", async () => {
			const rejected = await seedAbsence("anna", { status: "rejected" });
			const vacation = await seedAbsence("anna", { category: ids.vacation });
			const documentId = await seedDocument("anna");
			signIn("officer");
			for (const absenceId of [rejected, vacation]) {
				expect(
					await sickNoteLinkActions.linkSickNoteAction({ documentId, absenceId }),
				).toMatchObject({ success: false });
			}
			expect(await linkOf(documentId)).toBeNull();
		});

		it("refuses a note already linked to another absence", async () => {
			const first = await seedAbsence("anna");
			const second = await seedAbsence("anna");
			const documentId = await seedDocument("anna", { absenceId: first });
			signIn("officer");
			expect(
				await sickNoteLinkActions.linkSickNoteAction({ documentId, absenceId: second }),
			).toMatchObject({ success: false });
			expect(await linkOf(documentId)).toBe(first);
		});

		it("refuses an officer acting on their own personnel file", async () => {
			const absenceId = await seedAbsence("officer");
			const documentId = await seedDocument("officer");
			const linkedId = await seedDocument("officer", { absenceId });
			signIn("officer");
			expect(await sickNoteLinkActions.linkSickNoteAction({ documentId, absenceId })).toMatchObject(
				{ success: false },
			);
			expect(
				await sickNoteLinkActions.unlinkSickNoteAction({ documentId: linkedId }),
			).toMatchObject({ success: false });
			expect(await sickNoteLinkActions.listSickLeaveForLinkingAction(ids.officer)).toMatchObject({
				success: false,
			});
			expect(await linkOf(documentId)).toBeNull();
			expect(await linkOf(linkedId)).toBe(absenceId);
		});
	});
});
