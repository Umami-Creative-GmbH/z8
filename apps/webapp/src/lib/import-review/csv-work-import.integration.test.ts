import type { Job } from "bullmq";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { integrationAdminPool } from "@/test/integration-database";

vi.mock("./queue", () => ({
	enqueueImportCommitJob: async () => {},
	enqueueImportScanJob: async () => {},
}));
vi.mock("@/lib/notifications/notification-service", async (importOriginal) =>
	(await import("@/test/integration-harness")).notificationTriggers(
		importOriginal,
		["createNotification"],
	),
);

const {
	createCsvWorkImport,
	getCsvWorkReview,
	decideCsvWorkRows,
	prepareCsvWorkCommit,
	mapCsvWorkValue,
	refreshCsvWorkImport,
} = await import("./csv-work-import");
const { processImportReviewJob } = await import("./worker");
const { withCompletedWorkTransaction } = await import(
	"@/lib/time-tracking/completed-work-transaction"
);
const { readWorkRecord } = await import("@/lib/time-tracking/work-records");
const ORG = "csv1133-org";
const ACTOR = "csv1133-admin";
const EMPLOYEE = "11330000-0000-4000-8000-000000000001";
const admin = integrationAdminPool();
const input = { organizationId: ORG, actorUserId: ACTOR };

async function cleanup() {
	await admin.query("delete from organization where id in ($1, $2)", [
		ORG,
		"csv1133-other",
	]);
	await admin.query('delete from "user" where id in ($1,$2)', [
		ACTOR,
		"csv1133-worker",
	]);
}
beforeEach(async () => {
	await cleanup();
	await admin.query(
		"insert into organization (id, name, slug, timezone, created_at) values ($1,$1,$1,'Europe/Berlin','2026-01-01')",
		[ORG],
	);
	for (const userId of [ACTOR, "csv1133-worker"]) {
		await admin.query(
			'insert into "user" (id,name,email,created_at,updated_at) values ($1,$1,$2,now(),now())',
			[userId, `${userId}@example.test`],
		);
		await admin.query(
			"insert into member (id,organization_id,user_id,role,status,created_at) values ($1,$2,$1,$3,'approved',now())",
			[userId, ORG, userId === ACTOR ? "owner" : "member"],
		);
	}
	await admin.query(
		"insert into employee (id,user_id,organization_id,role,employee_number,updated_at) values ($1,'csv1133-worker',$2,'employee','0042',now())",
		[EMPLOYEE, ORG],
	);
});
afterAll(cleanup);

async function runJob(
	data: Parameters<typeof processImportReviewJob>[0]["data"],
) {
	return processImportReviewJob({
		data,
		opts: { attempts: 1 },
		attemptsMade: 0,
	} as Job<typeof data>);
}
async function upload(csv: string, timezone?: string) {
	const created = await createCsvWorkImport({
		...input,
		csv,
		timezone,
		fileName: "work.csv",
	});
	await runJob(created.scanJob);
	return { ...input, batchId: created.batchId };
}
async function acceptAndCommit(batch: typeof input & { batchId: string }) {
	const view = await getCsvWorkReview(batch);
	await decideCsvWorkRows({
		...batch,
		rowIds: view.rows
			.filter(
				(row) =>
					row.issueSeverity !== "blocking" &&
					row.rowStatus !== "committed" &&
					row.rowStatus !== "rejected",
			)
			.map((row) => row.id),
		decision: "accepted",
	});
	const job = await prepareCsvWorkCommit(batch);
	await runJob(job);
	return getCsvWorkReview(batch);
}

