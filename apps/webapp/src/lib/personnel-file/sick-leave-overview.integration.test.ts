/**
 * #985: the officer "Sick leave" overview against a disposable PostgreSQL
 * database. Absences, sick notes and officer grants are seeded directly; the
 * overview is read through the personnel file access resolver, as the page
 * reads it.
 */

import { Temporal } from "temporal-polyfill";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { integrationAdminPool } from "@/test/integration-database";

const { db } = await import("@/db");
const { resolvePersonnelFileAccess } = await import("./access-store");
const { parseSickLeaveOverviewParams } = await import("./sick-leave-overview");
const { listSickLeaveFilterOptions, listSickLeaveOverview } = await import(
	"./sick-leave-overview-store"
);
const { seedPersonnelFileOfficerGrant } = await import("./testing/officer-grant.test.fixture");

const ORG = "t985-org";
const OTHER_ORG = "t985-other-org";
/** The organization's today for every test: the default range is 2026-07-10 to 2026-10-10. */
const TODAY = Temporal.PlainDate.from("2026-10-10");

const ids = {
	owner: "e9850000-0000-4000-8000-000000000001",
	officer: "e9850000-0000-4000-8000-000000000002",
	certificateOfficer: "e9850000-0000-4000-8000-000000000003",
	anna: "e9850000-0000-4000-8000-000000000004",
	ben: "e9850000-0000-4000-8000-000000000005",
	leaver: "e9850000-0000-4000-8000-000000000006",
	outsider: "e9850000-0000-4000-8000-000000000007",
	berlin: "e9851000-0000-4000-8000-000000000001",
	munich: "e9851000-0000-4000-8000-000000000002",
	sick: "e9852000-0000-4000-8000-000000000001",
	vacation: "e9852000-0000-4000-8000-000000000002",
	otherSick: "e9852000-0000-4000-8000-000000000003",
} as const;
type Person = "owner" | "officer" | "certificateOfficer" | "anna" | "ben" | "leaver" | "outsider";
const userOf = (person: Person) => `t985-${person}`;
const SEEDED_AT = new Date("2026-06-01T00:00:00Z");

/** The seeded absences by name; ids are stable so assertions can name them. */
const absences = {
	annaMissing: "e9853000-0000-4000-8000-000000000001",
	annaWithNote: "e9853000-0000-4000-8000-000000000002",
	annaVacation: "e9853000-0000-4000-8000-000000000003",
	annaRejected: "e9853000-0000-4000-8000-000000000004",
	annaAcrossRangeStart: "e9853000-0000-4000-8000-000000000005",
	annaBeforeRange: "e9853000-0000-4000-8000-000000000006",
	benMissing: "e9853000-0000-4000-8000-000000000007",
	leaverWithNotes: "e9853000-0000-4000-8000-000000000008",
	officerOwn: "e9853000-0000-4000-8000-000000000009",
	outsiderMissing: "e9853000-0000-4000-8000-00000000000a",
} as const;

const admin = integrationAdminPool();

async function cleanup() {
	await admin.query("delete from organization where id = any($1::text[])", [[ORG, OTHER_ORG]]);
	await admin.query('delete from "user" where id like $1', ["t985-%"]);
}

async function seedPerson(
	person: Person,
	input: {
		name: string;
		memberRole?: string;
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
		[
			`t985-member-${person}`,
			organizationId,
			userOf(person),
			input.memberRole ?? "member",
			SEEDED_AT,
		],
	);
	await admin.query(
		"insert into employee (id,user_id,organization_id,role,team_id,is_active,updated_at) values ($1,$2,$3,'employee',$4,$5,$6)",
		[
			ids[person],
			userOf(person),
			organizationId,
			input.teamId ?? null,
			input.isActive ?? true,
			SEEDED_AT,
		],
	);
}

