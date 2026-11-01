import { randomUUID } from "node:crypto";
import { DateTime } from "luxon";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { parseInstant } from "@/lib/datetime/temporal-core";
import type { DatabaseClient } from "@/lib/effect/services/database.service";
import {
	createLifecycleDatabaseFixture,
	type LifecycleDatabaseFixture,
} from "@/lib/employee-lifecycle/testing/database.test.fixture";
import { getPayrollReadiness } from "@/lib/payroll-readiness/get-payroll-readiness";
import { resolveImplementationChecklistItems } from "../status";
import { payrollSetupGoLiveCheck } from "./checks/payroll-setup";
import type { GoLiveCheck } from "./checks/types";
import { resolveGoLiveGroup } from "./group";
import { readPayrollPrerequisites } from "./payroll-prerequisites";
import { resolveGoLiveReadiness } from "./readiness";
import { goLiveAsOf, runGoLiveChecks } from "./run";
import type { GoLiveCheckResult, GoLiveFixLinkResolver, GoLiveGroup, GoLiveMember } from "./types";

const AS_OF = goLiveAsOf(parseInstant("2026-06-15T10:00:00Z"), "Europe/Berlin");
const allowEveryLink: GoLiveFixLinkResolver = (href, label) => ({ href, label });
const DATEV = { mandantennummer: "12345", beraternummer: "1234567", includeZeroHours: false };

