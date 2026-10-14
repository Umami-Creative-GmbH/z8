/**
 * #1198: DATEV Lohn, Lexware and Sage exports refuse two employees that resolve
 * to one personnel identifier, against a disposable PostgreSQL database, and
 * payroll readiness lists the clash as a blocker. #1199: the Personio, Workday
 * and SuccessFactors exports refuse two employees that would match one external
 * worker, before any call to the external system.
 *
 * Work is written by the real legacy `createManualTimeEntry` action and exported
 * through the real export service, formatters, connectors and payroll server
 * action. Only the session, notifications, the queue, object storage, the vault
 * and the Personio HTTP client are replaced.
 *
 * Employee numbers are unique per organization in the database (#1196), so an
 * employee-number clash is set up the one way it can still happen: an employee
 * without a number falls back to their ID, which another employee holds as
 * number (different case).
 */

import { randomUUID } from "node:crypto";
import { DateTime } from "luxon";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ManualTimeEntryCommand } from "@/lib/time-tracking/manual-command";
import { integrationAdminPool } from "@/test/integration-database";

const harness = vi.hoisted(() => ({
	userId: null as string | null,
	organizationId: null as string | null,
	personioAttendances: [] as Array<{ employee: string | number }>,
}));

vi.mock("next/headers", async () => (await import("@/test/integration-harness")).nextHeaders());
vi.mock("next/server", async (importOriginal) =>
	(await import("@/test/integration-harness")).nextServer(importOriginal),
);
vi.mock("next/cache", async (importOriginal) =>
	(await import("@/test/integration-harness")).nextCache(importOriginal),
);
vi.mock("@/lib/auth", () => ({
	auth: {
		api: {
			getSession: async () =>
				harness.userId
					? {
							user: { id: harness.userId, role: "user" },
							session: {
								id: `t1198-session-${harness.userId}`,
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
vi.mock("@/lib/notifications/triggers", async (importOriginal) =>
	(await import("@/test/integration-harness")).notificationTriggers(importOriginal),
);
vi.mock("@/app/[locale]/(app)/time-tracking/actions/approvals", async (importOriginal) => ({
	...(await importOriginal<
		typeof import("@/app/[locale]/(app)/time-tracking/actions/approvals")
	>()),
	sendManualEntryApprovalNotifications: async () => undefined,
	sendManualEntryApprovedNotification: async () => undefined,
}));
vi.mock("@/tolgee/server", () => ({
	getTranslate: async () => (_key: string, fallback: string, params?: Record<string, string>) =>
		fallback.replace(/\{(\w+)\}/g, (_, name: string) => params?.[name] ?? `{${name}}`),
}));
vi.mock("@/lib/storage/export-s3-client", () => ({
	uploadExport: async () => undefined,
	getPresignedUrl: async (_organizationId: string, key: string) => `https://exports.test/${key}`,
}));
vi.mock("@/lib/queue", () => ({ addJob: async () => ({ id: "queued" }) }));
vi.mock("@/lib/vault/secrets", () => ({ getOrgSecret: async () => "t1199-secret" }));
vi.mock("@/lib/payroll-export/exporters/personio/api-client", () => ({
	PersonioApiClient: class {
		async createAttendances(requests: Array<{ employee: string | number }>) {
			harness.personioAttendances.push(...requests);
			return requests.map((_, index) => ({ success: true, externalId: index + 1 }));
		}
		async createAbsences() {
			return [];
		}
	},
}));

const { createManualTimeEntry } = await import("@/app/[locale]/(app)/time-tracking/actions");
const { startScopedPayrollExportAction } = await import("@/app/[locale]/(app)/payroll/actions");
const { createExportJob, getExporter, processExportJob } = await import("./export-service");
const { PayrollIdentifierDuplicateError } = await import("./personnel-identifier");
const { getPayrollReadiness } = await import("@/lib/payroll-readiness/get-payroll-readiness");

const ORG = "t1198-org";
const ids = {
	ownerUser: "t1198-owner",
	workerUser: "t1198-worker",
	peerUser: "t1198-peer",
	owner: "d1198000-0000-4000-8000-000000000001",
	worker: "d1198000-0000-4000-8000-000000000002",
	peer: "d1198000-0000-4000-8000-000000000003",
	payrollId: "f1198000-0000-4000-8000-000000000001",
} as const;
const users = [ids.ownerUser, ids.workerUser, ids.peerUser];
const july = { startDate: "2026-07-01", endDate: "2026-07-31", label: "July 2026" };

const DATEV = { mandantennummer: "12345", beraternummer: "1234567", includeZeroHours: false };
const configs = {
	datev_lohn: DATEV,
	lexware_lohn: { includeStunden: true, includeZeroHours: false },
	sage_lohn: { outputFormat: "sage_native", includeZeroHours: false },
} as const;
type FileFormat = keyof typeof configs;
const fileFormats = Object.keys(configs) as FileFormat[];

describe("duplicate personnel identifiers in payroll file exports on PostgreSQL", () => {
	vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
	const admin = integrationAdminPool();

	function actAs(userId: string) {
		harness.userId = userId;
		harness.organizationId = ORG;
	}

	async function approvedWork(employeeId: string, date: string) {
		actAs(ids.ownerUser);
		const result = await createManualTimeEntry({
			submissionId: randomUUID(),
			reason: "Personnel identifier evidence",
			timezone: "Europe/Berlin",
			browserTimezone: "Europe/Berlin",
			date,
			clockInTime: "08:00",
			clockOutTime: "12:00",
			employeeId,
		} as unknown as ManualTimeEntryCommand);
		expect(result).toMatchObject({ success: true });
	}

	async function cleanup() {
		await admin.query("delete from organization where id = $1", [ORG]);
		await admin.query('delete from "user" where id = any($1::text[])', [users]);
	}

	async function seed() {
		await cleanup();
		const timestamp = new Date("2026-01-01T00:00:00Z");
		await admin.query(
			`insert into organization (id, name, slug, timezone, created_at)
			 values ($1, 'T1198', $1, 'Europe/Berlin', $2)`,
			[ORG, timestamp],
		);
		await admin.query(
			`insert into "user" (id, name, email, created_at, updated_at) values
			 ($1, 'Olga Owner', 'olga@t1198.test', $4, $4),
			 ($2, 'Anna Worker', 'anna@t1198.test', $4, $4),
			 ($3, 'Ben Peer', 'ben@t1198.test', $4, $4)`,
			[ids.ownerUser, ids.workerUser, ids.peerUser, timestamp],
		);
		await admin.query(
			`insert into member (id, organization_id, user_id, role, status, created_at) values
			 ('t1198-m-owner', $1, $2, 'owner', 'approved', $5),
			 ('t1198-m-worker', $1, $3, 'member', 'approved', $5),
			 ('t1198-m-peer', $1, $4, 'member', 'approved', $5)`,
			[ORG, ids.ownerUser, ids.workerUser, ids.peerUser, timestamp],
		);
		await admin.query(
			`insert into employee (id, user_id, organization_id, role, employee_number, updated_at) values
			 ($1, $2, $7, 'admin', 'OWN-1', $8), ($3, $4, $7, 'employee', 'WRK-1', $8),
			 ($5, $6, $7, 'employee', 'PER-1', $8)`,
			[
				ids.owner,
				ids.ownerUser,
				ids.worker,
				ids.workerUser,
				ids.peer,
				ids.peerUser,
				ORG,
				timestamp,
			],
		);
		await admin.query(
			`insert into user_settings (user_id, timezone, updated_at)
			 select user_id, 'Europe/Berlin', $2 from unnest($1::text[]) as user_id`,
			[users, timestamp],
		);
		await admin.query(
			`insert into approval_workflow_rollout
			 (organization_id, workflow_type, lifecycle_mode, side_effect_mode, created_at, updated_at)
			 values ($1, 'manual_time_submission', 'legacy', 'legacy', now(), now())`,
			[ORG],
		);
		await admin.query(
			`insert into payroll_export_format (id, name, version, updated_at) values
			 ('datev_lohn', 'DATEV Lohn & Gehalt', '2024.1', now()),
			 ('lexware_lohn', 'Lexware lohn+gehalt', '2024.1', now()),
			 ('sage_lohn', 'Sage Lohn', '2024.1', now()),
			 ('personio', 'Personio', '1.0', now()),
			 ('workday_api', 'Workday', '1.0', now()),
			 ('successfactors_api', 'SAP SuccessFactors (API)', '1.0', now()),
			 ('successfactors_csv', 'SAP SuccessFactors (CSV)', '1.0', now())
			 on conflict (id) do nothing`,
		);
		await admin.query(
			`insert into payroll_access_grant (organization_id, payroll_employee_id, scope, created_by, updated_at)
			 values ($1, $2, 'all', $3, now())`,
			[ORG, ids.owner, ids.ownerUser],
		);
		await admin.query(
			`insert into custom_field_definition
			 (id, organization_id, entity, name, type, tracked, visibility, edit_level, position)
			 values ($1, $2, 'employee', 'Payroll ID', 'text', false, 'admin', 'admin', 0)`,
			[ids.payrollId, ORG],
		);
		await admin.query(
			`insert into payroll_work_collection_control (organization_id, mode) values ($1, 'active')`,
			[ORG],
		);
	}

	async function configure(formatId: string, config: object) {
		await admin.query(
			`insert into payroll_export_config (organization_id, format_id, config, created_by, updated_at)
			 values ($1, $2, $3::jsonb, $4, now())
			 on conflict (organization_id, format_id) where is_active = true
			 do update set config = excluded.config`,
			[ORG, formatId, JSON.stringify(config), ids.ownerUser],
		);
	}

	async function textValue(employeeId: string, value: string) {
		await admin.query(
			`insert into custom_field_value (organization_id, definition_id, employee_id, text_value)
			 values ($1, $2, $3, $4)`,
			[ORG, ids.payrollId, employeeId, value],
		);
	}

	/** The worker has no number and falls back to their ID; the peer holds that ID as number. */
	async function numberClash() {
		await admin.query("update employee set employee_number = null where id = $1", [ids.worker]);
		await admin.query("update employee set employee_number = $1 where id = $2", [
			ids.worker.toUpperCase(),
			ids.peer,
		]);
	}

	beforeEach(async () => {
		harness.personioAttendances.length = 0;
		vi.restoreAllMocks();
		await seed();
	});
	afterAll(cleanup);

	async function exportJuly(formatId: string) {
		const { jobId } = await createExportJob({
			organizationId: ORG,
			formatId,
			requestedById: ids.owner,
			filters: {
				dateRange: {
					start: DateTime.fromISO(july.startDate, { zone: "utc" }),
					end: DateTime.fromISO(july.endDate, { zone: "utc" }),
				},
			},
		});
		const outcome = await processExportJob({ jobId, organizationId: ORG }).catch(
			(error: unknown) => error,
		);
		const { rows } = await admin.query<{ status: string; file_name: string | null }>(
			"select status, file_name from payroll_export_job where id = $1",
			[jobId],
		);
		return { outcome, job: rows[0] };
	}

	function clashingEmployees(refusal: unknown) {
		expect(refusal).toBeInstanceOf(PayrollIdentifierDuplicateError);
		return (refusal as InstanceType<typeof PayrollIdentifierDuplicateError>).clashes.map((clash) =>
			clash.employees.map(({ employeeId, name }) => [employeeId, name]),
		);
	}

	it.each(fileFormats)(
		"refuses a %s export where an employee number equals another employee's fallback ID",
		async (formatId) => {
			await configure(formatId, { ...configs[formatId], personnelNumberType: "employeeNumber" });
			await numberClash();
			await approvedWork(ids.worker, "2026-07-10");
			await approvedWork(ids.peer, "2026-07-11");

			const { outcome, job } = await exportJuly(formatId);

			expect(clashingEmployees(outcome)).toEqual([
				[
					[ids.worker, "Anna Worker"],
					[ids.peer, "Ben Peer"],
				],
			]);
			expect((outcome as Error).message).toContain("Anna Worker");
			expect((outcome as Error).message).toContain("Ben Peer");
			expect(job).toEqual({ status: "failed", file_name: null });
		},
	);

	it.each(fileFormats)(
		"refuses a %s export where two employees have the same custom field identifier",
		async (formatId) => {
			await configure(formatId, {
				...configs[formatId],
				personnelNumberType: "customField",
				personnelNumberCustomFieldId: ids.payrollId,
			});
			await textValue(ids.worker, "LG-7");
			await textValue(ids.peer, " lg-7");
			await approvedWork(ids.worker, "2026-07-10");
			await approvedWork(ids.peer, "2026-07-11");

			const { outcome, job } = await exportJuly(formatId);

			expect(clashingEmployees(outcome)).toEqual([
				[
					[ids.worker, "Anna Worker"],
					[ids.peer, "Ben Peer"],
				],
			]);
			expect(job).toEqual({ status: "failed", file_name: null });
		},
	);

	it("refuses the same clash without scoped collection", async () => {
		await admin.query("delete from payroll_work_collection_control where organization_id = $1", [
			ORG,
		]);
		await configure("datev_lohn", {
			...DATEV,
			personnelNumberType: "customField",
			personnelNumberCustomFieldId: ids.payrollId,
		});
		await textValue(ids.worker, "LG-7");
		await textValue(ids.peer, "LG-7");
		await approvedWork(ids.worker, "2026-07-10");
		await approvedWork(ids.peer, "2026-07-11");

		const { outcome, job } = await exportJuly("datev_lohn");

		expect(clashingEmployees(outcome)).toHaveLength(1);
		expect(job?.status).toBe("failed");
	});

	it("tells the payroll workspace which employees clash, in a translated message", async () => {
		await configure("datev_lohn", { ...DATEV, personnelNumberType: "employeeNumber" });
		await numberClash();
		await approvedWork(ids.worker, "2026-07-10");
		await approvedWork(ids.peer, "2026-07-11");

		actAs(ids.ownerUser);
		const result = await startScopedPayrollExportAction({ ...july, formatId: "datev_lohn" });

		expect(result).toEqual({
			success: false,
			error: `Export blocked: several employees share a personnel identifier. Give each employee their own: Anna Worker (${ids.worker}), Ben Peer (${ids.worker.toUpperCase()})`,
			code: "ConflictError",
		});
	});

	it("exports two employees with unique identifiers as two employees", async () => {
		await configure("datev_lohn", { ...DATEV, personnelNumberType: "employeeNumber" });
		await approvedWork(ids.worker, "2026-07-10");
		await approvedWork(ids.peer, "2026-07-11");

		const { outcome, job } = await exportJuly("datev_lohn");

		expect(outcome).toMatchObject({ result: { metadata: { employeeCount: 2 } } });
		expect(job?.status).toBe("completed");
	});

	describe("API connectors (#1199)", () => {
		const connections = {
			personio: {},
			workday_api: { instanceUrl: "https://workday.t1199.test", tenantId: "t1199" },
			successfactors_api: { instanceUrl: "https://sf.t1199.test", companyId: "T1199" },
		} as const;
		type ApiFormat = keyof typeof connections;
		const apiFormats = Object.keys(connections) as ApiFormat[];
		const byPayrollId = { employeeMatchStrategy: "customField", employeeMatchCustomFieldId: "" };

		/** Spies on the connector's export, the first step that reaches the external system. */
		function connectorExport(formatId: ApiFormat) {
			const connector = getExporter(formatId);
			if (!connector) throw new Error(`no connector for ${formatId}`);
			return vi.spyOn(connector, "export");
		}

		it.each(apiFormats)(
			"refuses a %s export where two employees share the custom field match value, without calling it",
			async (formatId) => {
				await configure(formatId, {
					...connections[formatId],
					...byPayrollId,
					employeeMatchCustomFieldId: ids.payrollId,
				});
				await textValue(ids.worker, "LG-7");
				await textValue(ids.peer, " lg-7");
				await approvedWork(ids.worker, "2026-07-10");
				await approvedWork(ids.peer, "2026-07-11");
				const external = connectorExport(formatId);

				const { outcome, job } = await exportJuly(formatId);

				expect(clashingEmployees(outcome)).toEqual([
					[
						[ids.worker, "Anna Worker"],
						[ids.peer, "Ben Peer"],
					],
				]);
				// The shared value as the connector sends it (Workday trims it).
				expect((outcome as Error).message).toMatch(/Anna Worker \(LG-7\), Ben Peer \( ?lg-7\)/);
				expect(external).not.toHaveBeenCalled();
				expect(job?.status).toBe("failed");
			},
		);

		it("refuses a SuccessFactors user ID that equals another employee's fallback ID", async () => {
			await configure("successfactors_api", {
				...connections.successfactors_api,
				employeeMatchStrategy: "userId",
			});
			await numberClash();
			await approvedWork(ids.worker, "2026-07-10");
			await approvedWork(ids.peer, "2026-07-11");
			const external = connectorExport("successfactors_api");

			const { outcome } = await exportJuly("successfactors_api");

			expect(clashingEmployees(outcome)).toEqual([
				[
					[ids.worker, "Anna Worker"],
					[ids.peer, "Ben Peer"],
				],
			]);
			expect(external).not.toHaveBeenCalled();
		});

		it("refuses a SuccessFactors CSV file where two employees share the custom field user ID", async () => {
			await configure("successfactors_csv", {
				...byPayrollId,
				employeeMatchCustomFieldId: ids.payrollId,
			});
			await textValue(ids.worker, "LG-7");
			await textValue(ids.peer, "LG-7");
			await approvedWork(ids.worker, "2026-07-10");
			await approvedWork(ids.peer, "2026-07-11");

			const { outcome, job } = await exportJuly("successfactors_csv");

			expect(clashingEmployees(outcome)).toHaveLength(1);
			expect(job).toEqual({ status: "failed", file_name: null });
		});

		it("exports two employees with unique match values to Personio as before", async () => {
			await configure("personio", { ...byPayrollId, employeeMatchCustomFieldId: ids.payrollId });
			await textValue(ids.worker, "LG-7");
			await textValue(ids.peer, "LG-8");
			await approvedWork(ids.worker, "2026-07-10");
			await approvedWork(ids.peer, "2026-07-11");

			const { outcome, job } = await exportJuly("personio");

			expect(outcome).toMatchObject({ apiResult: { success: true, syncedRecords: 2 } });
			expect(harness.personioAttendances.map((request) => request.employee).toSorted()).toEqual([
				"LG-7",
				"LG-8",
			]);
			expect(job?.status).toBe("completed");
		});
	});

	describe("payroll readiness", () => {
		const readinessOfJuly = () =>
			getPayrollReadiness({
				organizationId: ORG,
				period: {
					start: DateTime.fromISO(july.startDate, { zone: "utc" }),
					end: DateTime.fromISO(july.endDate, { zone: "utc" }),
				},
			});
		const duplicateCheck = (readiness: Awaited<ReturnType<typeof readinessOfJuly>>) =>
			readiness.groups
				.flatMap((group) => group.checks)
				.find((check) => check.id === "duplicate-personnel-identifiers");

		it("lists two employees sharing a custom field identifier as a blocker", async () => {
			await configure("lexware_lohn", {
				...configs.lexware_lohn,
				personnelNumberType: "customField",
				personnelNumberCustomFieldId: ids.payrollId,
			});
			await textValue(ids.worker, "LG-7");
			await textValue(ids.peer, "lg-7 ");
			await approvedWork(ids.worker, "2026-07-10");
			await approvedWork(ids.peer, "2026-07-11");

			const readiness = await readinessOfJuly();
			const check = duplicateCheck(readiness);

			expect(readiness.status).toBe("blocked");
			expect(check).toMatchObject({ status: "fail", severity: "blocker", count: 2 });
			expect(
				check?.affectedEmployees.map(({ id, name, personnelIdentifier }) => [
					id,
					name,
					personnelIdentifier,
				]),
			).toEqual([
				[ids.worker, "Anna Worker", "LG-7"],
				[ids.peer, "Ben Peer", "lg-7 "],
			]);
		});

		it("lists an employee number clashing with a fallback ID as a blocker", async () => {
			await configure("datev_lohn", { ...DATEV, personnelNumberType: "employeeNumber" });
			await numberClash();
			await approvedWork(ids.worker, "2026-07-10");
			await approvedWork(ids.peer, "2026-07-11");

			const check = duplicateCheck(await readinessOfJuly());

			expect(check?.status).toBe("fail");
			expect(check?.affectedEmployees.map((employee) => employee.id)).toEqual([
				ids.worker,
				ids.peer,
			]);
		});

		it("lists two employees one Workday worker would match as a blocker", async () => {
			await configure("workday_api", {
				instanceUrl: "https://workday.t1199.test",
				tenantId: "t1199",
				employeeMatchStrategy: "customField",
				employeeMatchCustomFieldId: ids.payrollId,
			});
			await textValue(ids.worker, "WD-1");
			await textValue(ids.peer, "wd-1");
			await approvedWork(ids.worker, "2026-07-10");
			await approvedWork(ids.peer, "2026-07-11");

			const check = duplicateCheck(await readinessOfJuly());

			expect(check).toMatchObject({ status: "fail", severity: "blocker", count: 2 });
		});

		it("lists a SuccessFactors user ID clashing with a fallback ID as a blocker", async () => {
			await configure("successfactors_api", {
				instanceUrl: "https://sf.t1199.test",
				companyId: "T1199",
				employeeMatchStrategy: "userId",
			});
			await numberClash();
			await approvedWork(ids.worker, "2026-07-10");
			await approvedWork(ids.peer, "2026-07-11");

			const check = duplicateCheck(await readinessOfJuly());

			expect(check?.affectedEmployees.map((employee) => employee.id)).toEqual([
				ids.worker,
				ids.peer,
			]);
		});

		it("shows no such blocker when identifiers are unique", async () => {
			await configure("sage_lohn", {
				...configs.sage_lohn,
				personnelNumberType: "customField",
				personnelNumberCustomFieldId: ids.payrollId,
			});
			await textValue(ids.worker, "0042");
			await textValue(ids.peer, "42");
			await approvedWork(ids.worker, "2026-07-10");
			await approvedWork(ids.peer, "2026-07-11");

			const check = duplicateCheck(await readinessOfJuly());

			expect(check).toMatchObject({ status: "pass", count: 0, affectedEmployees: [] });
		});
	});
});