describe("CSV work import through reviewed-import operations", () => {
	it("creates a canonical completed work record with truthful endpoint capture", async () => {
		const batch = await upload(
			"personnel_number,starts_at,ends_at\n0042,2026-07-22T08:00+02:00,2026-07-22T10:00-04:00\n",
			"Europe/Berlin",
		);
		const view = await acceptAndCommit(batch);
		expect(view.summary.imported).toBe(1);
		const workPeriodId = view.rows[0]?.commitTargetId;
		if (!workPeriodId) throw new Error("Expected an imported work period");
		const work = await withCompletedWorkTransaction(
			{ ...input, employeeId: EMPLOYEE },
			(scope) =>
				readWorkRecord(scope, {
					organizationId: ORG,
					employeeId: EMPLOYEE,
					workPeriodId,
				}),
		);
		expect(work?.clockIn).toMatchObject({
			utcOffsetMinutes: 120,
			timezone: "+02:00",
			timezoneSource: "csv_import",
		});
		expect(work?.clockOut).toMatchObject({
			utcOffsetMinutes: -240,
			timezone: "-04:00",
			timezoneSource: "csv_import",
		});
		expect(work?.period.durationMinutes).toBe(480);
		expect(work?.canonical?.record.id).toBeTruthy();
	});
});

it("resolves unknown personnel numbers and plates explicitly and records vehicle attribution in both work records", async () => {
	const vehicleId = "11330000-0000-4000-8000-000000000011";
	await admin.query(
		"insert into organization_vehicle (id,organization_id,name,licence_plate) values ($1,$2,'Van','M-AB 1234')",
		[vehicleId, ORG],
	);
	await admin.query(
		"insert into vehicle_use_setting (organization_id,enabled) values ($1,true)",
		[ORG],
	);
	await admin.query(
		"insert into vehicle_use_assignment (organization_id,assignment_type,mode,created_by) values ($1,'organization','asked',$2)",
		[ORG, ACTOR],
	);
	const batch = await upload(
		"personnel_number,starts_at,ends_at,vehicle_kind,licence_plate,odometer_start_km,odometer_end_km\nexternal-7,2026-07-22T08:00Z,2026-07-22T09:00Z,organization,UNKNOWN,100,145\n",
	);
	expect((await getCsvWorkReview(batch)).rows[0]?.issueSeverity).toBe(
		"blocking",
	);
	await mapCsvWorkValue({
		...batch,
		kind: "employee",
		sourceValue: "external-7",
		targetId: EMPLOYEE,
	});
	await mapCsvWorkValue({
		...batch,
		kind: "vehicle",
		sourceValue: "UNKNOWN",
		targetId: vehicleId,
	});
	const mapped = await getCsvWorkReview(batch);
	expect(mapped.rows[0]?.sourcePayload).toMatchObject({
		values: { personnel_number: "external-7", licence_plate: "UNKNOWN" },
	});
	const view = await acceptAndCommit(batch);
	expect(view.summary.imported).toBe(1);
	const workPeriodId = view.rows[0]?.commitTargetId;
	if (!workPeriodId) throw new Error("Expected imported vehicle use");
	const work = await withCompletedWorkTransaction(
		{ ...input, employeeId: EMPLOYEE },
		(scope) =>
			readWorkRecord(scope, {
				organizationId: ORG,
				employeeId: EMPLOYEE,
				workPeriodId,
			}),
	);
	expect(work?.period).toMatchObject({
		vehicleId,
		odometerStartKm: 100,
		odometerEndKm: 145,
		drivenDistanceKm: 45,
	});
	expect(work?.canonical?.detail).toMatchObject({
		vehicleId,
		odometerStartKm: 100,
		odometerEndKm: 145,
		drivenDistanceKm: 45,
	});
});

it("skips duplicate rows within a file and across re-uploads without recreating work", async () => {
	const header = "personnel_number,starts_at,ends_at\n";
	const first = await upload(
		header +
			"0042,2026-07-22T08:00Z,2026-07-22T09:00Z\n0042,2026-07-22T08:00Z,2026-07-22T09:00Z\n0042,2026-07-23T08:00Z,2026-07-23T09:00Z\n",
	);
	const initial = await acceptAndCommit(first);
	expect(initial.summary).toMatchObject({
		imported: 2,
		skipped: 1,
		unresolved: 0,
	});
	const second = await upload(
		header +
			"0042,2026-07-23T10:00+02:00,2026-07-23T11:00+02:00\n0042,2026-07-22T08:00Z,2026-07-22T09:00Z\n",
	);
	const repeated = await acceptAndCommit(second);
	expect(repeated.summary).toMatchObject({
		imported: 0,
		skipped: 2,
		unresolved: 0,
	});
	expect(
		repeated.rows
			.map((row) => row.commitTargetId)
			.every((id) => initial.rows.some((row) => row.commitTargetId === id)),
	).toBe(true);
});

