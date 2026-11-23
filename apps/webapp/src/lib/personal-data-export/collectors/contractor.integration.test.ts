/**
 * #2001 (spec #1935): a personal data export of someone who was an External Contractor and is now
 * an employee, against a disposable PostgreSQL database. The collectors are called the way the
 * export worker calls them, once per export kind.
 *
 * The contractor's own engagement is theirs in both exports, like an employee's own wage
 * (Organization ADR 0003): the engagement kind of the person and of each employment period, the
 * contracting details (company, VAT ID, PO reference) and the effective-dated contractor
 * compensation terms. The organization's pricing stays withheld from the employee export:
 * billable rates, cost rates and the audit entries about the contractor terms, which only the
 * admin export holds.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { integrationAdminPool } from "@/test/integration-database";
import type {
	CollectedCategory,
	PersonalDataExportScope,
	PersonalDataRow,
	PersonalDataTablePart,
} from "../collector";

const { db } = await import("@/db");
const { employmentCollector } = await import("./employment");
const { auditLogCollector } = await import("./audit-log");
const { changeContractorTerms } = await import("@/lib/contractor-compensation/store");
const { saveContractorProfile } = await import("@/lib/engagement/contractor-profile");

const ORG = "t2001p-org";
const ids = {
	kim: "20010000-0000-4000-8000-000000000001",
	owner: "20010000-0000-4000-8000-000000000002",
	contractorPeriod: "20010000-0000-4000-8000-000000000011",
	employeePeriod: "20010000-0000-4000-8000-000000000012",
	project: "20010000-0000-4000-8000-000000000021",
} as const;

const admin = integrationAdminPool();

async function cleanup() {
	await admin.query("delete from audit_log where organization_id = $1", [ORG]);
	await admin.query("delete from organization where id = $1", [ORG]);
	await admin.query('delete from "user" where id like $1', ["t2001p-%"]);
}

function scopeOf(kind: PersonalDataExportScope["kind"]): PersonalDataExportScope {
	return { organizationId: ORG, employeeId: ids.kim, userId: "t2001p-kim", kind };
}

function part(category: CollectedCategory, key: string) {
	return category.parts.find((candidate) => candidate.key === key);
}

function table(category: CollectedCategory, key: string): PersonalDataRow[] {
	const found = part(category, key);
	if (found?.kind !== "table") throw new Error(`no table part ${key}`);
	return found.rows;
}

function record(category: CollectedCategory, key: string): PersonalDataRow | null {
	const found = part(category, key);
	if (found?.kind !== "record") throw new Error(`no record part ${key}`);
	return found.record;
}

async function setTerms(effectiveFrom: string, compensation: Record<string, unknown>) {
	const outcome = await changeContractorTerms(db, {
		organizationId: ORG,
		actorUserId: "t2001p-owner",
		employeeId: ids.kim,
		change: { kind: "set", effectiveFrom, compensation: compensation as never },
	});
	if (!outcome.ok) throw new Error(outcome.reason);
}

describe("personal data export of a former External Contractor (#2001)", () => {
	let employeeExport: CollectedCategory;
	let adminExport: CollectedCategory;

	beforeAll(async () => {
		await cleanup();
		await admin.query(
			`insert into organization (id, name, slug, timezone, created_at)
			 values ($1, 'Acme GmbH', $1, 'Europe/Berlin', now())`,
			[ORG],
		);
		await admin.query(
			`insert into "user" (id, name, email, created_at, updated_at) values
			 ('t2001p-kim', 'Kim Convert', 't2001p-kim@example.test', now(), now()),
			 ('t2001p-owner', 'Olga Owner', 't2001p-owner@example.test', now(), now())`,
		);
		await admin.query(
			`insert into employee (id, user_id, organization_id, role, is_active, engagement_kind, updated_at) values
			 ($1, 't2001p-kim', $3, 'employee', true, 'contractor', now()),
			 ($2, 't2001p-owner', $3, 'admin', true, 'employee', now())`,
			[ids.kim, ids.owner, ORG],
		);
		await admin.query(
			`insert into employee_employment_period
			 (id, organization_id, employee_id, status, started_at, start_provenance, engagement_kind)
			 values ($1, $2, $3, 'open', '2026-01-01T00:00:00Z', 'recorded', 'contractor')`,
			[ids.contractorPeriod, ORG, ids.kim],
		);

		// The contractor engagement: details and two terms through the real writers.
		await saveContractorProfile(db, {
			organizationId: ORG,
			employeeId: ids.kim,
			details: { companyName: "Kim Consulting", vatId: "DE123456789", referenceCode: "PO-7" },
			updatedBy: "t2001p-owner",
		});
		await setTerms("2026-01-01", { basis: "hourly", rateAmount: "85", currency: "EUR" });
		await setTerms("2026-03-01", {
			basis: "daily",
			rateAmount: "640",
			currency: "EUR",
			dayUnitRule: "half_and_full_day",
			halfDayThresholdMinutes: 240,
		});

		// Converted: the contractor period ends, an employee period starts.
		await admin.query(
			`update employee_employment_period set status = 'closed', ended_at = '2026-04-01T00:00:00Z'
			 where id = $1`,
			[ids.contractorPeriod],
		);
		await admin.query(
			`insert into employee_employment_period
			 (id, organization_id, employee_id, status, started_at, start_provenance, engagement_kind)
			 values ($1, $2, $3, 'open', '2026-04-01T00:00:00Z', 'recorded', 'employee')`,
			[ids.employeePeriod, ORG, ids.kim],
		);
		await admin.query(`update employee set engagement_kind = 'employee' where id = $1`, [ids.kim]);

		// The organization's pricing of Kim's work.
		await admin.query(
			`insert into project (id, organization_id, name, status, created_by, updated_at)
			 values ($1, $2, 'Website', 'active', 't2001p-owner', now())`,
			[ids.project, ORG],
		);
		await admin.query(
			`insert into billable_rate (organization_id, level, project_id, employee_id, hourly_rate, effective_from)
			 values ($1, 'employee_project', $2, $3, 150.00, '2026-01-01')`,
			[ORG, ids.project, ids.kim],
		);
		await admin.query(
			`insert into cost_rate (organization_id, employee_id, hourly_rate, effective_from)
			 values ($1, $2, 55.00, '2026-04-01')`,
			[ORG, ids.kim],
		);

		employeeExport = await employmentCollector.collect(db, scopeOf("employee"));
		adminExport = await employmentCollector.collect(db, scopeOf("admin"));
	});

	afterAll(cleanup);

	it("names the engagement kind of the person and of each employment period in both exports", () => {
		for (const category of [employeeExport, adminExport]) {
			expect(record(category, "employee")).toMatchObject({ engagement_kind: "employee" });
			expect(
				table(category, "employment_periods").map((row) => [row.id, row.engagement_kind]),
			).toEqual([
				[ids.contractorPeriod, "contractor"],
				[ids.employeePeriod, "employee"],
			]);
		}
	});

	it("gives the contractor their own contracting details in both exports", () => {
		for (const category of [employeeExport, adminExport]) {
			expect(record(category, "contractor_details")).toMatchObject({
				company_name: "Kim Consulting",
				vat_id: "DE123456789",
				reference_code: "PO-7",
				updated_by: "Olga Owner",
			});
		}
	});

	it("gives the contractor their own compensation terms in both exports", () => {
		for (const category of [employeeExport, adminExport]) {
			expect(
				table(category, "contractor_compensation_terms").map((row) => ({
					employment_period_id: row.employment_period_id,
					compensation_basis: row.compensation_basis,
					rate: row.rate,
					currency: row.currency,
					day_unit_rule: row.day_unit_rule,
					half_day_threshold_minutes: row.half_day_threshold_minutes,
					standard_day_minutes: row.standard_day_minutes,
					cap_at_one_day: row.cap_at_one_day,
					effective_from: row.effective_from,
					effective_to: row.effective_to,
					created_by: row.created_by,
				})),
			).toEqual([
				{
					employment_period_id: ids.contractorPeriod,
					compensation_basis: "hourly",
					rate: "85.00",
					currency: "EUR",
					day_unit_rule: null,
					half_day_threshold_minutes: null,
					standard_day_minutes: null,
					cap_at_one_day: null,
					effective_from: "2026-01-01",
					effective_to: "2026-03-01",
					created_by: "Olga Owner",
				},
				{
					employment_period_id: ids.contractorPeriod,
					compensation_basis: "daily",
					rate: "640.00",
					currency: "EUR",
					day_unit_rule: "half_and_full_day",
					half_day_threshold_minutes: 240,
					standard_day_minutes: null,
					cap_at_one_day: null,
					effective_from: "2026-03-01",
					effective_to: null,
					created_by: "Olga Owner",
				},
			]);
		}
	});

	it("withholds the organization's billable and cost rates from the employee export alone", () => {
		expect(part(employeeExport, "billable_rates")).toBeUndefined();
		expect(part(employeeExport, "cost_rates")).toBeUndefined();
		expect(
			table(adminExport, "billable_rates").map((row) => [row.level, row.project, row.hourly_rate]),
		).toEqual([["employee_project", "Website", "150.00"]]);
		expect(table(adminExport, "cost_rates").map((row) => row.hourly_rate)).toEqual(["55.00"]);
	});

	it("holds the audit entries about the contractor terms in the admin export only", async () => {
		const actionsIn = async (kind: PersonalDataExportScope["kind"]) => {
			const category = await auditLogCollector.collect(db, scopeOf(kind));
			const entries = category.parts.find((candidate) => candidate.key === "entries") as
				| PersonalDataTablePart
				| undefined;
			return (entries?.rows ?? []).map((row) => row.action);
		};

		expect(await actionsIn("admin")).toEqual(
			expect.arrayContaining(["employee.contractor_terms_set"]),
		);
		expect(await actionsIn("employee")).not.toContain("employee.contractor_terms_set");
	});
});
