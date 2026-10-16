import { inflateSync } from "node:zlib";
import JSZip from "jszip";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
	createLifecycleDatabaseFixture,
	type LifecycleDatabaseFixture,
	type SeededEmployee,
} from "@/lib/employee-lifecycle/testing/database.test.fixture";

const harness = vi.hoisted(() => ({
	userId: "",
	organizationId: "",
	now: "2026-01-31T11:00:00Z",
	authReads: 0,
	onDownloadAuth: null as (() => Promise<void>) | null,
}));
vi.mock("next/headers", async () =>
	(await import("@/test/integration-harness")).nextHeaders(),
);
vi.mock("next/cache", async (original) =>
	(await import("@/test/integration-harness")).nextCache(original),
);
vi.mock("@/lib/auth-helpers", () => ({
	getAuthContext: async () => {
		harness.authReads++;
		if (harness.authReads === 2 && harness.onDownloadAuth)
			await harness.onDownloadAuth();
		return harness.userId
			? {
					user: { id: harness.userId },
					session: { activeOrganizationId: harness.organizationId },
				}
			: null;
	},
}));
vi.mock("@/lib/datetime/temporal-core", async (original) => {
	const actual =
		await original<typeof import("@/lib/datetime/temporal-core")>();
	return {
		...actual,
		systemClock: Object.freeze({
			nowInstant: () => actual.parseInstant(harness.now),
		}),
	};
});
vi.mock("next/server", async (original) =>
	(await import("@/test/integration-harness")).nextServer(original),
);
vi.mock("@/lib/email/email-service", async (original) =>
	(await import("@/test/integration-harness")).emailService(original),
);
vi.mock("@/lib/queue", async (original) => ({
	...(await original<typeof import("@/lib/queue")>()),
	addJob: async () => ({ id: "test" }),
}));
vi.mock("@/lib/storage/export-s3-client", () => ({
	isExportS3Configured: async () => true,
	uploadPrivateObjectStream: async () => ({ bucket: "test", versionId: null }),
	deletePrivateObject: async () => {},
	deletePrivateObjectVersions: async () => {},
}));
const impediments = await import("./impediment-actions");
const checks = await import("./check-actions");
const policy = await import("./policy-actions");
const grants = await import("./verifier-actions");
const history = await import("./history-actions");
const { GET } = await import("@/app/api/driving-licence/evidence/route");

let fixture: LifecycleDatabaseFixture;
let verifier: SeededEmployee;
let checkId: string;
function pdfText(bytes: Uint8Array) {
	const raw = Buffer.from(bytes).toString("latin1");
	let result = "";
	for (const match of raw.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)) {
		let stream: string;
		try {
			stream = inflateSync(Buffer.from(match[1], "latin1")).toString("latin1");
		} catch {
			continue;
		}
		for (const value of stream.matchAll(/<([a-fA-F0-9]+)>/g))
			result += Buffer.from(value[1], "hex").toString("latin1");
		result += "\n";
	}
	return result;
}
const url = (employeeId: string, period = "") =>
	new Request(
		`https://app.test/api/driving-licence/evidence?employeeId=${employeeId}${period}`,
	);
beforeEach(async () => {
	fixture = await createLifecycleDatabaseFixture();
	verifier = await fixture.seedEmployee();
	harness.authReads = 0;
	harness.onDownloadAuth = null;
	harness.organizationId = fixture.organizationId;
	harness.now = "2026-01-31T11:00:00Z";
	harness.userId = fixture.ownerUserId;
	expect(
		(
			await policy.saveDrivingLicencePolicyAction({
				enabled: true,
				intervalMonths: 1,
				timezone: "Europe/Berlin",
				reminderLeadDays: [30, 7],
				retentionMonths: 36,
				retentionJustification:
					"Necessary evidence for organization driving checks",
			})
		).success,
	).toBe(true);
	expect(
		(
			await policy.enrollDrivingLicenceEmployeeAction({
				employeeId: fixture.employeeId,
			})
		).success,
	).toBe(true);
	expect(
		(
			await grants.saveDrivingLicenceVerifierGrantAction({
				verifierEmployeeId: verifier.employeeId,
				scope: "all",
				teamIds: [],
				employeeIds: [],
			})
		).success,
	).toBe(true);
	harness.userId = verifier.userId;
	const check = await checks.completeDrivingLicenceCheckAction({
		employeeId: fixture.employeeId,
		commandId: crypto.randomUUID(),
		originalInspected: true,
		identityConfirmed: true,
		employeeDeclaration: true,
		verifierConfirmed: true,
		documentIssuedOn: "2020-05-01",
		documentExpiresOn: "2035-05-01",
		classes: [
			{ code: "B", result: "successful", expiryDate: null, restrictions: "" },
		],
	});
	if (!check.success) throw new Error(check.error);
	checkId = check.data.checkId;
});
afterEach(async () => {
	await fixture?.close();
	if (fixture)
		await fixture.pool.query(
			"delete from personal_data_export_file_cleanup where organization_id=$1",
			[fixture.organizationId],
		);
});
it("downloads a private readable PDF of the selected employee evidence", async () => {
	const response = await GET(
		new Request(
			`https://app.test/api/driving-licence/evidence?employeeId=${fixture.employeeId}&from=2026-01-01T00:00:00Z&to=2026-02-01T00:00:00Z`,
		),
	);
	expect(response.status).toBe(200);
	expect(response.headers.get("Content-Type")).toBe("application/pdf");
	expect(response.headers.get("Cache-Control")).toBe(
		"private, no-store, max-age=0",
	);
	expect(response.headers.get("Content-Disposition")).toContain("attachment;");
	const bytes = new Uint8Array(await response.arrayBuffer());
	expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");
	const text = pdfText(bytes);
	expect(text).toContain("Driving licence inspection evidence");
	expect(text).toContain("Original personally inspected: Confirmed");
	expect(text).toContain(
		"I confirm that no known driving ban, withdrawal or other impediment",
	);
	expect(text).toContain("Class B: successful");
	expect(text).toContain(checkId);
	expect(text).not.toContain(verifier.userId);
});