it("commits valid accepted rows while a newly conflicting row stays reviewable", async () => {
	const header = "personnel_number,starts_at,ends_at\n";
	const pending = await upload(
		header +
			"0042,2026-07-22T08:00Z,2026-07-22T09:00Z\n0042,2026-07-23T08:00Z,2026-07-23T09:00Z\n",
	);
	const before = await getCsvWorkReview(pending);
	await decideCsvWorkRows({
		...pending,
		rowIds: before.rows.map((row) => row.id),
		decision: "accepted",
	});
	const competitor = await upload(
		header + "0042,2026-07-22T08:30Z,2026-07-22T09:30Z\n",
	);
	await acceptAndCommit(competitor);
	const job = await prepareCsvWorkCommit(pending);
	await runJob(job);
	const after = await getCsvWorkReview(pending);
	expect(after.summary).toMatchObject({ imported: 1, unresolved: 1 });
	expect(after.batch.status).toBe("needs_review");
	expect(after.rows.find((row) => row.rowStatus === "blocked")).toMatchObject({
		commitTargetId: null,
		commitHold: { reason: "occupancy_conflict" },
	});
	expect(after.issues).toEqual(
		expect.arrayContaining([
			expect.objectContaining({
				stagedRowId: after.rows.find((row) => row.rowStatus === "blocked")?.id,
				severity: "blocking",
			}),
		]),
	);
});

it.each(["inactive", "active"])(
	"serializes concurrent identical batches and safely replays a finished job (%s)",
	async (mode) => {
		await admin.query(
			"insert into time_entry_append_control (organization_id,mode) values ($1,$2)",
			[ORG, mode],
		);
		const csv =
			"personnel_number,starts_at,ends_at\n0042,2026-07-22T08:00Z,2026-07-22T09:00Z\n";
		const batches = await Promise.all([upload(csv), upload(csv)]);
		const jobs = [];
		for (const batch of batches) {
			const view = await getCsvWorkReview(batch);
			await decideCsvWorkRows({
				...batch,
				rowIds: view.rows.map((row) => row.id),
				decision: "accepted",
			});
			jobs.push(await prepareCsvWorkCommit(batch));
		}
		await Promise.all(jobs.map(runJob));
		const views = await Promise.all(batches.map(getCsvWorkReview));
		expect(views.map((view) => view.summary.imported).sort()).toEqual([0, 1]);
		expect(views.map((view) => view.summary.skipped).sort()).toEqual([0, 1]);
		expect(views[0].rows[0]?.commitTargetId).toBe(
			views[1].rows[0]?.commitTargetId,
		);
		await runJob(jobs[0]);
		expect((await getCsvWorkReview(batches[0])).summary).toEqual(
			views[0].summary,
		);
	},
);

it.each(["archived", "off", "closed"])(
	"rechecks %s eligibility after acceptance and holds the row without creating work",
	async (change) => {
		const vehicleId = "11330000-0000-4000-8000-000000000011";
		await admin.query(
			"insert into organization_vehicle (id,organization_id,name,licence_plate) values ($1,$2,'Van','M-AB 1234')",
			[vehicleId, ORG],
		);
		await admin.query(
			"insert into vehicle_use_setting (organization_id,enabled) values ($1,true)",
			[ORG],
		);
		await admin.query(
			"insert into vehicle_use_assignment (organization_id,assignment_type,mode,created_by) values ($1,'organization','asked',$2)",
			[ORG, ACTOR],
		);
		const batch = await upload(
			"personnel_number,starts_at,ends_at,vehicle_kind,licence_plate,distance_km\n0042,2026-07-22T08:00Z,2026-07-22T09:00Z,organization,M-AB 1234,20\n",
		);
		const before = await getCsvWorkReview(batch);
		await decideCsvWorkRows({
			...batch,
			rowIds: before.rows.map((row) => row.id),
			decision: "accepted",
		});
		if (change === "archived")
			await admin.query(
				"update organization_vehicle set archived_at = now() where id = $1",
				[vehicleId],
			);
		if (change === "off")
			await admin.query(
				"update vehicle_use_setting set enabled = false where organization_id = $1",
				[ORG],
			);
		if (change === "closed")
			await admin.query(
				"with closed as (insert into closed_month (organization_id,month,scope,actor_kind,closed_by) values ($1,'2026-07-01','organization','user',$3) returning id) insert into closed_month_employee (organization_id,closed_month_id,employee_id,month,range_start,range_end,timezone) select $1,id,$2,'2026-07-01','2026-06-30T22:00:00','2026-07-31T22:00:00','Europe/Berlin' from closed",
				[ORG, EMPLOYEE, ACTOR],
			);
		await runJob(await prepareCsvWorkCommit(batch));
		const view = await getCsvWorkReview(batch);
		expect(view.summary).toMatchObject({ imported: 0, unresolved: 1 });
		expect(view.rows[0]).toMatchObject({
			rowStatus: "blocked",
			commitTargetId: null,
			issueSeverity: "blocking",
		});
		expect(view.batch.status).toBe("needs_review");
	},
);

