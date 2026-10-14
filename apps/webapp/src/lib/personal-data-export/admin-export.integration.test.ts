/**
 * #1166: the admin export against a disposable PostgreSQL database. Org admins
 * request, list and download a personal data export of any employee, current
 * or former, from the employee page's server actions; the build holds the
 * withheld data and account data limited to name and email, and a current
 * employee is told that an administrator exported their data. The session,
 * object storage and the job queue are replaced; data is seeded directly.
 */

import JSZip from "jszip";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { plainDateAt, systemClock } from "@/lib/datetime/temporal-core";
import { integrationAdminPool } from "@/test/integration-database";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const harness = vi.hoisted(() => ({
	userId: null as string | null,
	organizationId: "t1166-org",
	objects: new Map<string, Uint8Array>(),
	jobs: [] as { organizationId: string; exportId: string }[],
	signed: [] as { key: string }[],
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
		return { bucket: "t1166-private", versionId: `v-${key}` };
	},
	async deletePrivateObject(input: { key: string }) {
		harness.objects.delete(input.key);
	},
	async deletePrivateObjectVersions(input: { key: string }) {
		harness.objects.delete(input.key);
	},
	async getPrivateObjectPresignedUrl(input: { key: string }) {
		harness.signed.push(input);
		return `https://storage.test/${input.key}`;
	},
}));

const { db } = await import("@/db");
const { requestMyPersonalDataExport, getPersonalDataExportDownloadUrl } = await import(
	"@/app/[locale]/(app)/settings/my-data/actions"
);
const { getEmployeePersonalDataExportsAction, requestEmployeePersonalDataExportAction } =
	await import("@/app/[locale]/(app)/settings/employees/personal-data-export.actions");
const { processPersonalDataExport } = await import("./processor");

const ORG = "t1166-org";

const ids = {
	ada: "11660000-0000-4000-8000-000000000001",
	owner: "11660000-0000-4000-8000-000000000002",
	andy: "11660000-0000-4000-8000-000000000003",
	bob: "11660000-0000-4000-8000-000000000004",
	former: "11660000-0000-4000-8000-000000000005",
	kiosk: "11660000-0000-4000-8000-000000000006",
	project: "11660000-0000-4000-8000-0000000000c1",
	fieldShirt: "11660000-0000-4000-8000-0000000000d1",
	fieldBand: "11660000-0000-4000-8000-0000000000d2",
	period: "11660000-0000-4000-8000-0000000000e1",
	departure: "11660000-0000-4000-8000-0000000000e2",
} as const;

const admin = integrationAdminPool();

async function cleanup() {
	await admin.query("delete from audit_log where organization_id = $1", [ORG]);
	await admin.query("delete from organization where id = $1", [ORG]);
	await admin.query("delete from personal_data_export_file_cleanup where organization_id = $1", [
		ORG,
	]);
	await admin.query('delete from "user" where id like $1', ["t1166-%"]);
}

async function seedPerson(
	name: string,
	employeeId: string,
	fields: { displayName: string; role?: string; isActive?: boolean; email?: string },
) {
	await admin.query(
		'insert into "user" (id,name,email,created_at,updated_at) values ($1,$2,$3,now(),now())',
		[`t1166-${name}`, fields.displayName, fields.email ?? `t1166-${name}@example.test`],
	);
	await admin.query(
		"insert into member (id,organization_id,user_id,role,status,created_at) values ($1,$2,$3,$4,'approved',now())",
		[`t1166-member-${name}`, ORG, `t1166-${name}`, fields.role ?? "member"],
	);
	await admin.query(
		`insert into employee (id,user_id,organization_id,role,is_active,updated_at)
		 values ($1,$2,$3,$4,$5,now())`,
		[
			employeeId,
			`t1166-${name}`,
			ORG,
			fields.role === "member" || !fields.role ? "employee" : "admin",
			fields.isActive ?? true,
		],
	);
}

function signIn(name: string) {
	harness.userId = `t1166-${name}`;
	harness.organizationId = ORG;
}