it("allows employee evidence but denies foreign identifiers, revoked verifier scope and departed self access", async () => {
	harness.userId = (
		await fixture.pool.query<{ user_id: string }>(
			"select user_id from employee where id=$1",
			[fixture.employeeId],
		)
	).rows[0].user_id;
	expect((await GET(url(fixture.employeeId))).status).toBe(200);
	const foreignOrganization = await fixture.createOrganization();
	const foreign = await fixture.seedEmployee({
		organizationId: foreignOrganization,
	});
	expect((await GET(url(foreign.employeeId))).status).toBe(404);
	await fixture.pool.query("update employee set is_active=false where id=$1", [
		fixture.employeeId,
	]);
	expect((await GET(url(fixture.employeeId))).status).toBe(404);
	await fixture.pool.query("update employee set is_active=true where id=$1", [
		fixture.employeeId,
	]);
	harness.userId = fixture.ownerUserId;
	expect((await GET(url(fixture.employeeId))).status).toBe(404);
	const adminData = await grants.getDrivingLicenceVerifierAdminDataAction();
	if (!adminData.success) throw new Error(adminData.error);
	expect(
		(
			await grants.revokeDrivingLicenceVerifierGrantAction({
				grantId: adminData.data.grants[0].id,
			})
		).success,
	).toBe(true);
	harness.userId = verifier.userId;
	expect((await GET(url(fixture.employeeId))).status).toBe(404);
});

