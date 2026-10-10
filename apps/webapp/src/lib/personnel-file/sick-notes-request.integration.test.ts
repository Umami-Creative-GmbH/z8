/**
 * #983: employees attach sick notes while requesting sick leave (Personnel
 * File ADR 0002), against a disposable PostgreSQL database, in the legacy and
 * the canonical absence-approval lifecycle mode. Requests go through the real
 * `requestAbsence` server action with staged TUS uploads; only the session,
 * billing guard, e-mail and notification delivery, calendar queue, work
 * balance marking and object storage are replaced.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { CreateNotificationParams } from "@/lib/notifications/types";
import { integrationAdminPool } from "@/test/integration-database";

const harness = vi.hoisted(() => ({
	userId: null as string | null,
	organizationId: "t983-org",
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
	getOrganizationBaseUrl: async () => "https://t983.example.test",
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
	S3_PUBLIC_BUCKET: "t983-public",
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
		return { bucket: "t983-private", versionId: null };
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

const { requestAbsence } = await import("@/app/[locale]/(app)/absences/actions");
const { discardStagedSickNoteUploadsAction } = await import(
	"@/app/[locale]/(app)/absences/sick-note-actions"
);
const { createOwnedTusFileKey } = await import("@/lib/upload/tus-ownership");

const ORG = "t983-org";

const ids = {
	owner: "e9830000-0000-4000-8000-000000000001",
	officer: "e9830000-0000-4000-8000-000000000002",
	anna: "e9830000-0000-4000-8000-000000000003",
	berlin: "e9831000-0000-4000-8000-000000000001",
	sick: "e9832000-0000-4000-8000-000000000001",
	vacation: "e9832000-0000-4000-8000-000000000002",
} as const;
type Person = "owner" | "officer" | "anna";
const userOf = (person: Person) => `t983-${person}`;
const SEEDED_AT = new Date("2026-06-01T00:00:00Z");

const admin = integrationAdminPool();
const pdf = (text: string) => Buffer.from(`%PDF-1.4\n% ${text}\n%%EOF`);
/** The first bytes of an iPhone HEIC photo: refused by byte sniffing. */
const heic = () =>
	Buffer.concat([
		Buffer.from([0x00, 0x00, 0x00, 0x18]),
		Buffer.from("ftypheic"),
		Buffer.from([0x00, 0x00, 0x00, 0x00]),
		Buffer.from("mif1heic"),
		Buffer.alloc(64),
	]);

async function cleanup() {
	await admin.query("delete from organization where id = $1", [ORG]);
	await admin.query("delete from personnel_file_upload where organization_id = $1", [ORG]);
	await admin.query('delete from "user" where id like $1', ["t983-%"]);
}