async function seedAbsence(
	id: string,
	input: {
		employee: Person;
		category?: string;
		startDate: string;
		endDate: string;
		status?: "pending" | "approved" | "rejected";
		sickDetail?: "child_sick" | "with_certificate" | "without_certificate" | "other" | null;
		organizationId?: string;
	},
) {
	await admin.query(
		`insert into absence_entry
		 (id, employee_id, category_id, start_date, end_date, status, sick_detail, organization_id, updated_at)
		 values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
		[
			id,
			ids[input.employee],
			input.category ?? ids.sick,
			input.startDate,
			input.endDate,
			input.status ?? "approved",
			input.sickDetail === undefined ? "with_certificate" : input.sickDetail,
			input.organizationId ?? ORG,
			SEEDED_AT,
		],
	);
}

let noteCounter = 0;
async function seedSickNote(absenceId: string, employee: Person, title: string): Promise<string> {
	noteCounter += 1;
	const id = `e9854000-0000-4000-8000-${noteCounter.toString().padStart(12, "0")}`;
	await admin.query(
		`insert into employee_document
		 (id, organization_id, employee_id, category, title, document_date, visibility, absence_entry_id,
		  storage_provider, storage_bucket, storage_key, file_name, mime_type, size_bytes, checksum_sha256)
		 values ($1, $2, $3, 'sick_note', $4, '2026-09-01', 'hr_only', $5,
		  's3-private', 't985-private', $6, 'note.pdf', 'application/pdf', 10, 'x')`,
		[id, ORG, ids[employee], title, absenceId, `personnel-files/${ORG}/${ids[employee]}/${id}.pdf`],
	);
	return id;
}

async function seed() {
	await cleanup();
	await admin.query(
		`insert into organization (id, name, slug, timezone, personnel_files_enabled, created_at)
		 values ($1, $1, $1, 'Europe/Berlin', true, $3), ($2, $2, $2, 'Europe/Berlin', true, $3)`,
		[ORG, OTHER_ORG, SEEDED_AT],
	);
	await admin.query(
		"insert into team (id, organization_id, name, updated_at) values ($1, $3, 'Berlin', $4), ($2, $3, 'Munich', $4)",
		[ids.berlin, ids.munich, ORG, SEEDED_AT],
	);
	await seedPerson("owner", { name: "Olga Owner", memberRole: "owner" });
	await seedPerson("officer", { name: "Otto Officer", teamId: ids.berlin });
	await seedPerson("certificateOfficer", { name: "Cleo Certificates", teamId: ids.berlin });
	await seedPerson("anna", { name: "Anna Example", teamId: ids.berlin });
	await seedPerson("ben", { name: "Ben Example", teamId: ids.munich });
	await seedPerson("leaver", { name: "Lea Leaver", teamId: ids.berlin, isActive: false });
	await seedPerson("outsider", { name: "Oscar Outsider", organizationId: OTHER_ORG });
	await admin.query(
		`insert into absence_category
		 (id, organization_id, type, name, requires_approval, counts_against_vacation, is_active, updated_at)
		 values ($1, $3, 'sick', 'Sick leave', false, false, true, $4),
		        ($2, $3, 'vacation', 'Vacation', true, true, true, $4)`,
		[ids.sick, ids.vacation, ORG, SEEDED_AT],
	);
	await admin.query(
		`insert into absence_category
		 (id, organization_id, type, name, requires_approval, counts_against_vacation, is_active, updated_at)
		 values ($1, $2, 'sick', 'Sick leave', false, false, true, $3)`,
		[ids.otherSick, OTHER_ORG, SEEDED_AT],
	);

	await seedAbsence(absences.annaMissing, {
		employee: "anna",
		startDate: "2026-09-01",
		endDate: "2026-09-02",
	});
	await seedAbsence(absences.annaWithNote, {
		employee: "anna",
		startDate: "2026-09-10",
		endDate: "2026-09-10",
		status: "pending",
	});
	await seedSickNote(absences.annaWithNote, "anna", "Certificate September");
	await seedAbsence(absences.annaVacation, {
		employee: "anna",
		category: ids.vacation,
		startDate: "2026-09-15",
		endDate: "2026-09-16",
		sickDetail: null,
	});
	await seedAbsence(absences.annaRejected, {
		employee: "anna",
		startDate: "2026-08-03",
		endDate: "2026-08-03",
		status: "rejected",
		sickDetail: "without_certificate",
	});
	await seedAbsence(absences.annaAcrossRangeStart, {
		employee: "anna",
		startDate: "2026-07-06",
		endDate: "2026-07-10",
		sickDetail: "child_sick",
	});
	await seedAbsence(absences.annaBeforeRange, {
		employee: "anna",
		startDate: "2026-05-04",
		endDate: "2026-05-04",
		sickDetail: "other",
	});
	await seedAbsence(absences.benMissing, {
		employee: "ben",
		startDate: "2026-09-07",
		endDate: "2026-09-07",
	});
	await seedAbsence(absences.leaverWithNotes, {
		employee: "leaver",
		startDate: "2026-08-17",
		endDate: "2026-08-19",
		sickDetail: "without_certificate",
	});
	await seedSickNote(absences.leaverWithNotes, "leaver", "Note part 1");
	await seedSickNote(absences.leaverWithNotes, "leaver", "Note part 2");
	await seedAbsence(absences.officerOwn, {
		employee: "officer",
		startDate: "2026-09-03",
		endDate: "2026-09-03",
	});
	await seedAbsence(absences.outsiderMissing, {
		employee: "outsider",
		category: ids.otherSick,
		startDate: "2026-09-04",
		endDate: "2026-09-04",
		organizationId: OTHER_ORG,
	});

	// Otto covers Berlin's sick notes; Cleo covers Berlin's certificates only.
	await seedPersonnelFileOfficerGrant(admin, {
		organizationId: ORG,
		officerEmployeeId: ids.officer,
		createdBy: userOf("owner"),
		teamIds: [ids.berlin],
		categories: ["sick_note"],
	});
	await seedPersonnelFileOfficerGrant(admin, {
		organizationId: ORG,
		officerEmployeeId: ids.certificateOfficer,
		createdBy: userOf("owner"),
		teamIds: [ids.berlin],
		categories: ["certificate"],
	});
}

async function accessOf(person: Person) {
	const access = await resolvePersonnelFileAccess(db, {
		userId: userOf(person),
		organizationId: ORG,
	});
	if (!access) throw new Error(`${person} has no personnel file access`);
	return access;
}

async function overview(person: Person, params: Record<string, string> = {}) {
	const result = await listSickLeaveOverview(
		db,
		await accessOf(person),
		parseSickLeaveOverviewParams(params, TODAY),
	);
	if (result.kind !== "ok") throw new Error(`The overview was ${result.kind} for ${person}`);
	return result;
}

const absenceIdsOf = (result: { rows: ReadonlyArray<{ absenceId: string }> }) =>
	result.rows.map((row) => row.absenceId);

beforeAll(seed);
afterAll(cleanup);

describe("sick leave overview", () => {
	it("shows an officer only the sick leave of the employees their sick note grant covers, never their own", async () => {
		const result = await overview("officer");

		expect(absenceIdsOf(result)).toEqual([
			absences.annaWithNote,
			absences.annaMissing,
			absences.leaverWithNotes,
			absences.annaAcrossRangeStart,
		]);
		expect(result.total).toBe(4);
	});

	it("shows owners and admins every employee's sick leave of their organization only", async () => {
		const result = await overview("owner");

		expect(absenceIdsOf(result)).toEqual([
			absences.annaWithNote,
			absences.benMissing,
			absences.officerOwn,
			absences.annaMissing,
			absences.leaverWithNotes,
			absences.annaAcrossRangeStart,
		]);
		expect(absenceIdsOf(result)).not.toContain(absences.outsiderMissing);
	});

	it("refuses the query for an officer whose grant does not cover sick notes", async () => {
		const result = await listSickLeaveOverview(
			db,
			await accessOf("certificateOfficer"),
			parseSickLeaveOverviewParams({}, TODAY),
		);

		expect(result).toEqual({ kind: "refused" });
	});

	it('"with certificate, no note" lists exactly the with-certificate absences without a linked note', async () => {
		const result = await overview("owner", { notes: "missing" });

		expect(absenceIdsOf(result)).toEqual([
			absences.benMissing,
			absences.officerOwn,
			absences.annaMissing,
		]);
	});

	it('"has note" lists the absences with at least one linked sick note', async () => {
		const result = await overview("owner", { notes: "present" });

		expect(absenceIdsOf(result)).toEqual([absences.annaWithNote, absences.leaverWithNotes]);
	});

	it("shows each absence's linked sick note count and marks former employees", async () => {
		const result = await overview("officer");

		expect(
			result.rows.map((row) => ({
				absenceId: row.absenceId,
				employeeName: row.employeeName,
				isFormer: row.isFormer,
				sickNoteCount: row.sickNoteCount,
				sickDetail: row.sickDetail,
				status: row.status,
			})),
		).toEqual([
			{
				absenceId: absences.annaWithNote,
				employeeName: "Anna Example",
				isFormer: false,
				sickNoteCount: 1,
				sickDetail: "with_certificate",
				status: "pending",
			},
			{
				absenceId: absences.annaMissing,
				employeeName: "Anna Example",
				isFormer: false,
				sickNoteCount: 0,
				sickDetail: "with_certificate",
				status: "approved",
			},
			{
				absenceId: absences.leaverWithNotes,
				employeeName: "Lea Leaver",
				isFormer: true,
				sickNoteCount: 2,
				sickDetail: "without_certificate",
				status: "approved",
			},
			{
				absenceId: absences.annaAcrossRangeStart,
				employeeName: "Anna Example",
				isFormer: false,
				sickNoteCount: 0,
				sickDetail: "child_sick",
				status: "approved",
			},
		]);
	});

	it("filters by employee, team, sick detail, status and date range", async () => {
		expect(absenceIdsOf(await overview("officer", { employeeId: ids.anna }))).toEqual([
			absences.annaWithNote,
			absences.annaMissing,
			absences.annaAcrossRangeStart,
		]);
		expect(absenceIdsOf(await overview("owner", { teamId: ids.munich }))).toEqual([
			absences.benMissing,
		]);
		expect(absenceIdsOf(await overview("owner", { sickDetail: "child_sick" }))).toEqual([
			absences.annaAcrossRangeStart,
		]);
		expect(absenceIdsOf(await overview("officer", { status: "pending" }))).toEqual([
			absences.annaWithNote,
		]);
		expect(absenceIdsOf(await overview("owner", { from: "2026-05-01", to: "2026-05-31" }))).toEqual(
			[absences.annaBeforeRange],
		);
	});

	it("never widens the officer's scope through a filter", async () => {
		expect(absenceIdsOf(await overview("officer", { employeeId: ids.ben }))).toEqual([]);
		expect(absenceIdsOf(await overview("officer", { employeeId: ids.officer }))).toEqual([]);
		expect(absenceIdsOf(await overview("officer", { teamId: ids.munich }))).toEqual([]);
	});

	it("is paginated, with the total over every page and a page past the end showing the last one", async () => {
		const access = await accessOf("owner");
		const filters = { ...parseSickLeaveOverviewParams({}, TODAY), pageSize: 4 };

		const second = await listSickLeaveOverview(db, access, { ...filters, page: 2 });
		const beyond = await listSickLeaveOverview(db, access, { ...filters, page: 9 });

		expect(second).toMatchObject({ kind: "ok", total: 6, page: 2, pageSize: 4, pageCount: 2 });
		expect(second.kind === "ok" ? absenceIdsOf(second) : null).toEqual([
			absences.leaverWithNotes,
			absences.annaAcrossRangeStart,
		]);
		expect(beyond).toEqual(second);
	});

	it("names the linked sick notes of each listed absence, to open them", async () => {
		const result = await overview("officer", { notes: "present" });

		expect(result.rows.map((row) => row.sickNotes.map((note) => note.title))).toEqual([
			["Certificate September"],
			["Note part 1", "Note part 2"],
		]);
	});

	it("shows each absence's duration in absence days", async () => {
		const result = await overview("officer");

		// Mon 2026-08-17 to Wed 2026-08-19 and Mon 2026-07-06 to Fri 2026-07-10, Monday to Friday.
		expect(result.rows.map((row) => [row.absenceId, row.absenceDays])).toEqual([
			[absences.annaWithNote, 1],
			[absences.annaMissing, 2],
			[absences.leaverWithNotes, 3],
			[absences.annaAcrossRangeStart, 5],
		]);
	});

	it("offers the employees and teams in the viewer's sick note scope as filters", async () => {
		const officer = await listSickLeaveFilterOptions(db, await accessOf("officer"));
		const owner = await listSickLeaveFilterOptions(db, await accessOf("owner"));
		const certificates = await listSickLeaveFilterOptions(db, await accessOf("certificateOfficer"));

		expect(officer.employees.map((option) => option.name)).toEqual([
			"Anna Example",
			"Cleo Certificates",
			"Lea Leaver",
		]);
		expect(officer.teams).toEqual([{ id: ids.berlin, name: "Berlin" }]);
		expect(owner.teams).toEqual([
			{ id: ids.berlin, name: "Berlin" },
			{ id: ids.munich, name: "Munich" },
		]);
		expect(certificates).toEqual({ employees: [], teams: [] });
	});

	it("lists only the sick leave of the access's organization", async () => {
		// An organization-wide grant read against the other organization sees only its rows.
		const outsiderOwnerView = await listSickLeaveOverview(
			db,
			{ ...(await accessOf("owner")), organizationId: OTHER_ORG },
			parseSickLeaveOverviewParams({}, TODAY),
		);

		expect(outsiderOwnerView.kind === "ok" ? absenceIdsOf(outsiderOwnerView) : null).toEqual([
			absences.outsiderMissing,
		]);
	});
});
