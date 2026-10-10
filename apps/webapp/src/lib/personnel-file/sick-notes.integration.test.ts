/**
 * #982: employees attach sick notes to their own sick-leave absences (Personnel
 * File ADR 0002), against a disposable PostgreSQL database, in the legacy and
 * the canonical absence-approval lifecycle mode. Absences are requested,
 * rejected and cancelled through the real absence actions; sick notes go
 * through the real upload route and personnel file actions. Only the session,
 * billing guard, e-mail and notification delivery, calendar queue, work
 * balance marking and object storage are replaced.
 */

import type { NextRequest } from "next/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { CreateNotificationParams } from "@/lib/notifications/types";
import { integrationAdminPool } from "@/test/integration-database";

const harness = vi.hoisted(() => ({
	userId: null as string | null,
	organizationId: "t982-org",
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
							user: { id: harness.userId, role: "user", email: `${harness.userId}@example.test` },
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
	getOrganizationBaseUrl: async () => "https://t982.example.test",
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
	S3_PUBLIC_BUCKET: "t982-public",
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
		return { bucket: "t982-private", versionId: null };
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
const { requestAbsenceEffect } = await import(
	"@/app/[locale]/(app)/absences/request-absence-effect"
);
const { cancelAbsenceRequest } = await import("@/app/[locale]/(app)/absences/mutations");
const { rejectAbsenceEffect } = await import("@/lib/approvals/server/absence-approvals");
const { getPendingApprovals } = await import("@/lib/approvals/server/queries");
const personnelFileActions = await import("@/app/[locale]/(app)/personnel-files/actions");
const sickNoteActions = await import("@/app/[locale]/(app)/absences/sick-note-actions");
const { saveEmployeeSickNoteUpload } = await import("@/lib/absences/absence-settings");
const { resolvePersonnelFileAccess } = await import("./access-store");
const { deleteDocument } = await import("./document-store");
const { countSickNotesForAbsences } = await import("./sick-note-store");
const { seedPersonnelFileOfficerGrant } = await import("./testing/officer-grant.test.fixture");
const { createOwnedTusFileKey } = await import("@/lib/upload/tus-ownership");
const { parseInstant } = await import("@/lib/datetime/temporal-core");
const { db } = await import("@/db");

const ORG = "t982-org";
const OTHER_ORG = "t982-other-org";

const ids = {
	owner: "e9820000-0000-4000-8000-000000000001",
	officer: "e9820000-0000-4000-8000-000000000002",
	manager: "e9820000-0000-4000-8000-000000000003",
	anna: "e9820000-0000-4000-8000-000000000004",
	ben: "e9820000-0000-4000-8000-000000000005",
	leaver: "e9820000-0000-4000-8000-000000000006",
	outsider: "e9820000-0000-4000-8000-000000000007",
	berlin: "e9821000-0000-4000-8000-000000000001",
	sick: "e9822000-0000-4000-8000-000000000001",
	vacation: "e9822000-0000-4000-8000-000000000002",
	otherSick: "e9822000-0000-4000-8000-000000000003",
	otherAbsence: "e9823000-0000-4000-8000-000000000001",
} as const;
type Person = "owner" | "officer" | "manager" | "anna" | "ben" | "leaver" | "outsider";
const userOf = (person: Person) => `t982-${person}`;
const SEEDED_AT = new Date("2026-06-01T00:00:00Z");

const admin = integrationAdminPool();
const pdf = (text: string) => Buffer.from(`%PDF-1.4\n% ${text}\n%%EOF`);

async function cleanup() {
	await admin.query("delete from organization where id = any($1::text[])", [[ORG, OTHER_ORG]]);
	await admin.query("delete from personnel_file_upload where organization_id = any($1::text[])", [
		[ORG, OTHER_ORG],
	]);
	await admin.query('delete from "user" where id like $1', ["t982-%"]);
}

async function seedPerson(
	person: Person,
	input: {
		name: string;
		memberRole: string;
		employeeRole?: string;
		organizationId?: string;
		teamId?: string | null;
		isActive?: boolean;
	},
) {
	const organizationId = input.organizationId ?? ORG;
	await admin.query(
		'insert into "user" (id,name,email,created_at,updated_at) values ($1,$2,$3,$4,$4)',
		[userOf(person), input.name, `${userOf(person)}@example.test`, SEEDED_AT],
	);
	await admin.query(
		"insert into member (id,organization_id,user_id,role,status,created_at) values ($1,$2,$3,$4,'approved',$5)",
		[`t982-member-${person}`, organizationId, userOf(person), input.memberRole, SEEDED_AT],
	);
	await admin.query(
		"insert into employee (id,user_id,organization_id,role,team_id,is_active,updated_at) values ($1,$2,$3,$4,$5,$6,$7)",
		[
			ids[person],
			userOf(person),
			organizationId,
			input.employeeRole ?? "employee",
			input.teamId ?? null,
			input.isActive ?? true,
			SEEDED_AT,
		],
	);
	await admin.query(
		"insert into user_settings (user_id, locale, timezone, time_format, updated_at) values ($1, 'en', 'UTC', '24h', $2)",
		[userOf(person), SEEDED_AT],
	);
}

async function seed(mode: "legacy" | "canonical") {
	await cleanup();
	await admin.query(
		`insert into organization (id, name, slug, timezone, personnel_files_enabled, created_at)
		 values ($1, $1, $1, 'UTC', true, $3), ($2, $2, $2, 'UTC', true, $3)`,
		[ORG, OTHER_ORG, SEEDED_AT],
	);
	await admin.query(
		`insert into approval_workflow_rollout
		 (organization_id, workflow_type, lifecycle_mode, side_effect_mode, created_at, updated_at)
		 values ($1, 'absence', $2, $3, $4, $4)`,
		[ORG, mode, mode, SEEDED_AT],
	);
	if (mode === "canonical") {
		await admin.query(
			`insert into approval_evidence_control (organization_id, workflow_type, mode)
			 values ($1, 'absence', 'capture')`,
			[ORG],
		);
	}
	await admin.query(
		"insert into team (id, organization_id, name, updated_at) values ($1, $2, 'Berlin', $3)",
		[ids.berlin, ORG, SEEDED_AT],
	);
	await seedPerson("owner", { name: "Olga Owner", memberRole: "owner", employeeRole: "admin" });
	await seedPerson("officer", { name: "Otto Officer", memberRole: "member" });
	await seedPerson("manager", {
		name: "Mia Manager",
		memberRole: "member",
		employeeRole: "manager",
	});
	await seedPerson("anna", { name: "Anna Example", memberRole: "member", teamId: ids.berlin });
	// The canonical absence adapter trusts a primary team only with its membership row.
	await admin.query(
		"insert into team_membership (organization_id, team_id, employee_id) values ($1, $2, $3)",
		[ORG, ids.berlin, ids.anna],
	);
	await seedPerson("ben", { name: "Ben Example", memberRole: "member" });
	await seedPerson("leaver", { name: "Lea Leaver", memberRole: "member", isActive: false });
	await seedPerson("outsider", {
		name: "Oscar Outsider",
		memberRole: "member",
		organizationId: OTHER_ORG,
	});
	for (const employee of [ids.anna, ids.ben, ids.leaver]) {
		await admin.query(
			`insert into employee_managers
			 (id, employee_id, manager_id, is_primary, assigned_by, assigned_at, created_at)
			 values (gen_random_uuid(), $1, $2, true, $3, $4, $4)`,
			[employee, ids.manager, userOf("owner"), SEEDED_AT],
		);
	}
	// Approval required, so requests stay pending (sick leave is auto-approved by default).
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
		 values ($1, $2, 'sick', 'Sick leave', false, false, true, $3)`,
		[ids.otherSick, OTHER_ORG, SEEDED_AT],
	);
	await admin.query(
		`insert into absence_entry
		 (id, employee_id, category_id, start_date, end_date, status, sick_detail, organization_id, updated_at)
		 values ($1, $2, $3, '2026-10-12', '2026-10-13', 'approved', 'without_certificate', $4, $5)`,
		[ids.otherAbsence, ids.outsider, ids.otherSick, OTHER_ORG, SEEDED_AT],
	);
	// Otto covers Berlin's sick notes.
	await seedPersonnelFileOfficerGrant(admin, {
		organizationId: ORG,
		officerEmployeeId: ids.officer,
		createdBy: userOf("owner"),
		teamIds: [ids.berlin],
		categories: ["sick_note"],
	});
	expect(
		await saveEmployeeSickNoteUpload(db, {
			organizationId: ORG,
			enabled: true,
			actorUserId: userOf("owner"),
		}),
	).toEqual({ kind: "saved", employeeSickNoteUpload: true });
}

function signIn(person: Person, organizationId = ORG) {
	harness.userId = userOf(person);
	harness.organizationId = organizationId;
}

let nextStart = 0;
/** A fresh date range per request, so requests never overlap. */
function nextRange(days = 3): { startDate: string; endDate: string } {
	const start = new Date(Date.UTC(2026, 9, 5 + nextStart * 7));
	nextStart += 1;
	const end = new Date(start.getTime() + (days - 1) * 86_400_000);
	return {
		startDate: start.toISOString().slice(0, 10),
		endDate: end.toISOString().slice(0, 10),
	};
}

async function requestAbsence(
	person: Person,
	input: {
		category?: string;
		sickDetail?: "child_sick" | "with_certificate" | "without_certificate" | "other";
	} = {},
): Promise<{ id: string; startDate: string; endDate: string }> {
	signIn(person);
	const range = nextRange();
	const category = input.category ?? ids.sick;
	const result = await requestAbsenceEffect({
		categoryId: category,
		...range,
		startPeriod: "full_day",
		endPeriod: "full_day",
		durationKind: "full_day",
		...(category === ids.sick ? { sickDetail: input.sickDetail ?? "without_certificate" } : {}),
	});
	if (!result.success) throw new Error(`Absence request failed: ${result.error}`);
	return { id: result.data.absenceId, ...range };
}

async function attach(
	absenceId: string,
	input: { employeeId?: string; title?: string; documentDate?: string } = {},
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
				source: "own",
				absenceId,
				metadata: {
					category: "sick_note",
					title: input.title ?? "Sick note",
					documentDate: input.documentDate ?? "2026-10-12",
				},
			}),
		}) as unknown as NextRequest,
	);
}

async function attachOk(absenceId: string, title = "Sick note"): Promise<string> {
	const response = await attach(absenceId, { title });
	const body = (await response.json()) as { document?: { id: string }; error?: string };
	if (response.status !== 200 || !body.document) {
		throw new Error(`attach failed: ${response.status} ${body.error}`);
	}
	return body.document.id;
}

async function sickDetailOf(absenceId: string): Promise<string | null> {
	const { rows } = await admin.query<{ sick_detail: string | null }>(
		"select sick_detail from absence_entry where id = $1",
		[absenceId],
	);
	return rows[0]?.sick_detail ?? null;
}

async function linkedNotes(absenceId: string) {
	const { rows } = await admin.query<{ id: string; category: string; visibility: string }>(
		"select id, category, visibility from employee_document where absence_entry_id = $1 order by created_at",
		[absenceId],
	);
	return rows;
}

describe.each(["legacy", "canonical"] as const)("sick notes on absences (#982, %s)", (mode) => {
	beforeAll(() => seed(mode));
	afterAll(cleanup);
	beforeEach(async () => {
		harness.notifications.length = 0;
		await admin.query("update organization set personnel_files_enabled = true where id = $1", [
			ORG,
		]);
		await admin.query(
			"update absence_setting set employee_sick_note_upload = true where organization_id = $1",
			[ORG],
		);
	});

	it("attaches each file as a shared sick note linked to the absence, notifying the covering officer per note", async () => {
		const absence = await requestAbsence("anna");
		signIn("anna");
		const first = await attachOk(absence.id, "Sick note page 1");
		const second = await attachOk(absence.id, "Sick note page 2");

		expect(await linkedNotes(absence.id)).toEqual([
			{ id: first, category: "sick_note", visibility: "shared" },
			{ id: second, category: "sick_note", visibility: "shared" },
		]);
		const mine = await personnelFileActions.getMyDocumentsAction();
		if (!mine.success) throw new Error(mine.error);
		expect(
			mine.data
				.filter((document) => document.absence?.id === absence.id)
				.map((document) => document.id)
				.toSorted(),
		).toEqual([first, second].toSorted());
		const onAbsence = await sickNoteActions.listAbsenceSickNotesAction(absence.id);
		expect(onAbsence).toMatchObject({ success: true });
		if (onAbsence.success) {
			expect(onAbsence.data.map((note) => [note.id, note.canDelete])).toEqual([
				[first, true],
				[second, true],
			]);
		}

		const notified = harness.notifications.filter(
			(notification) => notification.type === "personnel_file_employee_upload",
		);
		expect(notified.map((notification) => [notification.userId, notification.entityId])).toEqual([
			[userOf("officer"), first],
			[userOf("officer"), second],
		]);
		expect(notified[0]?.message).toMatch(/^Anna Example uploaded a sick note for .*2026$/u);
		expect(notified[0]?.actionUrl).toBe(`/personnel-files/${ids.anna}?category=sick_note`);

		const { rows: audits } = await admin.query<{ performed_by: string; metadata: string }>(
			"select performed_by, metadata from audit_log where entity_id = $1 and action = 'personnel_file.document_uploaded'",
			[first],
		);
		expect(audits).toHaveLength(1);
		expect(audits[0]?.performed_by).toBe(userOf("anna"));
		expect(JSON.parse(audits[0]?.metadata ?? "{}")).toMatchObject({
			source: "employee",
			absenceId: absence.id,
		});
	});

	it("turns without certificate into with certificate, audited once", async () => {
		const absence = await requestAbsence("anna", { sickDetail: "without_certificate" });
		signIn("anna");
		await attachOk(absence.id);
		await attachOk(absence.id);
		expect(await sickDetailOf(absence.id)).toBe("with_certificate");
		const { rows } = await admin.query<{ performed_by: string; changes: string }>(
			"select performed_by, changes from audit_log where entity_id = $1 and action = 'absence.sick_detail_changed'",
			[absence.id],
		);
		expect(rows).toHaveLength(1);
		expect(rows[0]?.performed_by).toBe(userOf("anna"));
		expect(JSON.parse(rows[0]?.changes ?? "{}")).toEqual({
			sickDetail: { from: "without_certificate", to: "with_certificate" },
		});
	});

	it("leaves child sick as it is", async () => {
		const absence = await requestAbsence("anna", { sickDetail: "child_sick" });
		signIn("anna");
		await attachOk(absence.id);
		expect(await sickDetailOf(absence.id)).toBe("child_sick");
	});

	it("shows a manager that notes are attached without letting them open one", async () => {
		const absence = await requestAbsence("anna");
		signIn("anna");
		const documentId = await attachOk(absence.id);

		const managerAccess = await resolvePersonnelFileAccess(db, {
			userId: userOf("manager"),
			organizationId: ORG,
		});
		expect(
			await countSickNotesForAbsences(db, {
				organizationId: ORG,
				absenceIds: [absence.id],
				access: managerAccess,
			}),
		).toEqual(new Map([[absence.id, { count: 1, viewable: false }]]));
		if (mode === "legacy") {
			signIn("manager");
			const pending = await getPendingApprovals();
			expect(
				pending.absenceApprovals.find((approval) => approval.absence.id === absence.id)?.absence
					.sickNotes,
			).toEqual({ count: 1, viewable: false });
		}

		signIn("manager");
		expect(await sickNoteActions.listAbsenceSickNotesAction(absence.id)).toEqual({
			success: true,
			data: [],
		});
		const direct = await serveDocument(
			new Request(`http://localhost/api/personnel-files/documents/${documentId}`) as never,
			{ params: Promise.resolve({ documentId }) },
		);
		expect(direct.status).toBe(404);

		// The covering officer may open it.
		signIn("officer");
		const officerView = await sickNoteActions.listAbsenceSickNotesAction(absence.id);
		expect(officerView.success && officerView.data.map((note) => note.id)).toEqual([documentId]);
	});

	it("lets the employee delete their own note within 24 hours only, and officers at any time", async () => {
		const absence = await requestAbsence("anna");
		signIn("anna");
		const early = await attachOk(absence.id);
		const late = await attachOk(absence.id);
		const officerDeletes = await attachOk(absence.id);

		expect(
			await personnelFileActions.deleteEmployeeDocumentAction({ documentId: early, reason: null }),
		).toMatchObject({ success: true });

		const { rows } = await admin.query<{ created_at: Date }>(
			"select created_at from employee_document where id = $1",
			[late],
		);
		const createdAt = rows[0]?.created_at;
		if (!createdAt) throw new Error("note not found");
		const uploadedAt = parseInstant(createdAt.toISOString());
		const annaAccess = await resolvePersonnelFileAccess(db, {
			userId: userOf("anna"),
			organizationId: ORG,
		});
		if (!annaAccess) throw new Error("no access");
		expect(
			await deleteDocument(
				db,
				annaAccess,
				{ documentId: late, reason: null },
				uploadedAt.add({ hours: 24 }),
			),
		).toEqual({ kind: "not_found" });

		const officerAccess = await resolvePersonnelFileAccess(db, {
			userId: userOf("officer"),
			organizationId: ORG,
		});
		if (!officerAccess) throw new Error("no access");
		expect(
			await deleteDocument(
				db,
				officerAccess,
				{ documentId: officerDeletes, reason: "Duplicate" },
				uploadedAt.add({ hours: 24 * 30 }),
			),
		).toMatchObject({ kind: "deleted" });

		expect((await linkedNotes(absence.id)).map((note) => note.id)).toEqual([late]);
		const { rows: audits } = await admin.query<{ performed_by: string; metadata: string }>(
			"select performed_by, metadata from audit_log where entity_id = $1 and action = 'personnel_file.document_deleted'",
			[early],
		);
		expect(audits[0]?.performed_by).toBe(userOf("anna"));
		expect(JSON.parse(audits[0]?.metadata ?? "{}")).toMatchObject({
			absenceId: absence.id,
			source: "employee",
		});
	});

	it("deletes every note with a cancelled absence, audited with the canceller, and cleans up their files", async () => {
		const absence = await requestAbsence("anna");
		signIn("anna");
		const notes = [await attachOk(absence.id), await attachOk(absence.id)];
		const { rows: keys } = await admin.query<{ storage_key: string }>(
			"select storage_key from employee_document where id = any($1::uuid[])",
			[notes],
		);
		expect(keys.every((key) => harness.objects.has(key.storage_key))).toBe(true);

		expect(await cancelAbsenceRequest(absence.id)).toEqual({ success: true });

		expect(await linkedNotes(absence.id)).toEqual([]);
		const { rows: remaining } = await admin.query(
			"select id from employee_document where id = any($1::uuid[])",
			[notes],
		);
		expect(remaining).toEqual([]);
		// The deletion trigger queued both files; the immediate cleanup removed them.
		expect(keys.some((key) => harness.objects.has(key.storage_key))).toBe(false);
		const { rows: audits } = await admin.query<{ performed_by: string; metadata: string }>(
			"select performed_by, metadata from audit_log where entity_id = any($1::uuid[]) and action = 'personnel_file.document_deleted'",
			[notes],
		);
		expect(audits).toHaveLength(2);
		for (const audit of audits) {
			expect(audit.performed_by).toBe(userOf("anna"));
			expect(JSON.parse(audit.metadata)).toMatchObject({
				absenceId: absence.id,
				cause: "absence_cancelled",
			});
		}
	});

	it("keeps the notes of a rejected absence and refuses new ones", async () => {
		const absence = await requestAbsence("anna");
		signIn("anna");
		const note = await attachOk(absence.id);
		signIn("manager");
		// A canonical decision names the stage assignment it decides.
		const { rows: targets } = await admin.query<{ id: string }>(
			`select sa.id from approval_stage_assignment sa
			 join absence_entry a on sa.workflow_id = a.approval_workflow_id
			 where a.id = $1`,
			[absence.id],
		);
		expect(
			await rejectAbsenceEffect(
				absence.id,
				"Please talk to me first",
				mode === "canonical" ? { approvalRequestId: targets[0]?.id } : undefined,
			),
		).toMatchObject({ success: true });
		expect((await linkedNotes(absence.id)).map((row) => row.id)).toEqual([note]);

		signIn("anna");
		const refused = await attach(absence.id);
		expect(refused.status).toBe(403);
	});

	it("removes the link when an officer moves a note to another category", async () => {
		const absence = await requestAbsence("anna");
		signIn("anna");
		const documentId = await attachOk(absence.id);
		signIn("owner");
		const result = await personnelFileActions.updateEmployeeDocumentAction({
			documentId,
			metadata: {
				category: "other",
				title: "Not a sick note",
				documentDate: "2026-10-12",
				payPeriod: null,
				visibility: "shared",
				expiryDate: null,
			},
		});
		expect(result).toMatchObject({ success: true, data: { category: "other", absence: null } });
		const { rows } = await admin.query<{ absence_entry_id: string | null }>(
			"select absence_entry_id from employee_document where id = $1",
			[documentId],
		);
		expect(rows[0]?.absence_entry_id).toBeNull();
		const { rows: audits } = await admin.query<{ changes: string; metadata: string }>(
			"select changes, metadata from audit_log where entity_id = $1 and action = 'personnel_file.document_updated'",
			[documentId],
		);
		expect(JSON.parse(audits[0]?.changes ?? "{}")).toMatchObject({
			absenceEntryId: { from: absence.id, to: null },
		});
		expect(JSON.parse(audits[0]?.metadata ?? "{}")).toMatchObject({ absenceId: absence.id });
	});

	describe("server refusals", () => {
		it("refuses while the setting is off, and the setting needs personnel files", async () => {
			const absence = await requestAbsence("anna");
			await admin.query(
				"update absence_setting set employee_sick_note_upload = false where organization_id = $1",
				[ORG],
			);
			signIn("anna");
			expect((await attach(absence.id)).status).toBe(403);
			expect(await sickNoteActions.getOwnAbsenceSickNotesAction([absence.id])).toMatchObject({
				success: true,
				data: { canAttach: false },
			});

			await admin.query("update organization set personnel_files_enabled = false where id = $1", [
				ORG,
			]);
			expect(
				await saveEmployeeSickNoteUpload(db, {
					organizationId: ORG,
					enabled: true,
					actorUserId: userOf("owner"),
				}),
			).toEqual({ kind: "personnel_files_disabled" });
			await admin.query(
				"update absence_setting set employee_sick_note_upload = true where organization_id = $1",
				[ORG],
			);
			expect((await attach(absence.id)).status).toBe(404);
			expect(await linkedNotes(absence.id)).toEqual([]);
		});

		it("refuses another employee's absence, a vacation and another organization's absence", async () => {
			const bens = await requestAbsence("ben");
			const vacation = await requestAbsence("anna", { category: ids.vacation });
			signIn("anna");
			expect((await attach(bens.id)).status).toBe(404);
			expect((await attach(bens.id, { employeeId: ids.ben })).status).toBe(404);
			expect((await attach(vacation.id)).status).toBe(403);
			expect((await attach(ids.otherAbsence)).status).toBe(404);
			for (const absenceId of [bens.id, vacation.id, ids.otherAbsence]) {
				expect(await linkedNotes(absenceId)).toEqual([]);
			}
		});

		it("refuses a former employee", async () => {
			await admin.query(
				`insert into absence_entry
				 (id, employee_id, category_id, start_date, end_date, status, sick_detail, organization_id, updated_at)
				 values (gen_random_uuid(), $1, $2, '2026-01-05', '2026-01-06', 'approved', 'without_certificate', $3, $4)
				 on conflict do nothing`,
				[ids.leaver, ids.sick, ORG, SEEDED_AT],
			);
			const { rows } = await admin.query<{ id: string }>(
				"select id from absence_entry where employee_id = $1 limit 1",
				[ids.leaver],
			);
			signIn("leaver");
			expect((await attach(rows[0]?.id as string, { employeeId: ids.leaver })).status).toBe(404);
		});
	});
});