async function seedPerson(
	person: Person,
	input: { name: string; memberRole: string; employeeRole?: string; teamId?: string | null },
) {
	await admin.query(
		'insert into "user" (id,name,email,created_at,updated_at) values ($1,$2,$3,$4,$4)',
		[userOf(person), input.name, `${userOf(person)}@example.test`, SEEDED_AT],
	);
	await admin.query(
		"insert into member (id,organization_id,user_id,role,status,created_at) values ($1,$2,$3,$4,'approved',$5)",
		[`t983-member-${person}`, ORG, userOf(person), input.memberRole, SEEDED_AT],
	);
	await admin.query(
		"insert into employee (id,user_id,organization_id,role,team_id,is_active,updated_at) values ($1,$2,$3,$4,$5,true,$6)",
		[
			ids[person],
			userOf(person),
			ORG,
			input.employeeRole ?? "employee",
			input.teamId ?? null,
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
		 values ($1, $1, $1, 'UTC', true, $2)`,
		[ORG, SEEDED_AT],
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
	await seedPerson("anna", { name: "Anna Example", memberRole: "member", teamId: ids.berlin });
	// The canonical absence adapter trusts a primary team only with its membership row.
	await admin.query(
		"insert into team_membership (organization_id, team_id, employee_id) values ($1, $2, $3)",
		[ORG, ids.berlin, ids.anna],
	);
	await admin.query(
		`insert into employee_managers
		 (id, employee_id, manager_id, is_primary, assigned_by, assigned_at, created_at)
		 values (gen_random_uuid(), $1, $2, true, $3, $4, $4)`,
		[ids.anna, ids.owner, userOf("owner"), SEEDED_AT],
	);
	// Approval required, so requests stay pending (sick leave is auto-approved by default).
	await admin.query(
		`insert into absence_category
		 (id, organization_id, type, name, requires_approval, counts_against_vacation, is_active, updated_at)
		 values ($1, $3, 'sick', 'Sick leave', true, false, true, $4),
		        ($2, $3, 'vacation', 'Vacation', true, true, true, $4)`,
		[ids.sick, ids.vacation, ORG, SEEDED_AT],
	);
	const { seedPersonnelFileOfficerGrant } = await import("./testing/officer-grant.test.fixture");
	// Otto covers Berlin's sick notes.
	await seedPersonnelFileOfficerGrant(admin, {
		organizationId: ORG,
		officerEmployeeId: ids.officer,
		createdBy: userOf("owner"),
		teamIds: [ids.berlin],
		categories: ["sick_note"],
	});
	await admin.query(
		`insert into absence_setting (organization_id, employee_sick_note_upload, updated_at, updated_by)
		 values ($1, true, $2, $3)
		 on conflict (organization_id) do update set employee_sick_note_upload = true`,
		[ORG, SEEDED_AT, userOf("owner")],
	);
}

function signIn(person: Person) {
	harness.userId = userOf(person);
	harness.organizationId = ORG;
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

/** A finished TUS upload of the signed-in user, as the dialog stages it. */
function stage(
	fileName: string,
	input: { title?: string; documentDate?: string; bytes?: Buffer } = {},
) {
	if (!harness.userId) throw new Error("not signed in");
	const tusFileKey = createOwnedTusFileKey(harness.userId);
	harness.tus.set(tusFileKey, input.bytes ?? pdf(`${fileName}-${Math.random()}`));
	return {
		tusFileKey,
		fileName,
		title: input.title ?? `Sick note ${fileName}`,
		documentDate: input.documentDate ?? "2026-10-05",
	};
}

function sickLeave(
	input: {
		category?: string;
		sickDetail?: "child_sick" | "with_certificate" | "without_certificate" | "other";
	} = {},
) {
	const category = input.category ?? ids.sick;
	return {
		categoryId: category,
		...nextRange(),
		startPeriod: "full_day" as const,
		endPeriod: "full_day" as const,
		durationKind: "full_day" as const,
		...(category === ids.sick ? { sickDetail: input.sickDetail ?? "without_certificate" } : {}),
	};
}

async function linkedNotes(absenceId: string) {
	const { rows } = await admin.query<{
		id: string;
		title: string;
		document_date: string;
		category: string;
		visibility: string;
	}>(
		`select id, title, to_char(document_date, 'YYYY-MM-DD') as document_date, category, visibility
		 from employee_document where absence_entry_id = $1 order by created_at, title`,
		[absenceId],
	);
	return rows;
}

async function sickDetailOf(absenceId: string): Promise<string | null> {
	const { rows } = await admin.query<{ sick_detail: string | null }>(
		"select sick_detail from absence_entry where id = $1",
		[absenceId],
	);
	return rows[0]?.sick_detail ?? null;
}

describe.each(["legacy", "canonical"] as const)(
	"sick notes with a sick-leave request (#983, %s)",
	(mode) => {
		beforeAll(() => seed(mode));
		afterAll(cleanup);
		beforeEach(async () => {
			harness.notifications.length = 0;
			harness.tus.clear();
			await admin.query("update organization set personnel_files_enabled = true where id = $1", [
				ORG,
			]);
			await admin.query(
				"update absence_setting set employee_sick_note_upload = true where organization_id = $1",
				[ORG],
			);
		});

		it("creates the absence with each staged file as a linked shared sick note", async () => {
			signIn("anna");
			const first = stage("page-1.pdf", { title: "Sick note page 1", documentDate: "2026-10-05" });
			const second = stage("page-2.pdf", { title: "Sick note page 2", documentDate: "2026-10-06" });

			const result = await requestAbsence(sickLeave(), [first, second]);

			if (!result.success) throw new Error(result.error);
			expect(result.data.sickNotes).toEqual({ attached: 2, failed: [] });
			const absenceId = result.data.absenceId;
			expect(await linkedNotes(absenceId)).toEqual([
				expect.objectContaining({
					title: "Sick note page 1",
					document_date: "2026-10-05",
					category: "sick_note",
					visibility: "shared",
				}),
				expect.objectContaining({
					title: "Sick note page 2",
					document_date: "2026-10-06",
					category: "sick_note",
					visibility: "shared",
				}),
			]);
			expect(await sickDetailOf(absenceId)).toBe("with_certificate");
			// The finished uploads are consumed.
			expect(harness.tus.size).toBe(0);
		});

		it("notifies the covering officer per note and audits the certificate switch once", async () => {
			signIn("anna");
			const result = await requestAbsence(sickLeave(), [stage("a.pdf"), stage("b.pdf")]);
			if (!result.success) throw new Error(result.error);
			const absenceId = result.data.absenceId;
			const notes = await linkedNotes(absenceId);

			const notified = harness.notifications.filter(
				(notification) => notification.type === "personnel_file_employee_upload",
			);
			expect(
				notified.map((notification) => [notification.userId, notification.entityId]).toSorted(),
			).toEqual(notes.map((note) => [userOf("officer"), note.id]).toSorted());
			expect(notified[0]?.message).toMatch(/^Anna Example uploaded a sick note for /u);

			const { rows: switches } = await admin.query<{ performed_by: string }>(
				"select performed_by from audit_log where entity_id = $1 and action = 'absence.sick_detail_changed'",
				[absenceId],
			);
			expect(switches).toEqual([{ performed_by: userOf("anna") }]);
			const { rows: uploads } = await admin.query<{ metadata: string }>(
				"select metadata from audit_log where entity_id = any($1::uuid[]) and action = 'personnel_file.document_uploaded'",
				[notes.map((note) => note.id)],
			);
			expect(uploads).toHaveLength(2);
			for (const upload of uploads) {
				expect(JSON.parse(upload.metadata)).toMatchObject({ source: "employee", absenceId });
			}
		});

		it("stores nothing when the absence request fails, and deletes the staged uploads", async () => {
			signIn("anna");
			const leave = sickLeave();
			const first = await requestAbsence(leave);
			if (!first.success) throw new Error(first.error);

			// The same days again overlap the first request.
			const overlapping = await requestAbsence(leave, [stage("a.pdf"), stage("b.pdf")]);

			expect(overlapping.success).toBe(false);
			expect(harness.tus.size).toBe(0);
			const { rows } = await admin.query(
				"select id from employee_document where organization_id = $1 and employee_id = $2 and absence_entry_id is null",
				[ORG, ids.anna],
			);
			expect(rows).toEqual([]);
			expect(await linkedNotes(first.data.absenceId)).toEqual([]);
		});

		it("keeps the absence when one note fails, and names the file", async () => {
			signIn("anna");
			const result = await requestAbsence(sickLeave(), [
				stage("photo.heic", { bytes: heic() }),
				stage("scan.pdf", { title: "Scan" }),
			]);

			if (!result.success) throw new Error(result.error);
			expect(result.data.sickNotes).toEqual({
				attached: 1,
				failed: [{ fileName: "photo.heic", error: expect.stringMatching(/HEIC/u) }],
			});
			expect((await linkedNotes(result.data.absenceId)).map((note) => note.title)).toEqual([
				"Scan",
			]);
			// The refused upload is deleted, not left behind.
			expect(harness.tus.size).toBe(0);
		});

		it("never reads another user's upload", async () => {
			signIn("owner");
			const owners = stage("owner.pdf");
			signIn("anna");
			const result = await requestAbsence(sickLeave(), [owners]);

			if (!result.success) throw new Error(result.error);
			expect(result.data.sickNotes).toEqual({
				attached: 0,
				failed: [{ fileName: "owner.pdf", error: expect.any(String) }],
			});
			expect(await linkedNotes(result.data.absenceId)).toEqual([]);
			expect(harness.tus.has(owners.tusFileKey)).toBe(true);
		});

		it("refuses a malformed or oversized set of sick notes before requesting anything", async () => {
			signIn("anna");
			const leave = sickLeave();
			const tooMany = Array.from({ length: 11 }, (_, index) => stage(`page-${index}.pdf`));

			expect(await requestAbsence(leave, tooMany)).toMatchObject({ success: false });
			const { rows } = await admin.query(
				"select id from absence_entry where employee_id = $1 and start_date = $2",
				[ids.anna, leave.startDate],
			);
			expect(rows).toEqual([]);
		});

		it("deletes the dialog's own staged uploads when it gives up before requesting", async () => {
			signIn("owner");
			const owners = stage("owner.pdf");
			signIn("anna");
			const annas = [stage("a.pdf"), stage("b.pdf")];

			await discardStagedSickNoteUploadsAction([
				...annas.map((note) => note.tusFileKey),
				owners.tusFileKey,
			]);

			expect([...harness.tus.keys()]).toEqual([owners.tusFileKey]);
		});

		describe("when sick notes may not be attached", () => {
			it("creates the absence but no notes while the setting is off, and deletes the uploads", async () => {
				await admin.query(
					"update absence_setting set employee_sick_note_upload = false where organization_id = $1",
					[ORG],
				);
				signIn("anna");
				const result = await requestAbsence(sickLeave(), [stage("a.pdf")]);

				if (!result.success) throw new Error(result.error);
				expect(result.data.sickNotes).toEqual({
					attached: 0,
					failed: [{ fileName: "a.pdf", error: expect.any(String) }],
				});
				expect(await linkedNotes(result.data.absenceId)).toEqual([]);
				expect(await sickDetailOf(result.data.absenceId)).toBe("without_certificate");
				expect(harness.tus.size).toBe(0);
				expect(harness.notifications.map((notification) => notification.type)).not.toContain(
					"personnel_file_employee_upload",
				);
			});

			it("attaches nothing to a vacation", async () => {
				signIn("anna");
				const result = await requestAbsence(sickLeave({ category: ids.vacation }), [
					stage("a.pdf"),
				]);

				if (!result.success) throw new Error(result.error);
				expect(result.data.sickNotes?.attached).toBe(0);
				expect(await linkedNotes(result.data.absenceId)).toEqual([]);
				expect(harness.tus.size).toBe(0);
			});

			it("attaches nothing while personnel files are off", async () => {
				await admin.query("update organization set personnel_files_enabled = false where id = $1", [
					ORG,
				]);
				signIn("anna");
				const result = await requestAbsence(sickLeave(), [stage("a.pdf")]);

				if (!result.success) throw new Error(result.error);
				expect(result.data.sickNotes?.attached).toBe(0);
				expect(await linkedNotes(result.data.absenceId)).toEqual([]);
				expect(harness.tus.size).toBe(0);
			});
		});
	},
);