async function exportRows(employeeId: string) {
	const { rows } = await admin.query<{ id: string; kind: string; status: string }>(
		"select id, kind, status from personal_data_export where organization_id = $1 and employee_id = $2 order by created_at",
		[ORG, employeeId],
	);
	return rows;
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

/** An admin requests an admin export of `employeeId`, and the worker builds it. */
async function adminExport(adminName: string, employeeId: string): Promise<string> {
	signIn(adminName);
	const requested = await requestEmployeePersonalDataExportAction(employeeId);
	if (!requested.success) throw new Error(`request refused: ${requested.error}`);
	expect(harness.jobs.at(-1)).toEqual({ organizationId: ORG, exportId: requested.data.exportId });
	const outcome = await processPersonalDataExport(db, {
		organizationId: ORG,
		exportId: requested.data.exportId,
	});
	expect(outcome).toEqual({ status: "completed" });
	return requested.data.exportId;
}

async function notificationsOf(userId: string, type: string) {
	const { rows } = await admin.query<{
		title: string;
		message: string;
		action_url: string | null;
		metadata: string | null;
	}>(
		"select title, message, action_url, metadata from notification where organization_id = $1 and user_id = $2 and type = $3",
		[ORG, userId, type],
	);
	return rows;
}

describe("admin export (#1166)", () => {
	beforeAll(async () => {
		await cleanup();
		await admin.query(
			`insert into organization (id, name, slug, timezone, created_at) values ($1, 'Acme GmbH', $1, 'Europe/Berlin', now())`,
			[ORG],
		);
		await seedPerson("ada", ids.ada, { displayName: "Ada Lovelace" });
		await seedPerson("owner", ids.owner, { displayName: "Olga Owner", role: "owner" });
		await seedPerson("andy", ids.andy, { displayName: "Andy Admin", role: "admin" });
		await seedPerson("bob", ids.bob, { displayName: "Bob Builder" });
		await seedPerson("former", ids.former, { displayName: "Fred Former", isActive: false });
		await seedPerson("kiosk", ids.kiosk, {
			displayName: "Kim Kiosk",
			email: "t1166-kiosk@kiosk.invalid",
		});

		// Withheld data: billable and cost rates, a custom field above employee
		// visibility, and a canceled departure's task and review.
		await admin.query(
			`insert into project (id, organization_id, name, created_by, updated_at) values ($1, $2, 'Moonshot', 't1166-owner', now())`,
			[ids.project, ORG],
		);
		await admin.query(
			`insert into billable_rate (organization_id, level, employee_id, project_id, hourly_rate, effective_from, created_by) values
			   ($1, 'employee', $2, null, '187.50', '2026-01-01', 't1166-owner'),
			   ($1, 'employee_project', $2, $3, '210.00', '2026-03-01', 't1166-owner')`,
			[ORG, ids.ada, ids.project],
		);
		await admin.query(
			`insert into cost_rate (organization_id, employee_id, hourly_rate, effective_from, created_by)
			 values ($1, $2, '64.25', '2026-01-01', 't1166-owner')`,
			[ORG, ids.ada],
		);
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
		await admin.query(
			`insert into employee_employment_period (id, organization_id, employee_id, status, started_at, start_provenance)
			 values ($1, $2, $3, 'open', '2025-01-01T00:00:00Z', 'recorded')`,
			[ids.period, ORG, ids.ada],
		);
		await admin.query(
			`insert into employee_departure (id, organization_id, employee_id, employment_period_id, mode, last_working_day,
			   timezone, cutoff_at, revision, status, created_by, request_id, request_fingerprint)
			 values ($1, $2, $3, $4, 'scheduled', '2026-12-31', 'Europe/Berlin', '2026-12-31T23:00:00Z', 1, 'canceled',
			   't1166-owner', gen_random_uuid(), 'fp-t1166')`,
			[ids.departure, ORG, ids.ada, ids.period],
		);
		await admin.query(
			`insert into employee_departure_task (organization_id, employee_id, employment_period_id, departure_id, kind,
			   dedupe_key, payload, status, completed_at)
			 values ($1, $2, $3, $4, 'session_revocation', 't1166-task', '{"secret":"task-payload-t1166"}', 'completed', now())`,
			[ORG, ids.ada, ids.period, ids.departure],
		);
		await admin.query(
			`insert into employee_departure_review (organization_id, employee_id, employment_period_id, departure_id, kind,
			   status, metadata, resolved_by, resolved_at, resolution)
			 values ($1, $2, $3, $4, 'future_work', 'resolved', '{"note":"review-meta-t1166"}', 't1166-owner', now(),
			   'Moved the shifts to Bob')`,
			[ORG, ids.ada, ids.period, ids.departure],
		);
	});

	beforeEach(async () => {
		await admin.query("delete from personal_data_export where organization_id = $1", [ORG]);
		await admin.query("delete from notification where organization_id = $1", [ORG]);
		harness.objects.clear();
		harness.jobs.length = 0;
		harness.signed.length = 0;
	});

	afterAll(async () => {
		await cleanup();
	});

	it("holds the withheld Employment data and account data limited to name and email", async () => {
		const files = await zipFiles(await adminExport("owner", ids.ada));
		const employment = JSON.parse(files["employment.json"] as string);
		expect(employment._metadata).toMatchObject({ kind: "admin", employeeId: ids.ada });
		expect(employment.billable_rates).toEqual([
			expect.objectContaining({
				level: "employee",
				project: null,
				hourly_rate: "187.50",
				effective_from: "2026-01-01",
				created_by: "Olga Owner",
			}),
			expect.objectContaining({
				level: "employee_project",
				project: "Moonshot",
				hourly_rate: "210.00",
			}),
		]);
		expect(employment.cost_rates).toEqual([
			expect.objectContaining({ hourly_rate: "64.25", effective_from: "2026-01-01" }),
		]);
		expect(employment.custom_fields.map((row: { field: string }) => row.field)).toEqual([
			"Shirt size",
			"Salary band",
		]);
		expect(employment.departure_tasks).toEqual([
			expect.objectContaining({
				departure_id: ids.departure,
				kind: "session_revocation",
				status: "completed",
			}),
		]);
		expect(employment.departure_reviews).toEqual([
			expect.objectContaining({
				departure_id: ids.departure,
				kind: "future_work",
				status: "resolved",
				resolution: "Moved the shifts to Bob",
				resolved_by: "Olga Owner",
			}),
		]);
		expect(files["employment/billable_rates.csv"]).toBeDefined();

		const account = JSON.parse(files["account.json"] as string);
		const { _metadata, ...accountParts } = account;
		expect(accountParts).toEqual({
			user: {
				name: "Ada Lovelace",
				first_name: null,
				last_name: null,
				email: "t1166-ada@example.test",
			},
		});

		const everything = Object.values(files).join("\n");
		// Technical columns stay out even of the admin export.
		for (const leaked of ["task-payload-t1166", "review-meta-t1166", "t1166-task", "fp-t1166"]) {
			expect(everything, leaked).not.toContain(leaked);
		}
		expect(JSON.parse(files["_manifest.json"] as string).kind).toBe("admin");
		expect(files["README.txt"]).toContain("An administrator of Acme GmbH");
	});

	it("leaves every withheld record out of the employee export", async () => {
		signIn("ada");
		const requested = await requestMyPersonalDataExport();
		if (!requested.success) throw new Error(requested.error);
		await processPersonalDataExport(db, { organizationId: ORG, exportId: requested.data.exportId });
		const files = await zipFiles(requested.data.exportId);
		const employment = JSON.parse(files["employment.json"] as string);
		for (const part of ["billable_rates", "cost_rates", "departure_tasks", "departure_reviews"]) {
			expect(employment, part).not.toHaveProperty(part);
		}
		const everything = Object.values(files).join("\n");
		for (const leaked of [
			"187.50",
			"210.00",
			"64.25",
			"Salary band",
			"Band 7",
			"session_revocation",
			"Moved the shifts to Bob",
		]) {
			expect(everything, leaked).not.toContain(leaked);
		}
		// The admin was not told: an employee starting their own export notifies nobody else.
		expect(await notificationsOf("t1166-owner", "personal_data_export_ready")).toEqual([]);
	});

	it("writes the README in the employee's language, not the admin's", async () => {
		await admin.query(
			`insert into user_settings (user_id, locale, updated_at) values ('t1166-ada', 'de', now()), ('t1166-owner', 'fr', now())
			 on conflict (user_id) do update set locale = excluded.locale`,
		);
		try {
			const files = await zipFiles(await adminExport("owner", ids.ada));
			expect(JSON.parse(files["_manifest.json"] as string).locale).toBe("de");
		} finally {
			await admin.query("delete from user_settings where user_id in ('t1166-ada', 't1166-owner')");
		}
	});

	it("lets org admins list and download admin exports, and audits them with kind admin", async () => {
		const exportId = await adminExport("owner", ids.ada);

		// Another admin of the organization sees and downloads it from the employee page.
		signIn("andy");
		expect(await getEmployeePersonalDataExportsAction(ids.ada)).toMatchObject({
			success: true,
			data: [{ id: exportId, kind: "admin", status: "completed" }],
		});
		expect(await getPersonalDataExportDownloadUrl(exportId)).toMatchObject({ success: true });
		expect(harness.signed).toHaveLength(1);

		const { rows: audit } = await admin.query<{
			action: string;
			performed_by: string;
			employee_id: string;
			metadata: string;
		}>(
			"select action, performed_by, employee_id, metadata from audit_log where organization_id = $1 and entity_id = $2 order by timestamp",
			[ORG, exportId],
		);
		expect(audit.map((row) => ({ ...row, metadata: JSON.parse(row.metadata) }))).toEqual([
			{
				action: "personal_data_export.requested",
				performed_by: "t1166-owner",
				employee_id: ids.ada,
				metadata: { kind: "admin", employeeId: ids.ada, requestedByUserId: "t1166-owner" },
			},
			{
				action: "personal_data_export.downloaded",
				performed_by: "t1166-andy",
				employee_id: ids.ada,
				metadata: { kind: "admin", employeeId: ids.ada, requestedByUserId: "t1166-owner" },
			},
		]);

		// The requester is told the file is ready, with a link to the employee page.
		const ready = await notificationsOf("t1166-owner", "personal_data_export_ready");
		expect(ready).toEqual([
			expect.objectContaining({ action_url: `/settings/employees/${ids.ada}` }),
		]);
	});

	it("refuses non-admins: request, list and download", async () => {
		const exportId = await adminExport("owner", ids.ada);
		harness.signed.length = 0;

		signIn("bob");
		expect(await requestEmployeePersonalDataExportAction(ids.ada)).toMatchObject({
			success: false,
			code: "AuthorizationError",
		});
		expect(await getEmployeePersonalDataExportsAction(ids.ada)).toMatchObject({
			success: false,
			code: "AuthorizationError",
		});
		expect(await getPersonalDataExportDownloadUrl(exportId)).toMatchObject({
			success: false,
			code: "NotFoundError",
		});
		// Ada herself cannot download the admin export of her data either.
		signIn("ada");
		expect(await getPersonalDataExportDownloadUrl(exportId)).toMatchObject({
			success: false,
			code: "NotFoundError",
		});
		expect(harness.signed).toEqual([]);
		expect((await exportRows(ids.ada)).map((row) => row.kind)).toEqual(["admin"]);
	});

	it("refuses an admin export of the admin's own employee record", async () => {
		signIn("owner");
		expect(await requestEmployeePersonalDataExportAction(ids.owner)).toMatchObject({
			success: false,
			code: "AuthorizationError",
		});
		expect(await exportRows(ids.owner)).toEqual([]);
		expect(harness.jobs).toEqual([]);
	});

	it("never lists or hands an admin the admin export of their own employee record", async () => {
		// Another admin exported Andy's data: Andy must not reach the withheld copy of himself.
		const exportId = await adminExport("owner", ids.andy);
		harness.signed.length = 0;

		signIn("andy");
		expect(await getEmployeePersonalDataExportsAction(ids.andy)).toMatchObject({
			success: false,
			code: "AuthorizationError",
		});
		expect(await getPersonalDataExportDownloadUrl(exportId)).toMatchObject({
			success: false,
			code: "NotFoundError",
		});
		expect(harness.signed).toEqual([]);
		const { rows: downloads } = await admin.query(
			"select id from audit_log where organization_id = $1 and entity_id = $2 and action = 'personal_data_export.downloaded'",
			[ORG, exportId],
		);
		expect(downloads).toEqual([]);

		// The other admins still can.
		signIn("owner");
		expect(await getEmployeePersonalDataExportsAction(ids.andy)).toMatchObject({
			success: true,
			data: [{ id: exportId }],
		});
		expect(await getPersonalDataExportDownloadUrl(exportId)).toMatchObject({ success: true });
	});

	it("shares the one-in-progress rule with employee exports and has no 24-hour cap", async () => {
		signIn("ada");
		const own = await requestMyPersonalDataExport();
		expect(own.success).toBe(true);

		signIn("owner");
		expect(await requestEmployeePersonalDataExportAction(ids.ada)).toMatchObject({
			success: false,
			refusal: "in_progress",
		});

		await admin.query("delete from personal_data_export where organization_id = $1", [ORG]);
		await adminExport("owner", ids.ada);
		await adminExport("owner", ids.ada);
		await adminExport("andy", ids.ada);
		expect((await exportRows(ids.ada)).map((row) => row.status)).toEqual([
			"completed",
			"completed",
			"completed",
		]);

		signIn("andy");
		await requestEmployeePersonalDataExportAction(ids.ada);
		// While an admin export builds, Ada's own request waits too.
		signIn("ada");
		expect(await requestMyPersonalDataExport()).toMatchObject({
			success: false,
			refusal: "in_progress",
		});
	});

	it("tells a current employee that an administrator exported their data", async () => {
		await adminExport("owner", ids.ada);
		const notices = await notificationsOf("t1166-ada", "personal_data_export_admin_exported");
		expect(notices).toHaveLength(1);
		const notice = notices[0];
		const today = plainDateAt(systemClock.nowInstant(), "Europe/Berlin").toString();
		expect(JSON.parse(notice?.metadata ?? "{}")).toMatchObject({ onDay: today });
		expect(notice?.message).toMatch(/^An administrator exported your personal data on .+\.$/);
		expect(notice?.action_url).toBe("/settings/my-data");
	});

	it("tells neither a former employee nor a kiosk-only employee", async () => {
		await adminExport("owner", ids.former);
		await adminExport("owner", ids.kiosk);
		expect(await notificationsOf("t1166-former", "personal_data_export_admin_exported")).toEqual(
			[],
		);
		const { rows } = await admin.query(
			"select user_id from notification where organization_id = $1 and type = 'personal_data_export_admin_exported'",
			[ORG],
		);
		expect(rows).toEqual([]);
	});
});