it("includes retained driving evidence in the real employee and former-employee admin personal export archives", async () => {
	const { db } = await import("@/db");
	const { processPersonalDataExport } = await import(
		"@/lib/personal-data-export/processor"
	);
	const { parseInstant } = await import("@/lib/datetime/temporal-core");
	const subjectUser = (
		await fixture.pool.query<{ user_id: string }>(
			"select user_id from employee where id=$1",
			[fixture.employeeId],
		)
	).rows[0].user_id;
	expect(
		(
			await history.supplementDrivingLicenceCheckAction({
				employeeId: fixture.employeeId,
				checkId,
				commandId: crypto.randomUUID(),
				reason: "recording_error",
				correction: { field: "documentIssuedOn", value: "2020-05-02" },
			})
		).success,
	).toBe(true);
	harness.userId = subjectUser;
	const report = await impediments.reportDrivingImpedimentAction({
		commandId: crypto.randomUUID(),
	});
	if (!report.success) throw new Error(report.error);
	harness.userId = verifier.userId;
	const { drivingLicenceCheck } = await import(
		"@/db/schema/driving-licence-checks"
	);
	const { eq } = await import("drizzle-orm");
	const [seedCheck] = await fixture.db
		.select()
		.from(drivingLicenceCheck)
		.where(eq(drivingLicenceCheck.id, checkId));
	const unrelated = await fixture.seedEmployee();
	const unrelatedCheckId = crypto.randomUUID();
	await fixture.db.insert(drivingLicenceCheck).values({
		...seedCheck,
		id: unrelatedCheckId,
		commandId: crypto.randomUUID(),
		employeeId: unrelated.employeeId,
		employmentPeriodId: unrelated.employmentPeriodId,
		employeeName: "Unrelated archive secret",
	});
	const foreignOrg = await fixture.createOrganization();
	const foreign = await fixture.seedEmployee({ organizationId: foreignOrg });
	const foreignVerifier = await fixture.seedEmployee({
		organizationId: foreignOrg,
	});
	const foreignCheckId = crypto.randomUUID();
	await fixture.db.insert(drivingLicenceCheck).values({
		...seedCheck,
		id: foreignCheckId,
		commandId: crypto.randomUUID(),
		organizationId: foreignOrg,
		employeeId: foreign.employeeId,
		employmentPeriodId: foreign.employmentPeriodId,
		verifierEmployeeId: foreignVerifier.employeeId,
		verifierUserId: foreignVerifier.userId,
		employeeName: "Foreign archive secret",
	});
	await fixture.pool.query(
		"insert into driving_licence_task (organization_id,employee_id,employment_period_id,occasion_key,kind,state,created_at,completed_at,completed_by) values ($1,$2,$3,'export-fixture','personal_reminder','completed',$4,$4,$5)",
		[
			fixture.organizationId,
			fixture.employeeId,
			fixture.employmentPeriodId,
			harness.now,
			verifier.userId,
		],
	);
	await fixture.pool.query(
		"insert into driving_licence_reminder_delivery (organization_id,employee_id,employment_period_id,occasion_key,recipient_user_id,email_state,created_at) values ($1,$2,$3,'export-fixture',$4,'unavailable',$5)",
		[
			fixture.organizationId,
			fixture.employeeId,
			fixture.employmentPeriodId,
			verifier.userId,
			harness.now,
		],
	);
	for (const kind of ["employee", "admin"] as const) {
		if (kind === "admin")
			await fixture.pool.query(
				"update employee set is_active=false where id=$1",
				[fixture.employeeId],
			);
		const row = await fixture.pool.query<{ id: string }>(
			"insert into personal_data_export (organization_id,employee_id,kind,requested_by_user_id,status,expires_at) values ($1,$2,$3,$4,'pending','2026-02-07T00:00:00Z') returning id",
			[
				fixture.organizationId,
				fixture.employeeId,
				kind,
				kind === "admin" ? fixture.ownerUserId : subjectUser,
			],
		);
		let bytes = new Uint8Array();
		const result = await processPersonalDataExport(
			db,
			{ organizationId: fixture.organizationId, exportId: row.rows[0].id },
			{
				now: () => parseInstant(harness.now),
				upload: async (_org, _key, body) => {
					bytes = new Uint8Array(await new Response(body).arrayBuffer());
					return { bucket: "test", versionId: null };
				},
				notify: async () => {},
			},
		);
		expect(result).toEqual({ status: "completed" });
		const zip = await JSZip.loadAsync(bytes);
		const text = await zip.file("driving_licence.json")?.async("string");
		expect(text).toBeDefined();
		expect(text).toContain(checkId);
		expect(text).toContain("2020-05-02");
		const data = JSON.parse(text ?? "{}");
		expect(data.impediment_reports).toEqual([
			expect.objectContaining({
				id: report.data.reportId,
				scope: "person",
				resolved_at: null,
			}),
		]);
		expect(data.reminder_tasks).toEqual([
			expect.objectContaining({
				kind: "personal_reminder",
				state: "completed",
				completed_by: "Lifecycle",
			}),
		]);
		expect(data.reminder_deliveries).toEqual([
			expect.objectContaining({
				email_state: "unavailable",
				recipient_name: "Lifecycle",
			}),
		]);
		expect(text).toContain("I confirm that no known driving ban");
		expect(text).not.toContain(unrelatedCheckId);
		expect(text).not.toContain(foreignCheckId);
		expect(text).not.toContain("Unrelated archive secret");
		expect(text).not.toContain("Foreign archive secret");
		expect(text).not.toContain("commandId");
		expect(text).not.toContain(verifier.userId);
		const readme = await zip.file("README.txt")?.async("string");
		expect(readme).toContain("Driving licence");
		expect(readme).toContain(
			"Driving licence verifiers (your check evidence and PDF exports):\n  - Lifecycle",
		);
	}
});

