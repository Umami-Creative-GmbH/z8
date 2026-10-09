/**
 * #835: the org data export carries position stamps only for a user who may
 * view everyone's stamps, decided when the export is processed, and writes one
 * access-log entry naming the export and the employees whose stamps it holds.
 * Scheduled data exports decide with the schedule owner and every address the
 * file's link is mailed to, and log each of those viewers. Only the export
 * storage is mocked; the archive is read back from the uploaded bytes.
 */

import JSZip from "jszip";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { integrationAdminPool } from "@/test/integration-database";

const storage = vi.hoisted(() => ({ uploads: new Map<string, Buffer>() }));

vi.mock("@/lib/storage/export-s3-client", () => ({
	deleteExport: async () => undefined,
	generateExportKey: (_organizationId: string, exportId: string) => `exports/${exportId}.zip`,
	getPresignedUrl: async (_organizationId: string, key: string) => `https://storage.test/${key}`,
	isExportS3Configured: async () => true,
	uploadExport: async (_organizationId: string, key: string, body: Buffer) => {
		storage.uploads.set(key, body);
	},
}));

const { processExport } = await import("@/lib/export/export-service");
const { DataExportExecutor } = await import(
	"@/lib/scheduled-exports/application/executors/data-export-executor"
);
const { listPositionStampAccessLog } = await import("./access-log");

const ids = {
	organization: "t835-position-org",
	otherOrganization: "t835-other-org",
	ownerUser: "t835-owner-user",
	holderUser: "t835-holder-user",
	managerUser: "t835-manager-user",
	fieldUser: "t835-field-user",
	officeUser: "t835-office-user",
	foreignUser: "t835-foreign-user",
	owner: "d8350000-0000-4000-8000-000000000001",
	holder: "d8350000-0000-4000-8000-000000000002",
	manager: "d8350000-0000-4000-8000-000000000003",
	field: "d8350000-0000-4000-8000-000000000004",
	office: "d8350000-0000-4000-8000-000000000005",
	foreign: "d8350000-0000-4000-8000-000000000006",
	viewerRole: "d8350000-0000-4000-8000-0000000000c1",
	notice: "d8350000-0000-4000-8000-0000000000a1",
	consent: "d8350000-0000-4000-8000-0000000000b1",
	foreignNotice: "d8350000-0000-4000-8000-0000000000a2",
	foreignConsent: "d8350000-0000-4000-8000-0000000000b2",
	fieldClockIn: "d8350000-0000-4000-8000-0000000000e1",
	fieldClockOut: "d8350000-0000-4000-8000-0000000000e2",
	officeClockIn: "d8350000-0000-4000-8000-0000000000e3",
	foreignClockIn: "d8350000-0000-4000-8000-0000000000e4",
} as const;
const users = [
	ids.ownerUser,
	ids.holderUser,
	ids.managerUser,
	ids.fieldUser,
	ids.officeUser,
	ids.foreignUser,
];

const POSITION_HEADER =
	"id,employeeId,employeeName,employeeNumber,type,timestamp,notes,positionLatitude,positionLongitude,positionAccuracyMeters,positionFixedAt,deviceInfo,replacesEntryId,isSuperseded,createdAt";
const PLAIN_HEADER =
	"id,employeeId,employeeName,employeeNumber,type,timestamp,notes,deviceInfo,replacesEntryId,isSuperseded,createdAt";

