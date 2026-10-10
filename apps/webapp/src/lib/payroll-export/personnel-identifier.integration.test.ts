/**
 * #821: an employee custom field as payroll personnel identifier, against a
 * disposable PostgreSQL database.
 *
 * Work is written by the real legacy `createManualTimeEntry` action (the owner's
 * entry for an employee is approved) and exported through the real export
 * service, scoped collection, formatters and payroll server actions. Only the
 * session, notifications, the queue, object storage and the Personio HTTP client
 * are replaced.
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
	personioStrategies: [] as string[],
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
								id: `t821-session-${harness.userId}`,
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
	getTranslate: async () => (_key: string, fallback: string) => fallback,
}));
vi.mock("@/lib/storage/export-s3-client", () => ({
	uploadExport: async () => undefined,
	getPresignedUrl: async (_organizationId: string, key: string) => `https://exports.test/${key}`,
}));
vi.mock("@/lib/queue", () => ({ addJob: async () => ({ id: "queued" }) }));
vi.mock("@/lib/vault/secrets", () => ({ getOrgSecret: async () => "t821-secret" }));
vi.mock("@/lib/payroll-export/exporters/personio/api-client", () => ({
	PersonioApiClient: class {
		async createAttendances(requests: Array<{ employee: string | number }>, strategy: string) {
			harness.personioAttendances.push(...requests);
			harness.personioStrategies.push(strategy);
			return requests.map((_, index) => ({ success: true, externalId: index + 1 }));
		}
		async createAbsences() {
			return [];
		}
	},
}));

const { createManualTimeEntry } = await import("@/app/[locale]/(app)/time-tracking/actions");
const { startScopedPayrollExportAction } = await import("@/app/[locale]/(app)/payroll/actions");
const { createExportJob, processExportJob } = await import("./export-service");
const { PayrollWorkCollectionBlockedError } = await import(
	"@/lib/payroll-collection/payroll-work-collection-blocked-error"
);
const { payrollWorkInputDigest } = await import("@/lib/payroll-collection/payroll-work-collection");
const { PayrollIdentifierChangedError, PayrollIdentifierMissingError } = await import(
	"./personnel-identifier"
);
const { listPayrollIdentifierFields, savePayrollExportConfig } = await import(
	"./personnel-identifier-store"
);
const { changeCustomFields } = await import("@/lib/organization/custom-fields/definitions");
const { payrollIdentifierArchiveGuard } = await import("./personnel-identifier-usage");
const { db } = await import("@/db");

const ORG = "t821-org";
const OTHER_ORG = "t821-other";
const ids = {
	ownerUser: "t821-owner",
	workerUser: "t821-worker",
	peerUser: "t821-peer",
	foreignUser: "t821-foreign",
	owner: "d8210000-0000-4000-8000-000000000001",
	worker: "d8210000-0000-4000-8000-000000000002",
	peer: "d8210000-0000-4000-8000-000000000003",
	foreign: "d8210000-0000-4000-8000-000000000004",
	payrollId: "f8210000-0000-4000-8000-000000000001",
	trackedId: "f8210000-0000-4000-8000-000000000002",
	numberId: "f8210000-0000-4000-8000-000000000003",
	dateField: "f8210000-0000-4000-8000-000000000004",
	projectField: "f8210000-0000-4000-8000-000000000005",
	archivedField: "f8210000-0000-4000-8000-000000000006",
	foreignField: "f8210000-0000-4000-8000-000000000007",
} as const;
const users = [ids.ownerUser, ids.workerUser, ids.peerUser, ids.foreignUser];
const july = { startDate: "2026-07-01", endDate: "2026-07-31", label: "July 2026" };

const DATEV = { mandantennummer: "12345", beraternummer: "1234567", includeZeroHours: false };
const byField = (fieldId: string) => ({
	...DATEV,
	personnelNumberType: "customField",
	personnelNumberCustomFieldId: fieldId,
});

describe("employee custom field as payroll identifier on PostgreSQL", () => {
	vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
	const admin = integrationAdminPool();

	function actAs(userId: string) {
		harness.userId = userId;
		harness.organizationId = ORG;
	}

	async function approvedWork(employeeId: string, date: string, from = "08:00", to = "12:00") {
		actAs(ids.ownerUser);
		const result = await createManualTimeEntry({
			submissionId: randomUUID(),
			reason: "Payroll identifier evidence",
			timezone: "Europe/Berlin",
			browserTimezone: "Europe/Berlin",
			date,
			clockInTime: from,
			clockOutTime: to,
			employeeId,
		} as unknown as ManualTimeEntryCommand);
		expect(result).toMatchObject({ success: true });
	}

	async function cleanup() {
		await admin.query("delete from organization where id in ($1, $2)", [ORG, OTHER_ORG]);
		await admin.query('delete from "user" where id = any($1::text[])', [users]);
	}

	async function field(input: {
		id: string;
		organizationId?: string;
		entity?: string;
		name: string;
		type?: string;
		tracked?: boolean;
		position: number;
		archived?: boolean;
	}) {
		await admin.query(
			`insert into custom_field_definition
			 (id, organization_id, entity, name, type, tracked, visibility, edit_level, position, archived_at)
			 values ($1, $2, $3, $4, $5, $6, 'admin', 'admin', $7, $8)`,
			[
				input.id,
				input.organizationId ?? ORG,
				input.entity ?? "employee",
				input.name,
				input.type ?? "text",
				input.tracked ?? false,
				input.position,
				input.archived ? new Date() : null,
			],
		);
	}

	async function textValue(fieldId: string, employeeId: string, value: string, validFrom?: string) {
		await admin.query(
			`insert into custom_field_value
			 (organization_id, definition_id, employee_id, text_value, valid_from, tracked)
			 values ($1, $2, $3, $4, $5, $6)`,
			[ORG, fieldId, employeeId, value, validFrom ?? null, validFrom !== undefined],
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

	async function activateCollection() {
		await admin.query(
			`insert into payroll_work_collection_control (organization_id, mode) values ($1, 'active')
			 on conflict (organization_id) do update set mode = 'active', updated_at = now()`,
			[ORG],
		);
	}

	async function seed() {
		await cleanup();
		const timestamp = new Date("2026-01-01T00:00:00Z");
		await admin.query(
			`insert into organization (id, name, slug, timezone, created_at) values
			 ($1, 'T821', $1, 'Europe/Berlin', $3), ($2, 'T821 other', $2, 'UTC', $3)`,
			[ORG, OTHER_ORG, timestamp],
		);
		await admin.query(
			`insert into "user" (id, name, email, created_at, updated_at)
			 select user_id, user_id, user_id || '@example.test', $2, $2 from unnest($1::text[]) as user_id`,
			[users, timestamp],
		);
		await admin.query(
			`insert into member (id, organization_id, user_id, role, status, created_at) values
			 ('t821-m-owner', $1, $2, 'owner', 'approved', $5),
			 ('t821-m-worker', $1, $3, 'member', 'approved', $5),
			 ('t821-m-peer', $1, $4, 'member', 'approved', $5)`,
			[ORG, ids.ownerUser, ids.workerUser, ids.peerUser, timestamp],
		);
		await admin.query(
			`insert into employee (id, user_id, organization_id, role, employee_number, updated_at) values
			 ($1, $2, $9, 'admin', 'OWN-1', $10), ($3, $4, $9, 'employee', 'WRK-1', $10),
			 ($5, $6, $9, 'employee', 'PER-1', $10), ($7, $8, $11, 'employee', 'FOR-1', $10)`,
			[
				ids.owner,
				ids.ownerUser,
				ids.worker,
				ids.workerUser,
				ids.peer,
				ids.peerUser,
				ids.foreign,
				ids.foreignUser,
				ORG,
				timestamp,
				OTHER_ORG,
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
			 ('successfactors_csv', 'SAP SuccessFactors (CSV)', '1.0.0', now()),
			 ('personio', 'Personio', '1.0', now())
			 on conflict (id) do nothing`,
		);
		await admin.query(
			`insert into payroll_access_grant (organization_id, payroll_employee_id, scope, created_by, updated_at)
			 values ($1, $2, 'all', $3, now())`,
			[ORG, ids.owner, ids.ownerUser],
		);
		await field({ id: ids.payrollId, name: "Payroll ID", position: 0 });
		await field({ id: ids.trackedId, name: "Lohn-ID", tracked: true, position: 1 });
		await field({ id: ids.numberId, name: "Badge", type: "number", position: 2 });
		await field({ id: ids.dateField, name: "Joined", type: "date", position: 3 });
		await field({ id: ids.projectField, entity: "project", name: "PO", position: 0 });
		await field({ id: ids.archivedField, name: "Old ID", position: 4, archived: true });
		await field({ id: ids.foreignField, organizationId: OTHER_ORG, name: "X", position: 0 });
	}

	beforeEach(async () => {
		harness.personioAttendances.length = 0;
		harness.personioStrategies.length = 0;
		await seed();
		await activateCollection();
	});

	afterAll(cleanup);

	async function createJuly(formatId = "datev_lohn") {
		return createExportJob({
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
	}

	async function exportJuly(formatId = "datev_lohn") {
		const { jobId } = await createJuly(formatId);
		const { result } = await processExportJob({ jobId, organizationId: ORG });
		return { jobId, content: String(result?.content ?? "") };
	}

	async function storedInput(jobId: string) {
		const { rows } = await admin.query(
			"select version, digest, input from payroll_export_work_input where job_id = $1",
			[jobId],
		);
		return rows[0] as { version: number; digest: string; input: Record<string, unknown> };
	}

	it("writes a text field's value as DATEV Personalnummer and freezes it in version 2 input", async () => {
		await configure("datev_lohn", byField(ids.payrollId));
		await textValue(ids.payrollId, ids.worker, "LG-0042");
		await textValue(ids.payrollId, ids.peer, "LG-0007");
		await approvedWork(ids.worker, "2026-07-10");
		await approvedWork(ids.peer, "2026-07-11", "09:00", "10:00");

		const { jobId, content } = await exportJuly();

		expect(content).toContain('"LG-0042";"1000";4.00;');
		expect(content).toContain('"LG-0007";"1000";1.00;');
		expect(content).not.toContain("WRK-1");
		const stored = await storedInput(jobId);
		expect(stored.version).toBe(2);
		expect(stored.input.personnelIdentifier).toEqual({
			customFieldId: ids.payrollId,
			asOf: "2026-07-31",
			values: { [ids.worker]: "LG-0042", [ids.peer]: "LG-0007" },
		});
		expect(payrollWorkInputDigest(stored.input as never)).toBe(stored.digest);
	});

	it("exports a tracked identifier as of the period's last day", async () => {
		await configure("datev_lohn", byField(ids.trackedId));
		await textValue(ids.trackedId, ids.worker, "OLD-1", "2026-06-01");
		await textValue(ids.trackedId, ids.worker, "MID-2", "2026-07-20");
		await textValue(ids.trackedId, ids.worker, "NEXT-3", "2026-08-01");
		await approvedWork(ids.worker, "2026-07-10");

		const { content } = await exportJuly();

		expect(content).toContain('"MID-2";"1000";4.00;');
		expect(content).not.toMatch(/OLD-1|NEXT-3/);
	});

	it("writes a number field's value as SuccessFactors user ID", async () => {
		await configure("successfactors_csv", {
			employeeMatchStrategy: "customField",
			employeeMatchCustomFieldId: ids.numberId,
		});
		await admin.query(
			`insert into custom_field_value (organization_id, definition_id, employee_id, number_value)
			 values ($1, $2, $3, 4711.50)`,
			[ORG, ids.numberId, ids.worker],
		);
		await approvedWork(ids.worker, "2026-07-10");

		const { content } = await exportJuly("successfactors_csv");

		expect(content).toContain('"4711.5";"2026-07-10"');
	});

	it("matches Personio attendances by the frozen value", async () => {
		await configure("personio", {
			employeeMatchStrategy: "customField",
			employeeMatchCustomFieldId: ids.payrollId,
		});
		await textValue(ids.payrollId, ids.worker, "LG-0042");
		await approvedWork(ids.worker, "2026-07-10");

		const { jobId } = await createJuly("personio");
		const { apiResult } = await processExportJob({ jobId, organizationId: ORG });

		expect(apiResult?.success).toBe(true);
		expect(harness.personioAttendances.map((request) => request.employee)).toEqual(["LG-0042"]);
		expect(harness.personioStrategies).toEqual(["customField"]);
	});

	it("re-delivers a collected run with the frozen value after the value changed", async () => {
		await configure("datev_lohn", byField(ids.payrollId));
		await textValue(ids.payrollId, ids.worker, "LG-0042");
		await approvedWork(ids.worker, "2026-07-10");
		const { jobId } = await createJuly();

		await admin.query(
			"update custom_field_value set text_value = 'CHANGED' where definition_id = $1 and employee_id = $2",
			[ids.payrollId, ids.worker],
		);
		const first = await processExportJob({ jobId, organizationId: ORG });
		const again = await processExportJob({ jobId, organizationId: ORG });

		for (const run of [first, again]) {
			expect(String(run.result?.content)).toContain('"LG-0042";"1000";4.00;');
			expect(String(run.result?.content)).not.toContain("CHANGED");
		}
	});

	it("recovers a version 1 input with the employee number", async () => {
		await configure("datev_lohn", { ...DATEV, personnelNumberType: "employeeNumber" });
		await approvedWork(ids.worker, "2026-07-10");
		const { jobId } = await createJuly();
		const v2 = await storedInput(jobId);

		// The same job as collected before #821: a version 1 input without an identifier.
		const { personnelIdentifier: _none, digest: _digest, ...facts } = v2.input;
		const v1 = { ...facts, version: 1 };
		const v1Input = { ...v1, digest: payrollWorkInputDigest(v1 as never) };
		const { rows } = await admin.query<{ id: string }>(
			`insert into payroll_export_job (organization_id, config_id, requested_by_id, filters, is_async, status)
			 select organization_id, config_id, requested_by_id, filters, is_async, 'pending'
			 from payroll_export_job where id = $1 returning id`,
			[jobId],
		);
		const v1JobId = rows[0]?.id as string;
		await admin.query(
			`insert into payroll_export_work_input (job_id, organization_id, version, digest, work_count, input)
			 values ($1, $2, 1, $3, $4, $5::jsonb)`,
			[v1JobId, ORG, v1Input.digest, (v1Input.work as unknown[]).length, JSON.stringify(v1Input)],
		);

		const { result } = await processExportJob({ jobId: v1JobId, organizationId: ORG });

		expect(String(result?.content)).toContain('"WRK-1";"1000";4.00;');
	});

	it("refuses to recover a run collected before the configuration named a custom field", async () => {
		await configure("datev_lohn", { ...DATEV, personnelNumberType: "employeeNumber" });
		await approvedWork(ids.worker, "2026-07-10");
		const { jobId } = await createJuly();
		await textValue(ids.payrollId, ids.worker, "LG-0042");
		await configure("datev_lohn", byField(ids.payrollId));

		await expect(processExportJob({ jobId, organizationId: ORG })).rejects.toBeInstanceOf(
			PayrollIdentifierChangedError,
		);
	});

	it("reports employees without a value as missing identifier and never falls back", async () => {
		await configure("datev_lohn", byField(ids.payrollId));
		await textValue(ids.payrollId, ids.peer, "LG-0007");
		await approvedWork(ids.worker, "2026-07-10");
		await approvedWork(ids.peer, "2026-07-11");

		const refusal = await createJuly().catch((error: unknown) => error);

		expect(refusal).toBeInstanceOf(PayrollWorkCollectionBlockedError);
		expect(
			(refusal as InstanceType<typeof PayrollWorkCollectionBlockedError>).blockers.map(
				(blocker) => [blocker.kind, blocker.employeeId, blocker.sourceId],
			),
		).toEqual([["missing_identifier", ids.worker, ids.payrollId]]);

		actAs(ids.ownerUser);
		const result = await startScopedPayrollExportAction({ ...july, formatId: "datev_lohn" });
		expect(result).toEqual({
			success: false,
			error:
				"Export blocked: some employees have no value for the custom field used as payroll identifier",
			code: "ConflictError",
		});
		const { rows } = await admin.query(
			"select count(*)::int as jobs from payroll_export_job where organization_id = $1",
			[ORG],
		);
		expect(rows[0]?.jobs).toBe(0);
	});

	it("reads the value at processing without scoped collection and refuses a missing one", async () => {
		await admin.query("delete from payroll_work_collection_control where organization_id = $1", [
			ORG,
		]);
		await configure("datev_lohn", byField(ids.trackedId));
		await textValue(ids.trackedId, ids.worker, "MID-2", "2026-07-20");
		await textValue(ids.trackedId, ids.worker, "NEXT-3", "2026-08-01");
		await approvedWork(ids.worker, "2026-07-10");

		const { content } = await exportJuly();
		expect(content).toContain('"MID-2";"1000";4.00;');

		await approvedWork(ids.peer, "2026-07-11");
		const { jobId } = await createJuly();
		await expect(processExportJob({ jobId, organizationId: ORG })).rejects.toBeInstanceOf(
			PayrollIdentifierMissingError,
		);
		const { rows } = await admin.query("select status from payroll_export_job where id = $1", [
			jobId,
		]);
		expect(rows[0]?.status).toBe("failed");
	});

	it("refuses to archive a field a configuration uses, naming the configuration", async () => {
		await configure("datev_lohn", byField(ids.payrollId));
		await configure("personio", {
			employeeMatchStrategy: "customField",
			employeeMatchCustomFieldId: ids.payrollId,
		});
		const archive = { kind: "archive", fieldId: ids.payrollId };

		await expect(
			changeCustomFields(db, {
				organizationId: ORG,
				actorUserId: ids.ownerUser,
				change: archive,
				archiveGuards: [payrollIdentifierArchiveGuard],
			}),
		).resolves.toEqual({
			ok: false,
			reason: "used_as_payroll_identifier",
			configurations: ["DATEV Lohn & Gehalt", "Personio"],
		});

		await configure("datev_lohn", { ...DATEV, personnelNumberType: "employeeNumber" });
		await configure("personio", { employeeMatchStrategy: "email" });
		await expect(
			changeCustomFields(db, {
				organizationId: ORG,
				actorUserId: ids.ownerUser,
				change: archive,
				archiveGuards: [payrollIdentifierArchiveGuard],
			}),
		).resolves.toMatchObject({ ok: true });
	});

	it("saves only active employee text or number fields of the organization as identifier", async () => {
		expect(await listPayrollIdentifierFields(db, ORG)).toEqual([
			{ id: ids.payrollId, name: "Payroll ID", type: "text" },
			{ id: ids.trackedId, name: "Lohn-ID", type: "text" },
			{ id: ids.numberId, name: "Badge", type: "number" },
		]);
		const save = (config: Record<string, unknown>) =>
			savePayrollExportConfig(db, {
				organizationId: ORG,
				formatId: "datev_lohn",
				config,
				actorUserId: ids.ownerUser,
			});

		for (const fieldId of [
			ids.dateField,
			ids.projectField,
			ids.archivedField,
			ids.foreignField,
			"not-a-uuid",
		]) {
			await expect(save(byField(fieldId))).resolves.toEqual({
				ok: false,
				reason: "invalid_identifier_field",
			});
		}
		await expect(save(byField(ids.numberId))).resolves.toMatchObject({
			ok: true,
			config: { config: byField(ids.numberId) },
		});
		const switched = await save({
			...DATEV,
			personnelNumberType: "employeeNumber",
			personnelNumberCustomFieldId: ids.numberId,
		});
		expect(switched).toMatchObject({ ok: true });
		expect(switched.ok && switched.config.config).toEqual({
			...DATEV,
			personnelNumberType: "employeeNumber",
		});
	});
});
