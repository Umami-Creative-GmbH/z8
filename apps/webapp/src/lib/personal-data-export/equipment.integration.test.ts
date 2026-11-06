import JSZip from "jszip";
import { afterAll, beforeEach, expect, it, vi } from "vitest";
import { integrationAdminPool } from "@/test/integration-database";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
const harness = vi.hoisted(() => ({
	userId: "t1548-ada",
	organizationId: "t1548-org",
	objects: new Map<string, Uint8Array>(),
	jobs: [] as { organizationId: string; exportId: string }[],
	signed: [] as { key: string }[],
}));
const retentionClock = vi.hoisted(() => ({ now: "2026-11-05T12:00:00Z" }));
vi.mock("@/lib/datetime/temporal-core", async (original) => {
	const actual =
		await original<typeof import("@/lib/datetime/temporal-core")>();
	return {
		...actual,
		systemClock: { nowInstant: () => actual.parseInstant(retentionClock.now) },
	};
});
vi.mock("next/headers", async () =>
	(await import("@/test/integration-harness")).nextHeaders(),
);
vi.mock("next/cache", async (original) =>
	(await import("@/test/integration-harness")).nextCache(original),
);
vi.mock("next/server", async (original) =>
	(await import("@/test/integration-harness")).nextServer(original),
);
vi.mock("@/lib/email/email-service", async (original) =>
	(await import("@/test/integration-harness")).emailService(original),
);
vi.mock("@/lib/auth", () => ({
	auth: {
		api: {
			getSession: async () => ({
				user: { id: harness.userId, role: "user" },
				session: {
					id: `session-${harness.userId}`,
					userId: harness.userId,
					activeOrganizationId: harness.organizationId,
				},
			}),
		},
	},
}));
vi.mock("@/lib/queue", async (original) => ({
	...(await original<typeof import("@/lib/queue")>()),
	addJob: async (
		_name: string,
		data: { organizationId: string; exportId: string },
	) => {
		harness.jobs.push(data);
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
		harness.objects.set(
			key,
			new Uint8Array(await new Response(body).arrayBuffer()),
		);
		return { bucket: "t1548-private", versionId: null };
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
const { requestMyPersonalDataExport, getPersonalDataExportDownloadUrl } =
	await import("@/app/[locale]/(app)/settings/my-data/actions");
const { requestEmployeePersonalDataExportAction } = await import(
	"@/app/[locale]/(app)/settings/employees/personal-data-export.actions"
);
const { processPersonalDataExport } = await import("./processor");
const { PERSONAL_DATA_COLLECTORS } = await import("./collectors");
const { findUnexplainedFields, readmeContentsOf } = await import("./readme");
const pool = integrationAdminPool();
const ORG = "t1548-org";
const OTHER = "t1548-other";
const id = (n: number) =>
	`15480000-0000-4000-8000-${String(n).padStart(12, "0")}`;

async function cleanup() {
	await pool.query("delete from organization where id in ($1,$2)", [
		ORG,
		OTHER,
	]);
	await pool.query(
		"delete from personal_data_export_file_cleanup where organization_id in ($1,$2)",
		[ORG, OTHER],
	);
	await pool.query('delete from "user" where id like $1', ["t1548-%"]);
}

beforeEach(async () => {
	await cleanup();
	for (const org of [ORG, OTHER])
		await pool.query(
			"insert into organization(id,name,slug,timezone,equipment_enabled,created_at) values($1,$1,$1,'Europe/Berlin',true,now())",
			[org],
		);
	for (const [n, name, org, role] of [
		[1, "ada", ORG, "member"],
		[2, "owner", ORG, "owner"],
		[3, "bob", ORG, "member"],
		[4, "former", ORG, "member"],
		[5, "foreign", OTHER, "owner"],
		[6, "ada", OTHER, "member"],
	] as const) {
		await pool.query(
			'insert into "user"(id,name,email,created_at,updated_at) values($1,$2,$3,now(),now()) on conflict do nothing',
			[`t1548-${name}`, `Recorder ${name}`, `${name}@t1548.example.test`],
		);
		await pool.query(
			"insert into member(id,user_id,organization_id,role,status,created_at) values($1,$2,$3,$4,'approved',now())",
			[`t1548-${org}-${name}`, `t1548-${name}`, org, role],
		);
		await pool.query(
			"insert into employee(id,user_id,organization_id,role,is_active,updated_at) values($1,$2,$3,'employee',$4,now())",
			[id(n), `t1548-${name}`, org, name !== "former"],
		);
	}
	for (const org of [ORG, OTHER])
		await pool.query(
			"insert into equipment_type(id,organization_id,name,tracking_mode,default_return_required) values($1,$2,$3,'quantity',true)",
			[
				id(org === ORG ? 10 : 11),
				org,
				org === ORG ? "Shirts" : "Foreign secret type",
			],
		);
	await pool.query(
		"insert into equipment_assignment(id,organization_id,type_id,employee_id,quantity,received_quantity,lost_quantity,waived_quantity,exception_received_quantity,return_required,explicit_deadline,revision) values($1,$2,$3,$4,5,3,2,1,1,true,'2026-10-30',4)",
		[id(20), ORG, id(10), id(1)],
	);
	await pool.query(
		`insert into equipment_handover(id,organization_id,assignment_id,kind,quantity,actual_date,historical,condition,notes,actor_id,recorded_at,effective) values
		($1,$3,$4,'issue',4,null,true,'unknown','Original issue note','t1548-owner','2026-11-01T23:30:00Z','{"quantity":5,"actualDate":null,"condition":"worn","notes":"Corrected issue note"}'),
		($2,$3,$4,'receipt',2,'2026-10-28',false,'good','Two returned','t1548-owner','2026-11-02T01:00:00Z',null)`,
		[id(30), id(31), ORG, id(20)],
	);
	await pool.query(
		`insert into equipment_exception(id,organization_id,assignment_id,kind,quantity,reason,actor_id,recorded_at,received_quantity) values
		($1,$3,$4,'lost',2,'Lost at departure','t1548-owner','2026-11-02T02:00:00Z',1),
		($2,$3,$4,'waived',1,'May keep one','t1548-owner','2026-11-02T03:00:00Z',0)`,
		[id(40), id(41), ORG, id(20)],
	);
	await pool.query(
		"insert into equipment_handover(id,organization_id,assignment_id,exception_id,kind,quantity,actual_date,condition,notes,actor_id,recorded_at) values($1,$2,$3,$4,'receipt',1,'2026-11-01','damaged','Recovered shirt','t1548-owner','2026-11-02T04:00:00Z')",
		[id(32), ORG, id(20), id(40)],
	);
	await pool.query(
		`insert into equipment_correction(organization_id,assignment_id,handover_id,expected_revision,reason,before,after,actor_id,recorded_at) values($1,$2,$3,1,'Count corrected','{"quantity":4,"actualDate":null,"condition":"unknown","notes":"Original issue note"}','{"quantity":5,"actualDate":null,"condition":"worn","notes":"Corrected issue note"}','t1548-owner','2026-11-02T05:00:00Z')`,
		[ORG, id(20), id(30)],
	);
	// Same type and actor do not grant access to Bob's equipment; same user in a second org is separate.
	for (const [assignment, subject, org, type, note] of [
		[21, 3, ORG, 10, "Bob secret equipment"],
		[22, 6, OTHER, 11, "Foreign secret equipment"],
	] as const) {
		await pool.query(
			"insert into equipment_assignment(id,organization_id,type_id,employee_id,quantity,return_required) values($1,$2,$3,$4,1,true)",
			[id(assignment), org, id(type), id(subject)],
		);
		await pool.query(
			"insert into equipment_handover(organization_id,assignment_id,kind,quantity,actual_date,condition,notes,actor_id) values($1,$2,'issue',1,'2026-10-01','good',$3,'t1548-owner')",
			[org, id(assignment), note],
		);
	}
});
afterAll(cleanup);
beforeEach(async () => {
	retentionClock.now = "2026-11-05T12:00:00Z";
	await pool.query(
		"delete from equipment_assignment where organization_id in ($1,$2) and id >= $3",
		[ORG, OTHER, id(50)],
	);
	harness.userId = "t1548-ada";
	harness.organizationId = ORG;
	harness.objects.clear();
	harness.jobs.length = 0;
	harness.signed.length = 0;
	await pool.query(
		"delete from personal_data_export where organization_id in ($1,$2)",
		[ORG, OTHER],
	);
});

it("new employee and admin ZIPs omit purged original/effective/correction evidence and retain held/outstanding records", async () => {
	await pool.query(
		"insert into equipment_policy(organization_id,retention_months) values($1,1)",
		[ORG],
	);
	await pool.query(
		"update equipment_assignment set last_activity_at='2026-11-02T05:00:00Z' where organization_id=$1 and id=$2",
		[ORG, id(20)],
	);
	for (const [assignment, subject, held, required, note] of [
		[80, 1, true, false, "Held personal case evidence"],
		[81, 4, false, false, "Former expired personal history"],
		[82, 4, false, true, "Former outstanding personal history"],
		[83, 4, true, false, "Former held personal history"],
	] as const) {
		await pool.query(
			"insert into equipment_assignment(id,organization_id,type_id,employee_id,quantity,return_required,case_held,last_activity_at) values($1,$2,$3,$4,1,$5,$6,'2026-11-02T05:00:00Z')",
			[id(assignment), ORG, id(10), id(subject), required, held],
		);
		await pool.query(
			"insert into equipment_handover(organization_id,assignment_id,kind,quantity,actual_date,condition,notes,actor_id,recorded_at) values($1,$2,'issue',1,'2026-11-01','good',$3,'t1548-owner','2026-11-02T05:00:00Z')",
			[ORG, id(assignment), note],
		);
		if (held)
			await pool.query(
				"insert into equipment_case_hold_event(organization_id,assignment_id,kind,reason,actor_id,recorded_at,revision) values($1,$2,'place','Specific documented case','t1548-owner','2026-11-02T05:00:00Z',2)",
				[ORG, id(assignment)],
			);
	}
	const before = await build("employee");
	expect(before.files["equipment.json"]).toContain("Original issue note");
	retentionClock.now = "2026-12-02T23:00:00Z";
	const { runEquipmentRetentionJob } = await import(
		"@/lib/jobs/equipment-retention"
	);
	expect(await runEquipmentRetentionJob()).toMatchObject({
		deletedCount: 2,
		errors: [],
	});
	const own = await build("employee");
	expect(own.equipment.assignments.map((a: { id: string }) => a.id)).toEqual([
		id(80),
	]);
	expect(own.files["equipment.json"]).toContain("Held personal case evidence");
	expect(own.equipment.case_holds).toMatchObject([
		{
			kind: "place",
			reason: "Specific documented case",
			recorded_by: "Recorder owner",
		},
	]);
	for (const secret of [
		"Original issue note",
		"Corrected issue note",
		"Lost at departure",
		"Count corrected",
		"Recovered shirt",
	])
		expect(Object.values(own.files).join("\n")).not.toContain(secret);
	harness.userId = "t1548-owner";
	const admin = await build("admin");
	expect(admin.equipment.assignments.map((a: { id: string }) => a.id)).toEqual([
		id(80),
	]);
	const former = await build("admin", id(4));
	expect(former.equipment.assignments.map((a: { id: string }) => a.id)).toEqual(
		[id(82), id(83)],
	);
	expect(former.files["equipment.json"]).not.toContain(
		"Former expired personal history",
	);
	expect(former.files["equipment.json"]).toContain(
		"Former outstanding personal history",
	);
	expect(former.files["equipment.json"]).toContain(
		"Former held personal history",
	);
	await pool.query("delete from equipment_policy where organization_id=$1", [
		ORG,
	]);
});

it("exports scheduled and immediate endings for former subjects and keeps a reactivated assignment's original ending separate from fresh equipment", async () => {
	for (const [period, subject, status, end] of [
		[50, 1, "open", null],
		[51, 4, "closed", "2026-10-31T23:00:00Z"],
		[52, 4, "closed", "2026-11-02T23:30:00Z"],
	] as const) {
		await pool.query(
			"insert into employee_employment_period(id,organization_id,employee_id,status,started_at,ended_at,start_provenance) values($1,$2,$3,$4,$5,$6,'recorded')",
			[
				id(period),
				ORG,
				id(subject),
				status,
				period === 52 ? "2026-10-31T23:00:00Z" : "2025-01-01T00:00:00Z",
				end,
			],
		);
	}
	for (const [departure, subject, period, day, status, effective] of [
		[60, 1, 50, "2026-12-31", "pending", null],
		[61, 4, 51, "2026-10-31", "effective", "2026-10-31T23:00:00Z"],
	] as const) {
		await pool.query(
			"insert into employee_departure(id,organization_id,employee_id,employment_period_id,mode,last_working_day,timezone,cutoff_at,revision,status,effective_at,created_by,request_id,request_fingerprint) values($1,$2,$3,$4,'scheduled',$5,'Europe/Berlin',$6,1,$7,$8,'t1548-owner',gen_random_uuid(),'not-exportable-fingerprint')",
			[
				id(departure),
				ORG,
				id(subject),
				id(period),
				day,
				departure === 60 ? "2026-12-31T23:00:00Z" : "2026-10-31T23:00:00Z",
				status,
				effective,
			],
		);
	}
	for (const [ending, subject, period, at, reactivated] of [
		[62, 4, 52, "2026-11-02T23:30:00Z", null],
		[63, 1, 50, "2026-10-31T23:30:00Z", "2026-11-01T09:00:00Z"],
	] as const) {
		await pool.query(
			'insert into employee_deactivation(id,organization_id,employee_id,employment_period_id,deactivated_at,created_by,reason,request_id,request_fingerprint,reactivated_at,plan,applied) values($1,$2,$3,$4,$5,\'t1548-owner\',\'employee_deactivated\',gen_random_uuid(),\'not-exportable-fingerprint\',$6,\'{"timeZone":"Europe/Berlin","secret":"unrelated deactivation plan"}\',\'{"secret":"unrelated deactivation consequences"}\')',
			[id(ending), ORG, id(subject), id(period), at, reactivated],
		);
	}
	for (const [
		assignment,
		subject,
		period,
		departure,
		ending,
		explicit,
		derived,
	] of [
		[70, 4, 51, 61, null, "2026-10-29", "2026-10-31"],
		[71, 4, 52, null, 62, null, "2026-11-03"],
		[72, 1, 50, null, 63, null, "2026-11-01"],
		[73, 1, 50, 60, null, null, "2026-12-31"],
	] as const) {
		await pool.query(
			"insert into equipment_assignment(id,organization_id,type_id,employee_id,quantity,return_required,employment_period_id,departure_id,deactivation_id,explicit_deadline,departure_deadline) values($1,$2,$3,$4,1,true,$5,$6,$7,$8,$9)",
			[
				id(assignment),
				ORG,
				id(10),
				id(subject),
				id(period),
				departure ? id(departure) : null,
				ending ? id(ending) : null,
				explicit,
				derived,
			],
		);
		await pool.query(
			"insert into equipment_handover(organization_id,assignment_id,kind,quantity,actual_date,historical,condition,actor_id) values($1,$2,'issue',1,null,true,'unknown','t1548-owner')",
			[ORG, id(assignment)],
		);
	}
	await pool.query(
		"insert into employee_departure_review(organization_id,employee_id,employment_period_id,departure_id,kind,status,resolution) values($1,$2,$3,$4,'future_work','open','Withheld equipment-independent review')",
		[ORG, id(1), id(50), id(60)],
	);
	const own = await build("employee");
	expect(own.equipment.assignments).toContainEqual(
		expect.objectContaining({
			id: id(72),
			employment_period_id: id(50),
			period_status: "open",
			period_ended_at: null,
			deactivation_id: id(63),
			departure_id: null,
			deactivated_at: "2026-10-31T23:30:00Z",
			deactivation_timezone: "Europe/Berlin",
			reactivated_at: "2026-11-01T09:00:00Z",
			effective_deadline: "2026-11-01",
		}),
	);
	expect(own.equipment.assignments).toContainEqual(
		expect.objectContaining({
			id: id(73),
			employment_period_id: id(50),
			deactivation_id: null,
			departure_id: id(60),
			departure_status: "pending",
			last_working_day: "2026-12-31",
			departure_timezone: "Europe/Berlin",
			effective_deadline: "2026-12-31",
		}),
	);
	expect(Object.values(own.files).join("\n")).not.toContain(
		"Withheld equipment-independent review",
	);
	harness.userId = "t1548-owner";
	const former = await build("admin", id(4));
	expect(former.equipment.assignments).toEqual(
		expect.arrayContaining([
			expect.objectContaining({
				id: id(70),
				employment_period_id: id(51),
				departure_id: id(61),
				departure_mode: "scheduled",
				departure_status: "effective",
				departure_timezone: "Europe/Berlin",
				departure_cutoff_at: "2026-10-31T23:00:00Z",
				explicit_deadline: "2026-10-29",
				departure_deadline: "2026-10-31",
				effective_deadline: "2026-10-29",
			}),
			expect.objectContaining({
				id: id(71),
				employment_period_id: id(52),
				deactivation_id: id(62),
				deactivated_at: "2026-11-02T23:30:00Z",
				reactivated_at: null,
				effective_deadline: "2026-11-03",
			}),
		]),
	);
	expect(former.equipment.assignments).toHaveLength(2);
	for (const files of [own.files, former.files])
		for (const secret of [
			"unrelated deactivation plan",
			"unrelated deactivation consequences",
			"not-exportable-fingerprint",
			"Bob secret equipment",
			"Foreign secret equipment",
		])
			expect(Object.values(files).join("\n")).not.toContain(secret);
	expect(Object.values(former.files).join("\n")).not.toContain(
		"Withheld equipment-independent review",
	);
});

it("keeps other holders and foreign actors out of shared-item history, then omits anonymized personal history instead of rebuilding it from custody", async () => {
	await pool.query(
		"insert into equipment_type(id,organization_id,name,tracking_mode,default_return_required) values($1,$2,'Laptop','individual',true)",
		[id(80), ORG],
	);
	await pool.query(
		"insert into equipment_item(id,organization_id,type_id,identifier,serial_number,in_custody) values($1,$2,$3,'SHARED-LAPTOP','SN1548',true)",
		[id(81), ORG, id(80)],
	);
	for (const [assignment, subject, received] of [
		[82, 1, true],
		[83, 3, false],
	] as const) {
		await pool.query(
			"insert into equipment_assignment(id,organization_id,type_id,item_id,employee_id,quantity,received_quantity,return_required,received) values($1,$2,$3,$4,$5,1,$6,true,$7)",
			[
				id(assignment),
				ORG,
				id(80),
				id(81),
				id(subject),
				received ? 1 : 0,
				received,
			],
		);
		await pool.query(
			"insert into equipment_handover(id,organization_id,assignment_id,kind,quantity,actual_date,condition,notes,actor_id) values($1,$2,$3,'issue',1,'2026-10-01','good',$4,$5)",
			[
				id(assignment + 10),
				ORG,
				id(assignment),
				received
					? "Ada retained laptop history"
					: "Other holder private laptop history",
				received ? "t1548-foreign" : "t1548-owner",
			],
		);
	}
	await pool.query(
		"insert into equipment_handover(id,organization_id,assignment_id,kind,quantity,actual_date,condition,notes,actor_id) values($1,$2,$3,'receipt',1,'2026-10-02','good','Ada laptop receipt','t1548-owner')",
		[id(94), ORG, id(82)],
	);
	await pool.query(
		"insert into equipment_transfer(organization_id,receipt_id,issue_id) values($1,$2,$3)",
		[ORG, id(94), id(93)],
	);
	const own = await build("employee");
	expect(own.equipment.assignments).toContainEqual(
		expect.objectContaining({
			id: id(82),
			identifier: "SHARED-LAPTOP",
			serial_number: "SN1548",
		}),
	);
	expect(own.equipment.handovers).toContainEqual(
		expect.objectContaining({
			id: id(92),
			notes: "Ada retained laptop history",
			recorded_by: null,
		}),
	);
	expect(JSON.stringify(own.equipment)).not.toContain(id(83));
	for (const secret of [
		"Other holder private laptop history",
		"Recorder foreign",
		"foreign@t1548.example.test",
	])
		expect(Object.values(own.files).join("\n")).not.toContain(secret);
	// Model the persisted result of finite retention, not the future cleanup worker.
	await pool.query(
		"delete from equipment_handover where organization_id=$1 and assignment_id=$2",
		[ORG, id(82)],
	);
	await pool.query(
		"update equipment_assignment set employee_id=null,employment_period_id=null,departure_id=null,deactivation_id=null where organization_id=$1 and id=$2",
		[ORG, id(82)],
	);
	await pool.query(
		"delete from personal_data_export where organization_id=$1",
		[ORG],
	);
	harness.userId = "t1548-owner";
	const after = await build("admin");
	for (const secret of [
		"SHARED-LAPTOP",
		"SN1548",
		"Ada retained laptop history",
		"Ada laptop receipt",
		"Other holder private laptop history",
	])
		expect(JSON.stringify(after.equipment)).not.toContain(secret);
	expect(after.equipment.assignments).toHaveLength(1);
});

it("enforces the existing organization, subject and admin download boundary for equipment archives", async () => {
	const own = await build("employee");
	harness.userId = "t1548-bob";
	expect(await getPersonalDataExportDownloadUrl(own.exportId)).toMatchObject({
		success: false,
		code: "NotFoundError",
	});
	expect(await requestEmployeePersonalDataExportAction(id(1))).toMatchObject({
		success: false,
		code: "AuthorizationError",
	});
	harness.userId = "t1548-owner";
	expect(await requestEmployeePersonalDataExportAction(id(6))).toMatchObject({
		success: false,
		code: "NotFoundError",
	});
	const former = await build("admin", id(4));
	expect(former.equipment.assignments).toEqual([]);
	harness.userId = "t1548-former";
	expect(await requestMyPersonalDataExport()).toMatchObject({ success: false });
	expect(await getPersonalDataExportDownloadUrl(former.exportId)).toMatchObject(
		{ success: false },
	);
	harness.userId = "t1548-foreign";
	harness.organizationId = OTHER;
	expect(await getPersonalDataExportDownloadUrl(own.exportId)).toMatchObject({
		success: false,
		code: "NotFoundError",
	});
	expect(await getPersonalDataExportDownloadUrl(former.exportId)).toMatchObject(
		{ success: false, code: "NotFoundError" },
	);
	expect(await requestEmployeePersonalDataExportAction(id(1))).toMatchObject({
		success: false,
		code: "NotFoundError",
	});
});

async function build(kind: "employee" | "admin", subject = id(1)) {
	const requested =
		kind === "employee"
			? await requestMyPersonalDataExport()
			: await requestEmployeePersonalDataExportAction(subject);
	if (!requested.success) throw new Error(requested.error);
	expect(harness.jobs.at(-1)).toMatchObject({
		organizationId: ORG,
		exportId: requested.data.exportId,
	});
	expect(
		await processPersonalDataExport(db, {
			organizationId: ORG,
			exportId: requested.data.exportId,
		}),
	).toEqual({ status: "completed" });
	const download = await getPersonalDataExportDownloadUrl(
		requested.data.exportId,
	);
	expect(download).toMatchObject({ success: true });
	const key = harness.signed.at(-1)?.key;
	const bytes = harness.objects.get(key ?? "");
	if (!bytes) throw new Error("Download did not identify the built archive");
	const zip = await JSZip.loadAsync(bytes);
	const files: Record<string, string> = {};
	for (const entry of Object.values(zip.files))
		if (!entry.dir) files[entry.name] = await entry.async("string");
	return {
		exportId: requested.data.exportId,
		files,
		equipment: JSON.parse(files["equipment.json"] ?? "null"),
	};
}

it("preserves a reversed receipt and amended exception alongside effective balances, and describes issued-to-keep equipment without a return", async () => {
	await pool.query(
		"insert into equipment_assignment(id,organization_id,type_id,employee_id,quantity,return_required,waived_quantity) values($1,$3,$4,$5,3,true,1),($2,$3,$4,$5,1,false,0)",
		[id(100), id(101), ORG, id(10), id(1)],
	);
	await pool.query(
		`insert into equipment_handover(id,organization_id,assignment_id,kind,quantity,actual_date,condition,notes,actor_id,effective) values
		($1,$4,$5,'issue',3,'2026-10-01','good','Known actual issue date','t1548-owner',null),
		($2,$4,$6,'issue',1,'2026-10-01','unknown','Issued to keep','t1548-owner',null),
		($3,$4,$5,'receipt',2,'2026-10-02','worn','Mistaken receipt','t1548-owner','{"quantity":0,"actualDate":"2026-10-02","condition":"unknown","notes":null}')`,
		[id(110), id(111), id(112), ORG, id(100), id(101)],
	);
	await pool.query(
		`insert into equipment_exception(id,organization_id,assignment_id,kind,quantity,reason,actor_id,effective) values($1,$2,$3,'lost',2,'Original loss reason','t1548-owner','{"kind":"waived","quantity":1,"reason":"Permission to keep one"}')`,
		[id(120), ORG, id(100)],
	);
	await pool.query(
		`insert into equipment_correction(organization_id,assignment_id,handover_id,expected_revision,reason,before,after,actor_id) values($1,$2,$3,1,'Receipt reversed','{"quantity":2,"actualDate":"2026-10-02","condition":"worn","notes":"Mistaken receipt"}','{"quantity":0,"actualDate":"2026-10-02","condition":"unknown","notes":null}','t1548-owner')`,
		[ORG, id(100), id(112)],
	);
	await pool.query(
		`insert into equipment_correction(organization_id,assignment_id,exception_id,expected_revision,reason,before,after,actor_id) values($1,$2,$3,2,'Outcome amended','{"kind":"lost","quantity":2,"reason":"Original loss reason"}','{"kind":"waived","quantity":1,"reason":"Permission to keep one"}','t1548-owner')`,
		[ORG, id(100), id(120)],
	);
	const { equipment, files } = await build("employee");
	expect(equipment.assignments).toContainEqual(
		expect.objectContaining({
			id: id(100),
			quantity: 3,
			physically_received_quantity: 0,
			lost_quantity: 0,
			waived_quantity: 1,
			outstanding_quantity: 2,
		}),
	);
	expect(equipment.assignments).toContainEqual(
		expect.objectContaining({
			id: id(101),
			return_required: false,
			outstanding_quantity: 0,
			explicit_deadline: null,
			departure_deadline: null,
			effective_deadline: null,
		}),
	);
	expect(equipment.handovers).toContainEqual(
		expect.objectContaining({
			id: id(112),
			quantity: 2,
			notes: "Mistaken receipt",
			condition: "worn",
			effective_quantity: 0,
			effective_notes: null,
			effective_condition: "unknown",
			actual_date: "2026-10-02",
			effective_actual_date: "2026-10-02",
		}),
	);
	expect(equipment.handovers).toContainEqual(
		expect.objectContaining({
			id: id(110),
			historical: false,
			actual_date: "2026-10-01",
			effective_actual_date: "2026-10-01",
		}),
	);
	expect(equipment.exceptions).toContainEqual(
		expect.objectContaining({
			id: id(120),
			kind: "lost",
			quantity: 2,
			reason: "Original loss reason",
			effective_kind: "waived",
			effective_quantity: 1,
			effective_reason: "Permission to keep one",
		}),
	);
	expect(equipment.corrections).toEqual(
		expect.arrayContaining([
			expect.objectContaining({
				reason: "Receipt reversed",
				before: expect.stringContaining('"quantity":2'),
				after: expect.stringContaining('"quantity":0'),
			}),
			expect.objectContaining({
				reason: "Outcome amended",
				exception_id: id(120),
				before: expect.stringContaining('"kind":"lost"'),
				after: expect.stringContaining('"kind":"waived"'),
			}),
		]),
	);
	expect(files["README.txt"]).toContain("zero reverses a mistaken receipt");
	expect(files["README.txt"]).toContain("False means issued to keep");
});

it("requests, builds and downloads retained equipment with original/corrected evidence and distinct receipt, loss, waiver and recovery", async () => {
	const { files, equipment } = await build("employee");
	expect(equipment).not.toBeNull();
	expect(equipment.assignments).toEqual([
		expect.objectContaining({
			id: id(20),
			quantity: 5,
			physically_received_quantity: 3,
			lost_quantity: 2,
			waived_quantity: 1,
			exception_received_quantity: 1,
			outstanding_quantity: 0,
			effective_deadline: "2026-10-30",
		}),
	]);
	expect(equipment.handovers).toContainEqual(
		expect.objectContaining({
			id: id(30),
			actual_date: null,
			historical: true,
			notes: "Original issue note",
			effective_actual_date: null,
			effective_quantity: 5,
			effective_condition: "worn",
			effective_notes: "Corrected issue note",
			recorded_at: "2026-11-01T23:30:00Z",
			recorded_by: "Recorder owner",
		}),
	);
	expect(equipment.handovers).toContainEqual(
		expect.objectContaining({
			id: id(32),
			exception_id: id(40),
			kind: "receipt",
			actual_date: "2026-11-01",
			condition: "damaged",
			notes: "Recovered shirt",
		}),
	);
	expect(equipment.exceptions).toEqual(
		expect.arrayContaining([
			expect.objectContaining({
				kind: "lost",
				quantity: 2,
				received_quantity: 1,
				reason: "Lost at departure",
			}),
			expect.objectContaining({
				kind: "waived",
				quantity: 1,
				reason: "May keep one",
			}),
		]),
	);
	expect(equipment.corrections).toEqual([
		expect.objectContaining({
			reason: "Count corrected",
			recorded_by: "Recorder owner",
			before: expect.stringContaining('"quantity":4'),
			after: expect.stringContaining('"quantity":5'),
		}),
	]);
	expect(JSON.parse(files["_manifest.json"]).categories).toContain("equipment");
	expect(files["equipment/handovers.csv"]).toContain("Original issue note");
	const readme = files["README.txt"];
	for (const phrase of [
		"equipment.json",
		"unknown historical",
		"UTC",
		"physical receipt",
		"lost",
		"waived",
		"recovery",
		"retained",
	])
		expect(readme).toContain(phrase);
	const categories = await Promise.all(
		PERSONAL_DATA_COLLECTORS.map((c) =>
			c.collect(db, {
				organizationId: ORG,
				employeeId: id(1),
				userId: "t1548-ada",
				kind: "employee",
			}),
		),
	);
	expect(
		findUnexplainedFields(
			readmeContentsOf(categories, PERSONAL_DATA_COLLECTORS),
		),
	).toEqual([]);
	const all = Object.values(files).join("\n");
	for (const secret of [
		"Bob secret equipment",
		"Foreign secret equipment",
		"Foreign secret type",
		"owner@t1548.example.test",
	])
		expect(all).not.toContain(secret);
	expect(equipment.assignments).toHaveLength(1);
	harness.userId = "t1548-owner";
	const assisted = await build("admin");
	const { _metadata: _employeeMetadata, ...employeeRecords } = equipment;
	const { _metadata: _adminMetadata, ...adminRecords } = assisted.equipment;
	expect(adminRecords).toEqual(employeeRecords);
});

it("does not reconstruct erased holder exports from a later anonymous custody receipt", async () => {
	harness.userId = "t1548-owner";
	const equipmentActions = await import("@/lib/organization/equipment/actions");
	const setup = async (input: Record<string, unknown>) => {
		const r = await equipmentActions.changeEquipmentSetup({
			requestId: crypto.randomUUID(),
			...input,
		});
		if (!r.success || !r.data.ok) throw new Error(JSON.stringify(r));
		return r.data;
	};
	const change = async (input: Record<string, unknown>) => {
		const r = await equipmentActions.changeEquipment({
			requestId: crypto.randomUUID(),
			...input,
		});
		if (!r.success || !r.data.ok) throw new Error(JSON.stringify(r));
		return r.data;
	};
	await setup({
		kind: "configure_policy",
		retentionMonths: 1,
		expectedRevision: 0,
	});
	const type = await setup({
		kind: "create_type",
		name: "Erased laptop",
		trackingMode: "individual",
		defaultReturnRequired: false,
	});
	const item = await setup({
		kind: "register_item",
		typeId: type.id,
		identifier: "ERASED-IDENTITY",
	});
	await change({
		kind: "issue_individual",
		itemId: item.id,
		employeeId: id(1),
		expectedRevision: 1,
		actualDate: "2026-11-05",
		condition: "good",
		notes: "Erased holder private evidence",
		returnRequired: false,
	});
	retentionClock.now = "2026-12-07T00:00:00Z";
	const { runEquipmentRetentionJob } = await import(
		"@/lib/jobs/equipment-retention"
	);
	await runEquipmentRetentionJob();
	await change({
		kind: "propose_custody_receipt",
		itemId: item.id,
		expectedRevision: 2,
		actualDate: "2026-12-06",
		condition: "worn",
	});
	const overview = await equipmentActions.getEquipmentOverview();
	if (!overview.success) throw new Error(JSON.stringify(overview));
	const proposal = overview.data.readinessItems.find(
		(i) => i.id === item.id,
	)?.custodyReceipt;
	if (!proposal) throw new Error("No receipt proposal");
	await pool.query(
		"update member set role='admin' where organization_id=$1 and user_id='t1548-bob'",
		[ORG],
	);
	harness.userId = "t1548-bob";
	await change({
		kind: "confirm_custody_receipt",
		itemId: item.id,
		proposalId: proposal.id,
		expectedRevision: 3,
	});
	harness.userId = "t1548-ada";
	const own = await build("employee");
	harness.userId = "t1548-owner";
	const admin = await build("admin");
	for (const archive of [own, admin])
		for (const erased of [
			"ERASED-IDENTITY",
			"Erased holder private evidence",
			proposal.id,
		])
			expect(Object.values(archive.files).join("\n")).not.toContain(erased);
	expect(own.equipment.assignments).toEqual([]);
	expect(admin.equipment.assignments).toEqual([]);
});