it("enforces admin and organization boundaries for review and mapping", async () => {
	const batch = await upload(
		"personnel_number,starts_at,ends_at\n0042,2026-07-22T08:00Z,2026-07-22T09:00Z\n",
	);
	await expect(
		getCsvWorkReview({ ...batch, actorUserId: "csv1133-worker" }),
	).rejects.toThrow(/admins/);
	await admin.query(
		"insert into organization (id,name,slug,created_at) values ('csv1133-other','Other','csv1133-other',now())",
	);
	await admin.query(
		"insert into member (id,organization_id,user_id,role,status,created_at) values ('csv1133-other-admin','csv1133-other',$1,'owner','approved',now())",
		[ACTOR],
	);
	await expect(
		getCsvWorkReview({ ...batch, organizationId: "csv1133-other" }),
	).rejects.toThrow(/not found/);
	await expect(
		mapCsvWorkValue({
			...batch,
			organizationId: "csv1133-other",
			kind: "employee",
			sourceValue: "0042",
			targetId: EMPLOYEE,
		}),
	).rejects.toThrow(/not found/);
	expect((await getCsvWorkReview(batch)).summary.imported).toBe(0);
});

it("recovers after a partial database failure without replaying committed work", async () => {
	const batch = await upload(
		"personnel_number,starts_at,ends_at\n0042,2026-07-22T08:00Z,2026-07-22T09:00Z\n0042,2026-07-23T08:00Z,2026-07-23T09:00Z\n",
	);
	const before = await getCsvWorkReview(batch);
	await decideCsvWorkRows({
		...batch,
		rowIds: before.rows.map((row) => row.id),
		decision: "accepted",
	});
	await admin.query(
		"alter table import_staged_row add constraint csv1133_simulated_failure check (organization_id <> 'csv1133-org' or row_status <> 'committed' or (source_payload->>'rowNumber')::int <> 3)",
	);
	try {
		await expect(runJob(await prepareCsvWorkCommit(batch))).rejects.toThrow(
			/commit failed/,
		);
	} finally {
		await admin.query(
			"alter table import_staged_row drop constraint csv1133_simulated_failure",
		);
	}
	expect((await getCsvWorkReview(batch)).summary).toMatchObject({
		imported: 1,
		unresolved: 1,
	});
	await refreshCsvWorkImport(batch);
	const recovered = await acceptAndCommit(batch);
	expect(recovered.summary).toMatchObject({
		imported: 2,
		skipped: 0,
		unresolved: 0,
	});
	expect(recovered.batch.status).toBe("completed");
});

it("detects overlaps inside an upload and permits rechecking after rejecting the conflicting row", async () => {
	const batch = await upload(
		"personnel_number,starts_at,ends_at\n0042,2026-07-22T08:00Z,2026-07-22T09:00Z\n0042,2026-07-22T08:30Z,2026-07-22T09:30Z\n",
	);
	const before = await getCsvWorkReview(batch);
	expect(before.rows[1]?.issueSeverity).toBe("blocking");
	await decideCsvWorkRows({
		...batch,
		rowIds: [before.rows[0].id],
		decision: "rejected",
	});
	await refreshCsvWorkImport(batch);
	const after = await acceptAndCommit(batch);
	expect(after.summary).toMatchObject({
		imported: 1,
		rejected: 1,
		unresolved: 0,
	});
});