describe("position stamps in the org data export on PostgreSQL", () => {
	vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
	const pool = integrationAdminPool();

	async function cleanup() {
		await pool.query("delete from organization where id in ($1, $2)", [
			ids.organization,
			ids.otherOrganization,
		]);
		await pool.query('delete from "user" where id = any($1::text[])', [users]);
	}

	async function seed() {
		await cleanup();
		storage.uploads.clear();
		const at = new Date("2026-01-01T00:00:00Z");
		await pool.query(
			`insert into organization (id, name, slug, timezone, created_at) values
			 ($1, 'T835 position', $1, 'Europe/Berlin', $3), ($2, 'T835 other', $2, 'UTC', $3)`,
			[ids.organization, ids.otherOrganization, at],
		);
		await pool.query(
			`insert into "user" (id, name, email, role, created_at, updated_at)
			 select user_id, initcap(replace(user_id, '-', ' ')), user_id || '@example.test', 'user', $2, $2
			 from unnest($1::text[]) as user_id`,
			[users, at],
		);
		const people: Array<[string, string, string, string, string]> = [
			[ids.owner, ids.ownerUser, ids.organization, "owner", "admin"],
			[ids.holder, ids.holderUser, ids.organization, "member", "employee"],
			[ids.manager, ids.managerUser, ids.organization, "member", "manager"],
			[ids.field, ids.fieldUser, ids.organization, "member", "employee"],
			[ids.office, ids.officeUser, ids.organization, "member", "employee"],
			[ids.foreign, ids.foreignUser, ids.otherOrganization, "owner", "admin"],
		];
		for (const [employeeId, userId, organizationId, memberRole, employeeRole] of people) {
			await pool.query(
				`insert into member (id, organization_id, user_id, role, status, created_at)
				 values ($1, $2, $3, $4, 'approved', $5)`,
				[`m-${userId}`, organizationId, userId, memberRole, at],
			);
			await pool.query(
				`insert into employee (id, user_id, organization_id, role, employee_number, updated_at)
				 values ($1, $2, $3, $4, $6, $5)`,
				[employeeId, userId, organizationId, employeeRole, at, `N-${employeeId.slice(-2)}`],
			);
		}
		await pool.query(
			`insert into custom_role (id, organization_id, name, is_active, base_tier, created_by, updated_at)
			 values ($1, $2, 'Position reviewer', true, 'employee', $3, $4)`,
			[ids.viewerRole, ids.organization, ids.ownerUser, at],
		);
		await pool.query(
			`insert into custom_role_permission (custom_role_id, action, subject) values ($1, 'read', 'PositionStamp')`,
			[ids.viewerRole],
		);
		await pool.query(
			`insert into employee_custom_role (employee_id, custom_role_id, assigned_by) values ($1, $2, $3)`,
			[ids.holder, ids.viewerRole, ids.ownerUser],
		);

		await pool.query(
			`insert into position_notice (id, organization_id, version, purpose_statement, retention_days, template_revision, created_at)
			 values ($1, $2, 1, 'Proof of on-site work', 90, 1, $5), ($3, $4, 1, 'Other', 90, 1, $5)`,
			[ids.notice, ids.organization, ids.foreignNotice, ids.otherOrganization, at],
		);
		await pool.query(
			`insert into position_consent (id, organization_id, employee_id, notice_id, granted_at)
			 values ($1, $2, $3, $4, $9), ($5, $6, $7, $8, $9)`,
			[
				ids.consent,
				ids.organization,
				ids.field,
				ids.notice,
				ids.foreignConsent,
				ids.otherOrganization,
				ids.foreign,
				ids.foreignNotice,
				at,
			],
		);
		const entries: Array<[string, string, string, string, string]> = [
			[ids.fieldClockIn, ids.field, ids.organization, "clock_in", "2026-09-20T06:00:00Z"],
			[ids.fieldClockOut, ids.field, ids.organization, "clock_out", "2026-09-20T14:00:00Z"],
			[ids.officeClockIn, ids.office, ids.organization, "clock_in", "2026-09-20T07:00:00Z"],
			[ids.foreignClockIn, ids.foreign, ids.otherOrganization, "clock_in", "2026-09-20T06:00:00Z"],
		];
		for (const [id, employeeId, organizationId, type, timestamp] of entries) {
			await pool.query(
				`insert into time_entry (id, employee_id, organization_id, type, timestamp, utc_offset_minutes,
					timezone_source, hash, created_by, created_at)
				 values ($1, $2, $3, $4, $5, 120, 'test', md5(random()::text), $6, $5)`,
				[id, employeeId, organizationId, type, new Date(timestamp), ids.ownerUser],
			);
		}
		const stamp = `insert into position_stamp (organization_id, employee_id, time_entry_id, consent_id,
			latitude, longitude, accuracy_meters, fixed_at, captured_at, purge_at)
			values ($1, $2, $3, $4, $5, $6, $7, $8, $8, $9)`;
		await pool.query(stamp, [
			ids.organization,
			ids.field,
			ids.fieldClockIn,
			ids.consent,
			52.520008,
			13.404954,
			18.5,
			new Date("2026-09-20T05:59:58Z"),
			new Date("2026-12-19T06:00:00Z"),
		]);
		await pool.query(stamp, [
			ids.otherOrganization,
			ids.foreign,
			ids.foreignClockIn,
			ids.foreignConsent,
			48.137154,
			11.576124,
			5,
			new Date("2026-09-20T05:59:59Z"),
			new Date("2026-12-19T06:00:00Z"),
		]);
	}

	async function requestExport(requestedById: string, categories: string[] = ["time_entries"]) {
		const { rows } = await pool.query<{ id: string }>(
			`insert into data_export (organization_id, requested_by_id, categories, status)
			 values ($1, $2, $3, 'pending') returning id`,
			[ids.organization, requestedById, categories],
		);
		const id = rows[0]?.id;
		if (!id) throw new Error("export not created");
		return id;
	}

	async function timeEntriesCsv(exportId: string): Promise<Map<string, Record<string, string>>> {
		const archive = storage.uploads.get(`exports/${exportId}.zip`);
		if (!archive) throw new Error(`no archive uploaded for ${exportId}`);
		const zip = await JSZip.loadAsync(archive);
		const csv = await zip.file("time_entries.csv")?.async("string");
		if (!csv) throw new Error("no time_entries.csv in the archive");
		const [header = "", ...lines] = csv.split("\n");
		const columns = header.split(",");
		lastHeader = header;
		return new Map(
			lines.map((line) => {
				const cells = line.split(",");
				const row = Object.fromEntries(
					columns.map((column, index) => [column, cells[index] ?? ""]),
				);
				return [row.id ?? "", row];
			}),
		);
	}
	let lastHeader = "";

	async function accessLog() {
		return listPositionStampAccessLog(db, { organizationId: ids.organization });
	}

	beforeEach(async () => {
		await seed();
	});

	afterAll(async () => {
		await cleanup();
	});

	it("gives an owner the stamps in place of location and logs the export once", async () => {
		const exportId = await requestExport(ids.owner);
		await processExport(exportId);

		const rows = await timeEntriesCsv(exportId);
		expect(lastHeader).toBe(POSITION_HEADER);
		expect(rows.get(ids.fieldClockIn)).toMatchObject({
			positionLatitude: "52.520008",
			positionLongitude: "13.404954",
			positionAccuracyMeters: "18.5",
			positionFixedAt: "2026-09-20T05:59:58.000Z",
		});
		for (const unstamped of [ids.fieldClockOut, ids.officeClockIn]) {
			expect(rows.get(unstamped)).toMatchObject({
				positionLatitude: "",
				positionLongitude: "",
				positionAccuracyMeters: "",
				positionFixedAt: "",
			});
		}
		expect(rows.has(ids.foreignClockIn)).toBe(false);

		const entries = await accessLog();
		expect(entries).toHaveLength(1);
		expect(entries[0]).toMatchObject({
			kind: "data_export",
			exportId,
			viewer: { userId: ids.ownerUser },
			subjectEmployeeIds: [ids.field],
			workPeriods: [],
		});
	});

	it("gives a holder of the view permission the stamps", async () => {
		const exportId = await requestExport(ids.holder);
		await processExport(exportId);

		await timeEntriesCsv(exportId);
		expect(lastHeader).toBe(POSITION_HEADER);
		expect(await accessLog()).toMatchObject([
			{ kind: "data_export", exportId, viewer: { userId: ids.holderUser } },
		]);
	});

	it("omits the position columns for a user who may not view stamps and logs nothing", async () => {
		const exportId = await requestExport(ids.manager);
		await processExport(exportId);

		const rows = await timeEntriesCsv(exportId);
		expect(lastHeader).toBe(PLAIN_HEADER);
		expect(rows.get(ids.fieldClockIn)).toBeDefined();
		expect(await accessLog()).toEqual([]);
	});

	it("decides when the export is processed, not when it was requested", async () => {
		const exportId = await requestExport(ids.holder);
		// The holder's role is switched off while the export waits for the job.
		await pool.query("update custom_role set is_active = false where id = $1", [ids.viewerRole]);
		await processExport(exportId);

		await timeEntriesCsv(exportId);
		expect(lastHeader).toBe(PLAIN_HEADER);
		expect(await accessLog()).toEqual([]);
	});

	it("logs nothing when the export has no time entries", async () => {
		const exportId = await requestExport(ids.owner, ["teams"]);
		await processExport(exportId);

		expect(await accessLog()).toEqual([]);
	});

	describe("scheduled data exports", () => {
		const emailOf = (userId: string) => `${userId}@example.test`;
		const run = (createdBy: string, emailRecipients: string[] = []) =>
			new DataExportExecutor().execute({
				organizationId: ids.organization,
				reportConfig: { categories: ["time_entries"] } as never,
				dateRange: {} as never,
				createdBy,
				emailRecipients,
			});

		it("decides with the schedule owner's permission when the file is mailed to nobody", async () => {
			const permitted = await run(ids.holderUser);
			expect(permitted).toMatchObject({ success: true });
			await timeEntriesCsv(permitted.underlyingJobId ?? "");
			expect(lastHeader).toBe(POSITION_HEADER);

			const refused = await run(ids.managerUser);
			expect(refused).toMatchObject({ success: true });
			await timeEntriesCsv(refused.underlyingJobId ?? "");
			expect(lastHeader).toBe(PLAIN_HEADER);

			expect(await accessLog()).toMatchObject([
				{
					kind: "data_export",
					exportId: permitted.underlyingJobId,
					viewer: { userId: ids.holderUser },
					subjectEmployeeIds: [ids.field],
				},
			]);
		});

		it("includes the stamps when every recipient may view them and logs each viewer", async () => {
			const result = await run(ids.holderUser, [
				emailOf(ids.ownerUser).toUpperCase(),
				emailOf(ids.holderUser),
			]);
			expect(result).toMatchObject({ success: true });
			await timeEntriesCsv(result.underlyingJobId ?? "");
			expect(lastHeader).toBe(POSITION_HEADER);

			const entries = await accessLog();
			expect(entries.map((entry) => entry.viewer?.userId).sort()).toEqual(
				[ids.holderUser, ids.ownerUser].sort(),
			);
			for (const entry of entries) {
				expect(entry).toMatchObject({
					kind: "data_export",
					exportId: result.underlyingJobId,
					subjectEmployeeIds: [ids.field],
				});
			}
		});

		it("omits the stamps when one recipient is a member who may not view them", async () => {
			const result = await run(ids.holderUser, [emailOf(ids.ownerUser), emailOf(ids.managerUser)]);
			expect(result).toMatchObject({ success: true });
			await timeEntriesCsv(result.underlyingJobId ?? "");
			expect(lastHeader).toBe(PLAIN_HEADER);
			expect(await accessLog()).toEqual([]);
		});

		it("omits the stamps when one recipient is outside the organization", async () => {
			for (const recipient of ["payroll@external.test", emailOf(ids.foreignUser)]) {
				const result = await run(ids.ownerUser, [recipient]);
				expect(result).toMatchObject({ success: true });
				await timeEntriesCsv(result.underlyingJobId ?? "");
				expect(lastHeader).toBe(PLAIN_HEADER);
			}
			expect(await accessLog()).toEqual([]);
		});
	});
});