it("checks current scope again after rendering before returning any download bytes", async () => {
	harness.authReads = 0;
	harness.onDownloadAuth = async () => {
		await fixture.pool.query(
			"update driving_licence_verifier_grant set revoked_at='2026-01-31T11:00:01Z', revoked_by=$1 where organization_id=$2 and verifier_employee_id=$3",
			[fixture.ownerUserId, fixture.organizationId, verifier.employeeId],
		);
	};
	const response = await GET(url(fixture.employeeId));
	expect(response.status).toBe(404);
	expect(response.headers.get("Cache-Control")).toBe(
		"private, no-store, max-age=0",
	);
	expect(await response.text()).not.toContain("I confirm that no known");
	harness.onDownloadAuth = null;
});
it("includes period corrections, report resolution and explicit reinstatement with earlier context, excluding later and unrelated evidence", async () => {
	const subject = (
		await fixture.pool.query<{ user_id: string }>(
			"select user_id from employee where id=$1",
			[fixture.employeeId],
		)
	).rows[0];
	harness.userId = subject.user_id;
	harness.now = "2026-02-02T10:00:00Z";
	expect(
		(
			await impediments.reportDrivingImpedimentAction({
				commandId: crypto.randomUUID(),
			})
		).success,
	).toBe(true);
	harness.userId = verifier.userId;
	harness.now = "2026-02-03T10:00:00Z";
	const fresh = await checks.completeDrivingLicenceCheckAction({
		employeeId: fixture.employeeId,
		commandId: crypto.randomUUID(),
		originalInspected: true,
		identityConfirmed: true,
		employeeDeclaration: true,
		verifierConfirmed: true,
		documentIssuedOn: "2020-05-01",
		documentExpiresOn: "2035-05-01",
		classes: [
			{ code: "B", result: "successful", expiryDate: null, restrictions: "01" },
		],
	});
	if (!fresh.success) throw new Error(fresh.error);
	harness.now = "2026-02-04T10:00:00Z";
	const state = await impediments.getDrivingImpedimentStateAction({
		employeeId: fixture.employeeId,
	});
	if (!state.success) throw new Error(state.error);
	expect(
		(
			await impediments.reinstateDrivingAuthorizationAction({
				employeeId: fixture.employeeId,
				checkId: fresh.data.checkId,
				classCodes: ["B"],
				expectedReportIds: state.data.reports.map((r) => r.id),
				expectedSuspension: state.data.suspension,
				impedimentResolved: true,
			})
		).success,
	).toBe(true);
	harness.now = "2026-02-05T10:00:00Z";
	expect(
		(
			await history.supplementDrivingLicenceCheckAction({
				employeeId: fixture.employeeId,
				checkId: fresh.data.checkId,
				commandId: crypto.randomUUID(),
				reason: "recording_error",
				correction: { field: "documentIssuedOn", value: "2020-05-02" },
			})
		).success,
	).toBe(true);
	harness.now = "2026-03-01T10:00:00Z";
	expect(
		(
			await history.supplementDrivingLicenceCheckAction({
				employeeId: fixture.employeeId,
				checkId: fresh.data.checkId,
				commandId: crypto.randomUUID(),
				reason: "recording_error",
				correction: { field: "documentIssuedOn", value: "2019-09-09" },
			})
		).success,
	).toBe(true);
	const other = await fixture.seedEmployee();
	harness.userId = fixture.ownerUserId;
	expect(
		(
			await policy.enrollDrivingLicenceEmployeeAction({
				employeeId: other.employeeId,
			})
		).success,
	).toBe(true);
	harness.userId = verifier.userId;
	await fixture.pool.query('update "user" set name=$1 where id=$2', [
		"Unrelated Secret Person",
		other.userId,
	]);
	expect(
		(
			await checks.completeDrivingLicenceCheckAction({
				employeeId: other.employeeId,
				commandId: crypto.randomUUID(),
				originalInspected: true,
				identityConfirmed: true,
				employeeDeclaration: true,
				verifierConfirmed: true,
				documentIssuedOn: "2018-08-08",
				documentExpiresOn: "2035-05-01",
				classes: [
					{
						code: "C",
						result: "successful",
						expiryDate: null,
						restrictions: "",
					},
				],
			})
		).success,
	).toBe(true);
	const response = await GET(
		url(
			fixture.employeeId,
			"&from=2026-02-04T00:00:00Z&to=2026-02-06T00:00:00Z",
		),
	);
	expect(response.status).toBe(200);
	const bytes = new Uint8Array(await response.arrayBuffer());
	const text = pdfText(bytes);
	expect(text).toContain("Earlier context supporting the selected period");
	expect(text).toContain("impediment_reported");
	expect(text).toContain("impediment_resolved");
	expect(text).toContain("reinstated");
	expect(text).toContain("documentIssuedOn: 2020-05-02");
	expect(text).toContain("Document issued: 2020-05-01");
	expect(text).not.toContain("2019-09-09");
	expect(text).not.toContain("Unrelated Secret Person");
	expect(text).not.toContain("2018-08-08");
	expect(
		(
			await GET(
				url(
					fixture.employeeId,
					"&from=2026-03-01T00:00:00Z&to=2026-02-01T00:00:00Z",
				),
			)
		).status,
	).toBe(404);
});

it("normalizes explicit offset period boundaries to UTC in the evidence header", async () => {
	const response = await GET(
		url(
			fixture.employeeId,
			"&from=2026-01-01T00:00:00%2B02:00&to=2026-02-01T00:00:00%2B02:00",
		),
	);
	expect(response.status).toBe(200);
	const text = pdfText(new Uint8Array(await response.arrayBuffer()));
	expect(text).toContain("From (inclusive): 2025-12-31T22:00:00Z");
	expect(text).toContain("Before (exclusive): 2026-01-31T22:00:00Z");
});