it("exposes an unknown plate as a durable review issue and clears it after explicit mapping", async () => {
	const vehicleId = "11330000-0000-4000-8000-000000000011";
	await admin.query(
		"insert into organization_vehicle (id,organization_id,name,licence_plate) values ($1,$2,'Van','M-AB 1234')",
		[vehicleId, ORG],
	);
	await admin.query(
		"insert into vehicle_use_setting (organization_id,enabled) values ($1,true)",
		[ORG],
	);
	await admin.query(
		"insert into vehicle_use_assignment (organization_id,assignment_type,mode,created_by) values ($1,'organization','asked',$2)",
		[ORG, ACTOR],
	);
	const batch = await upload(
		"personnel_number,starts_at,ends_at,vehicle_kind,licence_plate,distance_km\n0042,2026-07-22T08:00Z,2026-07-22T09:00Z,organization,UNKNOWN,20\n",
	);
	const before = await getCsvWorkReview(batch);
	expect(before.issues).toEqual([
		expect.objectContaining({
			stagedRowId: before.rows[0].id,
			issueType: "unmatched_vehicle",
			severity: "blocking",
		}),
	]);
	await mapCsvWorkValue({
		...batch,
		kind: "vehicle",
		sourceValue: "UNKNOWN",
		targetId: vehicleId,
	});
	expect((await getCsvWorkReview(batch)).issues).toEqual([]);
});

it("holds future completed work using the shared imported-work eligibility rules", async () => {
	const batch = await upload(
		"personnel_number,starts_at,ends_at\n0042,2099-07-22T08:00Z,2099-07-22T09:00Z\n",
	);
	const view = await getCsvWorkReview(batch);
	expect(view.rows[0]).toMatchObject({
		issueSeverity: "blocking",
		commitTargetId: null,
	});
	expect(view.summary.imported).toBe(0);
});

it("rechecks an importer's admin role before a queued commit writes work", async () => {
	const batch = await upload(
		"personnel_number,starts_at,ends_at\n0042,2026-07-22T08:00Z,2026-07-22T09:00Z\n",
	);
	const before = await getCsvWorkReview(batch);
	await decideCsvWorkRows({
		...batch,
		rowIds: before.rows.map((row) => row.id),
		decision: "accepted",
	});
	const job = await prepareCsvWorkCommit(batch);
	await admin.query(
		"update member set role = 'owner' where organization_id = $1 and user_id = 'csv1133-worker'",
		[ORG],
	);
	await admin.query(
		"update member set role = 'member' where organization_id = $1 and user_id = $2",
		[ORG, ACTOR],
	);
	await expect(runJob(job)).rejects.toThrow(/commit failed/);
	await admin.query(
		"update member set role = 'owner' where organization_id = $1 and user_id = $2",
		[ORG, ACTOR],
	);
	expect((await getCsvWorkReview(batch)).summary).toMatchObject({
		imported: 0,
		unresolved: 1,
	});
});

it("imports distinct UTC work when identical local values use different explicit upload zones", async () => {
	const csv =
		"personnel_number,starts_at,ends_at\n0042,2026-07-22T08:00,2026-07-22T09:00\n";
	const berlin = await acceptAndCommit(await upload(csv, "Europe/Berlin"));
	const newYork = await acceptAndCommit(await upload(csv, "America/New_York"));
	expect(berlin.summary.imported).toBe(1);
	expect(newYork.summary).toMatchObject({
		imported: 1,
		unresolved: 0,
		skipped: 0,
	});
	expect(
		(
			await admin.query(
				"select start_time from work_period where organization_id=$1 order by start_time",
				[ORG],
			)
		).rows.map((row) => row.start_time.toISOString()),
	).toEqual(["2026-07-22T06:00:00.000Z", "2026-07-22T12:00:00.000Z"]);
});
