/**
 * #1165: the personal data export pipeline against a disposable PostgreSQL
 * database: My data's server actions, the worker build with the Employment
 * category, download, expiry and stored-file cleanup. The session, object
 * storage and the job queue are replaced; data is seeded directly.
 */

import JSZip from "jszip";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { integrationAdminPool } from "@/test/integration-database";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const harness = vi.hoisted(() => ({
	userId: null as string | null,
	organizationId: "t1165-org",
	objects: new Map<string, Uint8Array>(),
	jobs: [] as { organizationId: string; exportId: string }[],
	signed: [] as { key: string; expiresInSeconds: number; fileName: string }[],
}));

vi.mock("next/headers", async () => (await import("@/test/integration-harness")).nextHeaders());
vi.mock("next/server", async (original) =>
	(await import("@/test/integration-harness")).nextServer(original),
);
vi.mock("@/lib/email/email-service", async (original) =>
	(await import("@/test/integration-harness")).emailService(original),
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
vi.mock("@/lib/queue", async (original) => ({
	...(await original<typeof import("@/lib/queue")>()),
	addJob: async (_name: string, data: { organizationId: string; exportId: string }) => {
		harness.jobs.push({ organizationId: data.organizationId, exportId: data.exportId });
		return { id: "job" };
	},
}));
vi.mock("@/lib/storage/export-s3-client", () => ({
	isExportS3Configured: async () => true,
	async uploadPrivateObjectStream(
		_organizationId: string,
		key: string,
		body: ReadableStream<Uint8Array>,
	) {
		harness.objects.set(key, new Uint8Array(await new Response(body).arrayBuffer()));
		return { bucket: "t1165-private", versionId: `v-${key}` };
	},
	async deletePrivateObject(input: { key: string }) {
		harness.objects.delete(input.key);
	},
	async deletePrivateObjectVersions(input: { key: string }) {
		harness.objects.delete(input.key);
	},
	async getPrivateObjectPresignedUrl(input: {
		key: string;
		expiresInSeconds: number;
		fileName: string;
	}) {
		harness.signed.push(input);
		return `https://storage.test/${input.key}?expires=${input.expiresInSeconds}`;
	},
}));

const { db } = await import("@/db");
const { getMyDataOverview, requestMyPersonalDataExport, getPersonalDataExportDownloadUrl } =
	await import("@/app/[locale]/(app)/settings/my-data/actions");
const { processPersonalDataExport } = await import("./processor");
const { PERSONAL_DATA_COLLECTORS } = await import("./collectors");
const { runPersonalDataExportSweep } = await import("@/lib/jobs/personal-data-export-sweep");
const { drainPersonalDataExportFileCleanup } = await import("./store");
const { systemClock } = await import("@/lib/datetime/temporal-core");
const { sendEmail } = await import("@/lib/email/email-service");

const ORG = "t1165-org";
const OTHER_ORG = "t1165-other";

const ids = {
	ada: "11650000-0000-4000-8000-000000000001",
	bob: "11650000-0000-4000-8000-000000000002",
	adaOther: "11650000-0000-4000-8000-000000000003",
	owner: "11650000-0000-4000-8000-000000000004",
	former: "11650000-0000-4000-8000-000000000005",
	teamAda: "11650000-0000-4000-8000-0000000000a1",
	teamOther: "11650000-0000-4000-8000-0000000000a2",
	policyDefault: "11650000-0000-4000-8000-0000000000b1",
	policyTeam: "11650000-0000-4000-8000-0000000000b2",
	policyOtherTeam: "11650000-0000-4000-8000-0000000000b3",
	projectTeam: "11650000-0000-4000-8000-0000000000c1",
	projectOtherTeam: "11650000-0000-4000-8000-0000000000c2",
	fieldShirt: "11650000-0000-4000-8000-0000000000d1",
	fieldBand: "11650000-0000-4000-8000-0000000000d2",
	skill: "11650000-0000-4000-8000-0000000000e1",
	skillOther: "11650000-0000-4000-8000-0000000000e2",
} as const;

const admin = integrationAdminPool();

async function cleanup() {
	for (const org of [ORG, OTHER_ORG]) {
		await admin.query("delete from organization where id = $1", [org]);
		await admin.query("delete from personal_data_export_file_cleanup where organization_id = $1", [
			org,
		]);
	}
	await admin.query('delete from "user" where id like $1', ["t1165-%"]);
}

async function seedUser(name: string, displayName: string) {
	await admin.query(
		'insert into "user" (id,name,email,created_at,updated_at) values ($1,$2,$3,now(),now())',
		[`t1165-${name}`, displayName, `t1165-${name}@example.test`],
	);
}

async function seedMember(organizationId: string, name: string, role = "member") {
	await admin.query(
		"insert into member (id,organization_id,user_id,role,status,created_at) values ($1,$2,$3,$4,'approved',now())",
		[`t1165-member-${name}-${organizationId}`, organizationId, `t1165-${name}`, role],
	);
}

async function seedEmployee(
	organizationId: string,
	id: string,
	name: string,
	fields: { position?: string; isActive?: boolean } = {},
) {
	await admin.query(
		`insert into employee (id,user_id,organization_id,role,is_active,position,updated_at)
		 values ($1,$2,$3,'employee',$4,$5,now())`,
		[id, `t1165-${name}`, organizationId, fields.isActive ?? true, fields.position ?? null],
	);
}

function signIn(name: string, organizationId = ORG) {
	harness.userId = `t1165-${name}`;
	harness.organizationId = organizationId;
}

async function exportRows(employeeId: string) {
	const { rows } = await admin.query<{
		id: string;
		kind: string;
		status: string;
		requested_by_user_id: string;
		storage_key: string | null;
		error_code: string | null;
	}>(
		"select id, kind, status, requested_by_user_id, storage_key, error_code from personal_data_export where employee_id = $1 order by created_at",
		[employeeId],
	);
	return rows;
}

async function auditRows(action: string, exportId: string) {
	const { rows } = await admin.query<{
		performed_by: string;
		employee_id: string;
		entity_type: string;
		metadata: string;
	}>(
		"select performed_by, employee_id, entity_type, metadata from audit_log where organization_id = $1 and action = $2 and entity_id = $3",
		[ORG, action, exportId],
	);
	return rows.map((row) => ({ ...row, metadata: JSON.parse(row.metadata) }));
}

async function zipFiles(exportId: string): Promise<Record<string, string>> {
	const [row] = (
		await admin.query<{ storage_key: string }>(
			"select storage_key from personal_data_export where id = $1",
			[exportId],
		)
	).rows;
	const bytes = harness.objects.get(row?.storage_key ?? "");
	expect(bytes, "stored ZIP").toBeDefined();
	const zip = await JSZip.loadAsync(bytes as Uint8Array);
	const files: Record<string, string> = {};
	for (const entry of Object.values(zip.files)) {
		if (!entry.dir) files[entry.name] = await entry.async("string");
	}
	return files;
}

/** Requests Ada's employee export and runs the worker job it queued. */
async function exportAdaData(): Promise<string> {
	signIn("ada");
	const requested = await requestMyPersonalDataExport();
	if (!requested.success) throw new Error(`request refused: ${requested.error}`);
	expect(harness.jobs.at(-1)).toEqual({ organizationId: ORG, exportId: requested.data.exportId });
	const outcome = await processPersonalDataExport(db, {
		organizationId: ORG,
		exportId: requested.data.exportId,
	});
	expect(outcome).toEqual({ status: "completed" });
	return requested.data.exportId;
}

async function forgetExports() {
	await admin.query("delete from personal_data_export where organization_id in ($1, $2)", [
		ORG,
		OTHER_ORG,
	]);
	await admin.query(
		"delete from personal_data_export_file_cleanup where organization_id in ($1, $2)",
		[ORG, OTHER_ORG],
	);
	harness.objects.clear();
	harness.jobs.length = 0;
}

describe("personal data export pipeline (#1165)", () => {
	beforeAll(async () => {
		await cleanup();
		for (const organizationId of [ORG, OTHER_ORG]) {
			await admin.query(
				`insert into organization (id, name, slug, timezone, created_at) values ($1, $2, $1, 'Europe/Berlin', now())`,
				[organizationId, organizationId === ORG ? "Acme GmbH" : "Other AG"],
			);
		}
		await seedUser("ada", "Ada Lovelace");
		await seedUser("bob", "Bob Builder");
		await seedUser("mia", "Mia Member");
		await seedUser("owner", "Olga Owner");
		await seedUser("former", "Fred Former");
		await seedMember(ORG, "ada");
		await seedMember(OTHER_ORG, "ada");
		await seedMember(ORG, "bob");
		await seedMember(ORG, "mia");
		await seedMember(ORG, "owner", "owner");
		await seedMember(ORG, "former");
		await seedEmployee(ORG, ids.ada, "ada", { position: "Engineer" });
		await seedEmployee(OTHER_ORG, ids.adaOther, "ada", { position: "Secret other-org role" });
		await seedEmployee(ORG, ids.bob, "bob");
		await seedEmployee(ORG, ids.owner, "owner");
		await seedEmployee(ORG, ids.former, "former", { isActive: false });

		await admin.query(
			`update employee set first_name = 'Ada', last_name = 'Lovelace', pronouns = 'she/her',
			   birthday = '1990-02-28 00:00:00', employee_number = 'P-0042', current_hourly_rate = '23.00',
			   gender = 'female' where id = $1`,
			[ids.ada],
		);
		// Teams: Ada's own and another one she never belonged to.
		await admin.query(
			`insert into team (id, organization_id, name, updated_at) values
			   ($1, $3, 'Platform', now()), ($2, $3, 'Secret Team', now())`,
			[ids.teamAda, ids.teamOther, ORG],
		);
		await admin.query("update employee set team_id = $1 where id = $2", [ids.teamAda, ids.ada]);
		await admin.query(
			"insert into team_membership (organization_id, team_id, employee_id, created_by) values ($1, $2, $3, 't1165-owner')",
			[ORG, ids.teamAda, ids.ada],
		);
		// Employment terms with the hourly wage, and the legacy rate history.
		await admin.query(
			`insert into employee_employment_history (employee_id, organization_id, valid_from, weekly_contract_minutes,
			   hourly_rate, currency, change_reason, review_state, created_by, updated_at)
			 values ($1, $2, '2026-01-01 00:00:00', 2400, '21.50', 'EUR', 'Hired', 'confirmed', 't1165-owner', now())`,
			[ids.ada, ORG],
		);
		await admin.query(
			`insert into employee_rate_history (employee_id, organization_id, hourly_rate, effective_from, created_by)
			 values ($1, $2, '23.00', '2026-07-01 00:00:00', 't1165-owner')`,
			[ids.ada, ORG],
		);
		// Skills in both organizations.
		await admin.query(
			`insert into skill (id, organization_id, name, category, created_by, updated_at) values
			   ($1, $3, 'Forklift licence', 'equipment', 't1165-owner', now()),
			   ($2, $4, 'Other-org skill', 'equipment', 't1165-owner', now())`,
			[ids.skill, ids.skillOther, ORG, OTHER_ORG],
		);
		await admin.query(
			`insert into employee_skill (employee_id, skill_id, expires_at, assigned_by) values
			   ($1, $2, '2027-03-31 00:00:00', 't1165-owner'), ($3, $4, null, 't1165-owner')`,
			[ids.ada, ids.skill, ids.adaOther, ids.skillOther],
		);
		await admin.query(
			"insert into employee_managers (employee_id, manager_id, is_primary, assigned_by) values ($1, $2, true, 't1165-owner')",
			[ids.ada, ids.owner],
		);
		// Policies: the organization default, Ada's team, and another team's.
		await admin.query(
			`insert into work_policy (id, organization_id, name, created_by, updated_at) values
			   ($1, $4, 'Standard week', 't1165-owner', now()),
			   ($2, $4, 'Platform on-call', 't1165-owner', now()),
			   ($3, $4, 'Secret team policy', 't1165-owner', now())`,
			[ids.policyDefault, ids.policyTeam, ids.policyOtherTeam, ORG],
		);
		await admin.query(
			`insert into work_policy_assignment (policy_id, organization_id, assignment_type, team_id, priority, created_by, updated_at) values
			   ($1, $4, 'organization', null, 0, 't1165-owner', now()),
			   ($2, $4, 'team', $5, 1, 't1165-owner', now()),
			   ($3, $4, 'team', $6, 1, 't1165-owner', now())`,
			[ids.policyDefault, ids.policyTeam, ids.policyOtherTeam, ORG, ids.teamAda, ids.teamOther],
		);
		await admin.query(
			`insert into project (id, organization_id, name, created_by, updated_at) values
			   ($1, $3, 'Platform rebuild', 't1165-owner', now()),
			   ($2, $3, 'Secret project', 't1165-owner', now())`,
			[ids.projectTeam, ids.projectOtherTeam, ORG],
		);
		await admin.query(
			`insert into project_assignment (project_id, organization_id, assignment_type, team_id, created_by) values
			   ($1, $3, 'team', $4, 't1165-owner'), ($2, $3, 'team', $5, 't1165-owner')`,
			[ids.projectTeam, ids.projectOtherTeam, ORG, ids.teamAda, ids.teamOther],
		);
		// Custom fields: one the employee may see, one above employee visibility.
		await admin.query(
			`insert into custom_field_definition (id, organization_id, entity, name, type, visibility, edit_level, position) values
			   ($1, $3, 'employee', 'Shirt size', 'text', 'employee', 'admin', 1),
			   ($2, $3, 'employee', 'Salary band', 'text', 'admin', 'admin', 2)`,
			[ids.fieldShirt, ids.fieldBand, ORG],
		);
		await admin.query(
			`insert into custom_field_value (organization_id, definition_id, employee_id, text_value) values
			   ($1, $2, $4, 'M'), ($1, $3, $4, 'Band 7')`,
			[ORG, ids.fieldShirt, ids.fieldBand, ids.ada],
		);
	});

	beforeEach(async () => {
		await forgetExports();
		harness.signed.length = 0;
		vi.mocked(sendEmail).mockClear();
	});

	afterAll(async () => {
		await cleanup();
	});

	it("builds the employee export with the Employment category, its CSVs, manifest and README", async () => {
		const exportId = await exportAdaData();
		const files = await zipFiles(exportId);

		expect(Object.keys(files)).toEqual(
			expect.arrayContaining([
				"README.txt",
				"_manifest.json",
				"employment.json",
				"employment/employment_terms.csv",
				"employment/wage_history.csv",
				"employment/skills.csv",
				"employment/policy_assignments.csv",
			]),
		);
		const employment = JSON.parse(files["employment.json"] as string);
		expect(employment._metadata).toMatchObject({ kind: "employee", employeeId: ids.ada });
		expect(employment.employee).toMatchObject({
			first_name: "Ada",
			last_name: "Lovelace",
			user_name: "Ada Lovelace",
			pronouns: "she/her",
			birthday: "1990-02-28",
			gender: "female",
			personnel_number: "P-0042",
			current_hourly_rate: "23.00",
			position: "Engineer",
			primary_team: "Platform",
			organization: "Acme GmbH",
		});
		// The hourly wage and its history are the employee's own pay.
		expect(employment.employment_terms).toEqual([
			expect.objectContaining({
				valid_from: "2026-01-01T00:00:00Z",
				hourly_rate: "21.50",
				change_reason: "Hired",
				created_by: "Olga Owner",
			}),
		]);
		expect(employment.wage_history).toEqual([
			expect.objectContaining({ hourly_rate: "23.00", effective_from: "2026-07-01T00:00:00Z" }),
		]);
		expect(employment.skills).toEqual([
			expect.objectContaining({ skill: "Forklift licence", expires_on: "2027-03-31" }),
		]);
		expect(employment.managers).toEqual([
			expect.objectContaining({ manager: "Olga Owner", primary: true }),
		]);
		expect(employment.teams).toEqual([
			expect.objectContaining({ team: "Platform", primary: true, added_by: "Olga Owner" }),
		]);
		expect(employment.project_assignments.map((row: { project: string }) => row.project)).toEqual([
			"Platform rebuild",
		]);
		expect(
			employment.policy_assignments.map((row: { policy: string }) => row.policy).sort(),
		).toEqual(["Platform on-call", "Standard week"]);
		// Withheld from the employee export: custom fields above employee visibility.
		expect(employment.custom_fields).toEqual([
			expect.objectContaining({ field: "Shirt size", value: "M" }),
		]);

		const everything = Object.values(files).join("\n");
		for (const leaked of [
			"Salary band",
			"Band 7",
			"Secret Team",
			"Secret project",
			"Secret team policy",
			"Other-org skill",
			"Secret other-org role",
		]) {
			expect(everything, leaked).not.toContain(leaked);
		}

		expect(files["employment/wage_history.csv"]?.split("\n")[0]).toBe(
			"hourly_rate,currency,effective_from,effective_to,reason,created_at,created_by",
		);
		const manifest = JSON.parse(files["_manifest.json"] as string);
		expect(manifest).toMatchObject({
			exportId,
			kind: "employee",
			// Every registered category, in archive order (more arrive per slice).
			categories: PERSONAL_DATA_COLLECTORS.map((collector) => collector.category),
		});
		expect(manifest.categories).toEqual(
			expect.arrayContaining([
				"employment",
				"time",
				"absences",
				"planning",
				"approvals",
				"travel_expenses",
				"personnel_file",
				"account",
			]),
		);
		// Archive order: Employment first, Account last; other categories sit between.
		expect(manifest.categories[0]).toBe("employment");
		expect(manifest.categories.at(-1)).toBe("account");
		expect(files["README.txt"]).toContain("Your personal data from Acme GmbH");
		expect(files["README.txt"]).toContain("employment.json");
	});

	it("writes the README in the employee's UI language", async () => {
		await admin.query(
			"insert into user_settings (user_id, locale, updated_at) values ('t1165-ada', 'de', now()) on conflict (user_id) do update set locale = 'de'",
		);
		try {
			const files = await zipFiles(await exportAdaData());
			expect(JSON.parse(files["_manifest.json"] as string).locale).toBe("de");
		} finally {
			await admin.query("delete from user_settings where user_id = 't1165-ada'");
		}
	});

	it("tells the requester without a file link, and lets only them download", async () => {
		const exportId = await exportAdaData();

		const { rows: notifications } = await admin.query<{
			user_id: string;
			action_url: string;
			message: string;
			title: string;
		}>(
			"select user_id, action_url, message, title from notification where organization_id = $1 and type = 'personal_data_export_ready' and entity_id = $2",
			[ORG, exportId],
		);
		expect(notifications).toEqual([
			expect.objectContaining({ user_id: "t1165-ada", action_url: "/settings/my-data" }),
		]);
		expect(`${notifications[0]?.title} ${notifications[0]?.message}`).not.toMatch(
			/https?:|personal-data-exports\//,
		);

		await vi.waitFor(() => expect(vi.mocked(sendEmail)).toHaveBeenCalled(), { timeout: 10_000 });
		for (const [email] of vi.mocked(sendEmail).mock.calls as unknown as [{ html: string }][]) {
			expect(email.html).not.toContain("storage.test");
			expect(email.html).not.toContain("personal-data-exports/");
		}

		// Another employee of the organization never reaches Ada's file.
		signIn("bob");
		const foreign = await getPersonalDataExportDownloadUrl(exportId);
		expect(foreign).toMatchObject({ success: false, code: "NotFoundError" });
		expect(harness.signed).toEqual([]);
		const bobOverview = await getMyDataOverview();
		expect(bobOverview).toEqual({ success: true, data: { status: "available", exports: [] } });

		signIn("ada");
		const overview = await getMyDataOverview();
		expect(overview).toMatchObject({
			success: true,
			data: {
				status: "available",
				exports: [{ id: exportId, status: "completed", kind: "employee" }],
			},
		});
		const download = await getPersonalDataExportDownloadUrl(exportId);
		expect(download).toEqual({
			success: true,
			data: { url: expect.stringContaining("https://storage.test/personal-data-exports/") },
		});
		expect(harness.signed).toEqual([
			expect.objectContaining({ expiresInSeconds: 60, fileName: expect.stringMatching(/\.zip$/) }),
		]);

		expect(await auditRows("personal_data_export.requested", exportId)).toEqual([
			{
				performed_by: "t1165-ada",
				employee_id: ids.ada,
				entity_type: "personal_data_export",
				metadata: { kind: "employee", employeeId: ids.ada, requestedByUserId: "t1165-ada" },
			},
		]);
		expect(await auditRows("personal_data_export.downloaded", exportId)).toEqual([
			expect.objectContaining({
				performed_by: "t1165-ada",
				employee_id: ids.ada,
				metadata: { kind: "employee", employeeId: ids.ada, requestedByUserId: "t1165-ada" },
			}),
		]);
	});

	it("allows one export in progress and one employee export per 24 hours", async () => {
		signIn("ada");
		const first = await requestMyPersonalDataExport();
		expect(first.success).toBe(true);

		const whileBuilding = await requestMyPersonalDataExport();
		expect(whileBuilding).toMatchObject({ success: false, refusal: "in_progress" });

		const firstId = first.success ? first.data.exportId : "";
		await processPersonalDataExport(db, { organizationId: ORG, exportId: firstId });
		const sameDay = await requestMyPersonalDataExport();
		expect(sameDay).toMatchObject({ success: false, refusal: "daily_limit" });

		// An admin export in progress for Ada blocks her request too, whoever started it.
		await admin.query("update personal_data_export set created_at = now() - interval '25 hours'");
		await admin.query(
			`insert into personal_data_export (organization_id, employee_id, kind, requested_by_user_id, status, expires_at)
			 values ($1, $2, 'admin', 't1165-owner', 'processing', now() + interval '7 days')`,
			[ORG, ids.ada],
		);
		expect(await requestMyPersonalDataExport()).toMatchObject({
			success: false,
			refusal: "in_progress",
		});
		await admin.query("delete from personal_data_export where kind = 'admin'");

		// A day later Ada may export again; a running org-wide export doesn't block her.
		await admin.query(
			"insert into data_export (organization_id, requested_by_id, categories, status) values ($1, $2, '{employees}', 'processing')",
			[ORG, ids.owner],
		);
		try {
			const nextDay = await requestMyPersonalDataExport();
			expect(nextDay.success).toBe(true);
		} finally {
			await admin.query("delete from data_export where organization_id = $1", [ORG]);
		}
		expect((await exportRows(ids.ada)).map((row) => row.status)).toEqual(["completed", "pending"]);
	});

	it("keeps each organization's export to that organization", async () => {
		signIn("ada", OTHER_ORG);
		const requested = await requestMyPersonalDataExport();
		if (!requested.success) throw new Error(requested.error);
		await processPersonalDataExport(db, {
			organizationId: OTHER_ORG,
			exportId: requested.data.exportId,
		});
		const otherFiles = await zipFiles(requested.data.exportId);
		const otherEmployment = JSON.parse(otherFiles["employment.json"] as string);
		expect(otherEmployment.employee).toMatchObject({
			id: ids.adaOther,
			position: "Secret other-org role",
			organization: "Other AG",
		});
		expect(otherEmployment.skills.map((row: { skill: string }) => row.skill)).toEqual([
			"Other-org skill",
		]);
		const everything = Object.values(otherFiles).join("\n");
		for (const leaked of ["Forklift licence", "P-0042", "Platform", "Shirt size", "Acme GmbH"]) {
			expect(everything, leaked).not.toContain(leaked);
		}

		// Ada's export in one organization is not listed or downloadable in the other.
		signIn("ada", ORG);
		expect(await getMyDataOverview()).toEqual({
			success: true,
			data: { status: "available", exports: [] },
		});
		expect(await getPersonalDataExportDownloadUrl(requested.data.exportId)).toMatchObject({
			success: false,
			code: "NotFoundError",
		});
	});

	it("shows members without an employee record the contact-admins state and refuses former employees", async () => {
		signIn("mia");
		expect(await getMyDataOverview()).toEqual({
			success: true,
			data: { status: "no_employee_record" },
		});
		expect(await requestMyPersonalDataExport()).toMatchObject({
			success: false,
			code: "AuthorizationError",
		});

		signIn("former");
		expect(await getMyDataOverview()).toEqual({ success: true, data: { status: "unavailable" } });
		expect(await requestMyPersonalDataExport()).toMatchObject({
			success: false,
			code: "AuthorizationError",
		});
		expect(await exportRows(ids.former)).toEqual([]);
	});

	it("deletes rows and stored files 7 days after completion, and with their employee", async () => {
		const expiring = await exportAdaData();
		const expiringKey = (await exportRows(ids.ada))[0]?.storage_key as string;
		expect(harness.objects.has(expiringKey)).toBe(true);

		await admin.query(
			"update personal_data_export set expires_at = now() - interval '1 minute' where id = $1",
			[expiring],
		);
		const swept = await runPersonalDataExportSweep();
		expect(swept).toMatchObject({ expired: 1, filesDeleted: 1, outstanding: 0 });
		expect(await exportRows(ids.ada)).toEqual([]);
		expect(harness.objects.has(expiringKey)).toBe(false);

		// Bob's employee record goes (user deletion): the file follows his export row.
		signIn("bob");
		const requested = await requestMyPersonalDataExport();
		if (!requested.success) throw new Error(requested.error);
		await processPersonalDataExport(db, { organizationId: ORG, exportId: requested.data.exportId });
		const bobKey = (await exportRows(ids.bob))[0]?.storage_key as string;
		expect(harness.objects.has(bobKey)).toBe(true);
		// Audit rows keep their employee reference (no cascade); remove them to delete Bob.
		await admin.query("delete from audit_log where employee_id = $1", [ids.bob]);
		await admin.query("delete from employee where id = $1", [ids.bob]);
		await runPersonalDataExportSweep();
		expect(harness.objects.has(bobKey)).toBe(false);
		await seedEmployee(ORG, ids.bob, "bob");
	});

	it("gives up a deleted organization's file it cannot delete, but retries a live one's", async () => {
		const gone = "t1165-gone-org";
		await admin.query(
			`insert into personal_data_export_file_cleanup (id, organization_id, storage_key, storage_bucket)
			 values (gen_random_uuid(), $1, 'gone/file.zip', 'gone-bucket'), (gen_random_uuid(), $2, 'live/file.zip', 'live-bucket')`,
			[gone, ORG],
		);
		try {
			const result = await drainPersonalDataExportFileCleanup(db, {
				now: systemClock.nowInstant(),
				deleteObject: async () => {
					throw new Error("Private storage bucket changed; object cleanup needs review");
				},
			});
			expect(result).toEqual({ deleted: 0, failed: 1, dropped: 1 });
			const { rows } = await admin.query<{ organization_id: string; attempts: number }>(
				"select organization_id, attempts from personal_data_export_file_cleanup where organization_id in ($1, $2)",
				[gone, ORG],
			);
			// The organization and its storage are gone: retrying could never succeed.
			expect(rows).toEqual([{ organization_id: ORG, attempts: 1 }]);
		} finally {
			await admin.query(
				"delete from personal_data_export_file_cleanup where organization_id in ($1, $2)",
				[gone, ORG],
			);
		}
	});
});