describe("payroll setup go-live check (PostgreSQL)", () => {
	vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
	let fixture: LifecycleDatabaseFixture;
	let db: DatabaseClient;

	async function createOrganizationWithOwner() {
		const organizationId = await fixture.createOrganization();
		const owner = await seedNamed(organizationId, "Owner", "owner");
		return { organizationId, owner };
	}

	async function seedNamed(
		organizationId: string,
		name: string,
		role: "owner" | "member" = "member",
	) {
		const seeded = await fixture.seedEmployee({ organizationId, role });
		await fixture.pool.query(`update "user" set name = $1 where id = $2`, [name, seeded.userId]);
		return seeded;
	}

	async function activeTarget(organizationId: string, config: object = DATEV) {
		await fixture.pool.query(
			`insert into payroll_export_format (id, name, version, updated_at)
			 values ('datev_lohn', 'DATEV Lohn & Gehalt', '2024.1', now()) on conflict (id) do nothing`,
		);
		await fixture.pool.query(
			`insert into payroll_export_config (organization_id, format_id, config, created_by, updated_at)
			 values ($1, 'datev_lohn', $2::jsonb, $3, now())`,
			[organizationId, JSON.stringify(config), fixture.ownerUserId],
		);
	}

	async function wageTypeMapping(organizationId: string) {
		await fixture.pool.query(
			`insert into payroll_wage_type_mapping
			 (organization_id, special_category, datev_wage_type_code, created_by, updated_at)
			 values ($1, 'overtime', '1900', $2, now())`,
			[organizationId, fixture.ownerUserId],
		);
	}

	async function confirmedTerms(
		organizationId: string,
		employee: { employeeId: string; employmentPeriodId: string },
		validFrom = "2026-01-01T00:00:00Z",
	) {
		await fixture.pool.query(
			`insert into employee_employment_history
			 (employee_id, organization_id, employment_period_id, valid_from, contract_type,
			  weekly_contract_minutes, review_state, created_by, updated_at)
			 values ($1, $2, $3, $4, 'fixed', 2400, 'confirmed', $5, now())`,
			[
				employee.employeeId,
				organizationId,
				employee.employmentPeriodId,
				validFrom,
				fixture.ownerUserId,
			],
		);
	}

	/** A text employee field used as personnel identifier, with each employee's value. */
	async function identifierField(organizationId: string, values: [string, string][]) {
		const fieldId = randomUUID();
		await fixture.pool.query(
			`insert into custom_field_definition
			 (id, organization_id, entity, name, type, tracked, visibility, edit_level, position)
			 values ($1, $2, 'employee', 'Payroll ID', 'text', false, 'admin', 'admin', 0)`,
			[fieldId, organizationId],
		);
		for (const [employeeId, value] of values) {
			await fixture.pool.query(
				`insert into custom_field_value
				 (organization_id, definition_id, employee_id, text_value, tracked)
				 values ($1, $2, $3, $4, false)`,
				[organizationId, fieldId, employeeId, value],
			);
		}
		return { ...DATEV, personnelNumberType: "customField", personnelNumberCustomFieldId: fieldId };
	}

	/** An approved absence today, so readiness's period-bound clash check sees the employee. */
	async function absenceToday(organizationId: string, employeeId: string) {
		const categoryId = randomUUID();
		const recordId = randomUUID();
		await fixture.pool.query(
			`insert into absence_category (id, organization_id, type, name, requires_work_time,
				requires_approval, counts_against_vacation, is_active, created_at, updated_at)
			 values ($1, $2, 'vacation', $3, false, true, true, true, now(), now())`,
			[categoryId, organizationId, `Vacation ${recordId.slice(0, 8)}`],
		);
		await fixture.pool.query(
			`insert into time_record (id, organization_id, employee_id, record_kind, start_at, end_at,
				approval_state, origin, created_at, created_by, updated_at)
			 values ($1, $2, $3, 'absence', '2026-06-15'::date, '2026-06-16'::date,
				'approved', 'manual', now(), $4, now())`,
			[recordId, organizationId, employeeId, fixture.ownerUserId],
		);
		await fixture.pool.query(
			`insert into time_record_absence (record_id, organization_id, record_kind, absence_category_id)
			 values ($1, $2, 'absence', $3)`,
			[recordId, organizationId, categoryId],
		);
	}

	async function run(
		organizationId: string,
		checks: readonly GoLiveCheck[] = [payrollSetupGoLiveCheck],
	) {
		const { results } = await runGoLiveChecks({
			db,
			organizationId,
			asOf: AS_OF,
			fixLink: allowEveryLink,
			checks,
		});
		const result = results.find((entry) => entry.checkId === "payroll-setup");
		if (!result) throw new Error("payroll-setup check did not run");
		return result;
	}

	function payrollItem(result: GoLiveCheckResult, manual = false) {
		return resolveImplementationChecklistItems({
			detectedCompleteIds: new Set(),
			manualCompleteIds: new Set(manual ? (["payroll-readiness"] as const) : []),
			goLiveResults: [result],
		}).find((item) => item.id === "payroll-readiness");
	}

	function memberIds(members: readonly { member: GoLiveMember }[]) {
		return members
			.map(({ member }) => (member.kind === "employee" ? member.employeeId : member.draftId))
			.sort();
	}

	beforeAll(async () => {
		fixture = await createLifecycleDatabaseFixture();
		db = fixture.db as unknown as DatabaseClient;
	});

	afterAll(async () => {
		await fixture?.close();
	});

	it("is optional and never blocks without an active payroll export target", async () => {
		const { organizationId } = await createOrganizationWithOwner();
		await seedNamed(organizationId, "Unconfirmed");
		// Another organization's target and mappings never count here.
		const elsewhere = await createOrganizationWithOwner();
		await activeTarget(elsewhere.organizationId);
		await wageTypeMapping(elsewhere.organizationId);

		const result = await run(organizationId);

		expect(result).toMatchObject({
			outcome: "passed",
			configured: false,
			severity: "advisory",
			failures: [],
			warnings: [],
		});
		if (result.outcome === "unavailable") throw new Error("unexpected");
		expect(result.notes.map((note) => note.key)).toContain(
			"settings.implementationChecklist.goLive.payrollSetup.optional",
		);
		expect(resolveGoLiveReadiness([result])).toEqual({ status: "ready", warnings: [] });
		expect(payrollItem(result)?.status).toBe("not-set-up");
	});

	it("blocks with a missing wage-type mapping or a personnel-number clash, matching payroll readiness", async () => {
		const { organizationId, owner } = await createOrganizationWithOwner();
		await confirmedTerms(organizationId, owner);
		const anna = await seedNamed(organizationId, "Anna");
		const ben = await seedNamed(organizationId, "Ben");
		const cleo = await seedNamed(organizationId, "Cleo");
		await confirmedTerms(organizationId, anna);
		await confirmedTerms(organizationId, ben);
		// Cleo's terms only start tomorrow: none cover today.
		await confirmedTerms(organizationId, cleo, "2026-06-16T00:00:00Z");
		const config = await identifierField(organizationId, [
			[anna.employeeId, "LG-7"],
			[ben.employeeId, "lg-7"],
			[cleo.employeeId, "LG-8"],
		]);
		await activeTarget(organizationId, config);
		for (const member of [owner, anna, ben, cleo]) {
			await absenceToday(organizationId, member.employeeId);
		}
		const elsewhere = await createOrganizationWithOwner();
		await seedNamed(elsewhere.organizationId, "Outsider");

		const result = await run(organizationId);

		expect(result).toMatchObject({ outcome: "failed", configured: true, severity: "mandatory" });
		if (result.outcome === "unavailable") throw new Error("unexpected");
		// Period-bound payroll readiness checks never appear.
		expect(result.failures.map((failure) => failure.cause).sort()).toEqual([
			"payroll-setup:personnel-identifiers",
			"payroll-setup:wage-type-mappings",
		]);
		expect(result.warnings.map((warning) => warning.cause)).toEqual([
			"payroll-setup:employment-terms",
		]);
		const mappings = result.failures.find(
			(failure) => failure.cause === "payroll-setup:wage-type-mappings",
		);
		const clashes = result.failures.find(
			(failure) => failure.cause === "payroll-setup:personnel-identifiers",
		);
		const terms = result.warnings[0];
		expect(memberIds(mappings?.members ?? [])).toEqual(
			[owner.employeeId, anna.employeeId, ben.employeeId, cleo.employeeId].sort(),
		);
		expect(mappings?.fix?.href).toBe("/settings/payroll-export");
		expect(memberIds(clashes?.members ?? [])).toEqual([anna.employeeId, ben.employeeId].sort());
		expect(
			clashes?.members.find(
				({ member }) => member.kind === "employee" && member.employeeId === anna.employeeId,
			)?.detail,
		).toMatchObject({ params: { identifier: "LG-7", others: "Ben" } });
		expect(memberIds(terms?.members ?? [])).toEqual([cleo.employeeId]);
		expect(resolveGoLiveReadiness([result])).toMatchObject({
			status: "not-ready",
			affectedMemberCount: 4,
		});

		// The same organization's own payroll readiness setup checks agree.
		const today = DateTime.fromISO("2026-06-15", { zone: "utc" });
		const readiness = await getPayrollReadiness({
			organizationId,
			period: { start: today, end: today },
			now: DateTime.fromISO("2026-06-15T10:00:00Z"),
		});
		const check = (id: string) =>
			readiness.groups.flatMap((group) => group.checks).find((entry) => entry.id === id);
		expect(check("payroll-export-targets")?.status).toBe("pass");
		expect(check("wage-type-mappings")?.status).toBe("fail");
		expect(
			check("duplicate-personnel-identifiers")
				?.affectedEmployees.map(({ id }) => id)
				.sort(),
		).toEqual(memberIds(clashes?.members ?? []));
		expect(check("missing-employment-history")?.affectedEmployees.map(({ id }) => id)).toEqual(
			memberIds(terms?.members ?? []),
		);
	});

	it("keeps a manual confirmation without ever verifying from it", async () => {
		const { organizationId } = await createOrganizationWithOwner();
		await activeTarget(organizationId);

		const result = await run(organizationId);

		expect(payrollItem(result, true)).toMatchObject({
			status: "needs-attention",
			completionSource: "manual",
			countsTowardProgress: false,
		});
	});

	it("verifies when every setup check passes for the group", async () => {
		const { organizationId, owner } = await createOrganizationWithOwner();
		await confirmedTerms(organizationId, owner);
		await activeTarget(organizationId);
		await wageTypeMapping(organizationId);

		const result = await run(organizationId);

		expect(result).toMatchObject({ outcome: "passed", configured: true, severity: "mandatory" });
		expect(payrollItem(result)?.status).toBe("verified");
		expect(resolveGoLiveReadiness([result])).toEqual({ status: "ready", warnings: [] });
	});

	it("skips invitees for per-employee prerequisites, with a note", async () => {
		const { organizationId, owner } = await createOrganizationWithOwner();
		await activeTarget(organizationId);
		await wageTypeMapping(organizationId);
		const roster = await resolveGoLiveGroup(db, organizationId, AS_OF);
		const invitee: GoLiveMember = {
			kind: "invitee",
			draftId: randomUUID(),
			email: "new@example.test",
			teamId: null,
			displayName: "New Hire",
		};
		const group: GoLiveGroup = { ...roster, members: [...roster.members, invitee] };

		const outcome = await payrollSetupGoLiveCheck.run({
			db,
			organizationId,
			asOf: AS_OF,
			group,
			fixLink: allowEveryLink,
		});

		if (outcome.outcome === "unavailable") throw new Error("unexpected");
		// The owner has no confirmed terms; the invitee is not listed for them.
		expect(memberIds(outcome.warnings.flatMap((warning) => warning.members))).toEqual([
			owner.employeeId,
		]);
		expect(outcome.notes).toContainEqual(
			expect.objectContaining({
				key: "settings.implementationChecklist.goLive.payrollSetup.inviteesSkipped",
				params: { count: 1 },
			}),
		);
		await expect(
			readPayrollPrerequisites(db, { organizationId, asOf: AS_OF, member: invitee }),
		).resolves.toMatchObject({
			mandatory: true,
			wageTypeMappings: "present",
			employmentTerms: "not-applicable",
			personnelIdentifier: { status: "not-applicable" },
		});
	});

	it("reads one member's payroll prerequisites against the group", async () => {
		const { organizationId, owner } = await createOrganizationWithOwner();
		const anna = await seedNamed(organizationId, "Anna");
		const ben = await seedNamed(organizationId, "Ben");
		await confirmedTerms(organizationId, anna);
		const config = await identifierField(organizationId, [
			[anna.employeeId, "LG-7"],
			[ben.employeeId, "LG-7"],
		]);
		await activeTarget(organizationId, config);
		const group = await resolveGoLiveGroup(db, organizationId, AS_OF);
		const member = group.members.find(
			(candidate) => candidate.kind === "employee" && candidate.employeeId === anna.employeeId,
		);
		if (!member) throw new Error("Anna is not in the group");

		const prerequisites = await readPayrollPrerequisites(db, {
			organizationId,
			asOf: AS_OF,
			member,
			groupEmployeeIds: [owner.employeeId, anna.employeeId, ben.employeeId],
		});

		expect(prerequisites).toEqual({
			mandatory: true,
			exportTargetCount: 1,
			wageTypeMappings: "missing",
			employmentTerms: "confirmed",
			personnelIdentifier: { status: "shared", identifier: "LG-7", sharedWith: ["Ben"] },
		});
	});

	it("is unavailable, never passing, when a payroll readiness lookup fails", async () => {
		const { organizationId } = await createOrganizationWithOwner();
		await activeTarget(organizationId, await identifierField(organizationId, []));
		await wageTypeMapping(organizationId);
		const failingClashLookup = new Proxy(db, {
			get(target, property, receiver) {
				if (property === "select") throw new Error("lookup failed");
				return Reflect.get(target, property, receiver);
			},
		});
		const failingTargetLookup = new Proxy(db, {
			get(target, property, receiver) {
				if (property === "query") throw new Error("lookup failed");
				return Reflect.get(target, property, receiver);
			},
		});

		for (const broken of [failingClashLookup, failingTargetLookup]) {
			const result = await run(organizationId, [
				{
					...payrollSetupGoLiveCheck,
					run: (context) => payrollSetupGoLiveCheck.run({ ...context, db: broken }),
				},
			]);

			expect(result.outcome).toBe("unavailable");
			expect(resolveGoLiveReadiness([result])).toEqual({ status: "unavailable" });
			expect(payrollItem(result)?.status).toBe("unavailable");
		}
	});
});
