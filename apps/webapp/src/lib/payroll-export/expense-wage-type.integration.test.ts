import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
	createLifecycleDatabaseFixture,
	type LifecycleDatabaseFixture,
} from "@/lib/employee-lifecycle/testing/database.test.fixture";
import { PAYROLL_LINE_KINDS } from "@/lib/travel-expenses/payroll-line-kind";
import {
	getExpenseWageTypeMappings,
	resolveExpenseWageType,
	saveExpenseWageTypeMapping,
} from "./expense-wage-type";
import { EMPTY_EXPENSE_WAGE_TYPE_CODES } from "./expense-wage-type.types";

describe("expense wage types on PostgreSQL (#851)", () => {
	let fixture: LifecycleDatabaseFixture;
	beforeAll(async () => {
		fixture = await createLifecycleDatabaseFixture();
	});
	afterAll(async () => {
		await fixture?.close();
	});

	async function audits(organizationId: string) {
		const { rows } = await fixture.pool.query<{ changes: string; performed_by: string }>(
			`select changes, performed_by from audit_log
			 where organization_id = $1 and action = 'payroll_export.expense_wage_type_changed'
			 order by timestamp`,
			[organizationId],
		);
		return rows.map((row) => ({ by: row.performed_by, changes: JSON.parse(row.changes) }));
	}

	function save(organizationId: string, kind: unknown, codes: unknown) {
		return saveExpenseWageTypeMapping(
			{ organizationId, actorUserId: fixture.ownerUserId, kind, codes },
			{ database: fixture.db },
		);
	}

	it("starts with every kind unmapped and resolves unmapped kinds to null", async () => {
		const organizationId = await fixture.createOrganization();

		expect(await getExpenseWageTypeMappings(organizationId, { database: fixture.db })).toEqual(
			PAYROLL_LINE_KINDS.map((kind) => ({ kind, codes: EMPTY_EXPENSE_WAGE_TYPE_CODES })),
		);
		expect(
			await resolveExpenseWageType(organizationId, "datev_lohn", "per_diem_statutory", {
				database: fixture.db,
			}),
		).toBeNull();
	});

	it("sets, changes and clears one kind's codes per format, scoped to the organization, and audits each change", async () => {
		const organizationId = await fixture.createOrganization();
		const other = await fixture.createOrganization();
		const database = fixture.db;

		expect(
			await save(organizationId, "per_diem_excess", {
				datev_lohn: " 2210 ",
				lexware_lohn: "",
				sage_lohn: null,
				successfactors_csv: "PD_EXCESS",
			}),
		).toEqual({
			status: "saved",
			mapping: {
				kind: "per_diem_excess",
				codes: {
					datev_lohn: "2210",
					lexware_lohn: null,
					sage_lohn: null,
					successfactors_csv: "PD_EXCESS",
				},
			},
		});
		expect(
			await resolveExpenseWageType(organizationId, "datev_lohn", "per_diem_excess", { database }),
		).toBe("2210");
		expect(
			await resolveExpenseWageType(organizationId, "lexware_lohn", "per_diem_excess", {
				database,
			}),
		).toBeNull();
		expect(
			await resolveExpenseWageType(organizationId, "datev_lohn", "per_diem_statutory", {
				database,
			}),
		).toBeNull();
		expect(
			await resolveExpenseWageType(other, "datev_lohn", "per_diem_excess", { database }),
		).toBeNull();

		// Saving the same codes again changes and audits nothing.
		expect(
			await save(organizationId, "per_diem_excess", {
				datev_lohn: "2210",
				successfactors_csv: "PD_EXCESS",
			}),
		).toMatchObject({ status: "unchanged" });

		expect(
			await save(organizationId, "per_diem_excess", {
				datev_lohn: "2211",
				lexware_lohn: "310",
				sage_lohn: null,
				successfactors_csv: null,
			}),
		).toMatchObject({ status: "saved" });
		expect(
			await resolveExpenseWageType(organizationId, "successfactors_csv", "per_diem_excess", {
				database,
			}),
		).toBeNull();

		// Clearing every code leaves the kind unmapped.
		expect(
			await save(organizationId, "per_diem_excess", EMPTY_EXPENSE_WAGE_TYPE_CODES),
		).toMatchObject({ status: "saved" });
		const { rows } = await fixture.pool.query(
			"select 1 from payroll_expense_wage_type_mapping where organization_id = $1",
			[organizationId],
		);
		expect(rows).toEqual([]);
		expect(
			(await getExpenseWageTypeMappings(organizationId, { database })).find(
				(mapping) => mapping.kind === "per_diem_excess",
			),
		).toEqual({ kind: "per_diem_excess", codes: EMPTY_EXPENSE_WAGE_TYPE_CODES });

		expect(await audits(organizationId)).toEqual([
			{
				by: fixture.ownerUserId,
				changes: {
					payrollLineKind: "per_diem_excess",
					from: EMPTY_EXPENSE_WAGE_TYPE_CODES,
					to: {
						datev_lohn: "2210",
						lexware_lohn: null,
						sage_lohn: null,
						successfactors_csv: "PD_EXCESS",
					},
				},
			},
			{
				by: fixture.ownerUserId,
				changes: {
					payrollLineKind: "per_diem_excess",
					from: {
						datev_lohn: "2210",
						lexware_lohn: null,
						sage_lohn: null,
						successfactors_csv: "PD_EXCESS",
					},
					to: {
						datev_lohn: "2211",
						lexware_lohn: "310",
						sage_lohn: null,
						successfactors_csv: null,
					},
				},
			},
			{
				by: fixture.ownerUserId,
				changes: {
					payrollLineKind: "per_diem_excess",
					from: {
						datev_lohn: "2211",
						lexware_lohn: "310",
						sage_lohn: null,
						successfactors_csv: null,
					},
					to: EMPTY_EXPENSE_WAGE_TYPE_CODES,
				},
			},
		]);
		expect(await audits(other)).toEqual([]);
	});

	it("keeps each kind separate", async () => {
		const organizationId = await fixture.createOrganization();
		const database = fixture.db;
		await save(organizationId, "receipt_meals", { sage_lohn: "4010" });
		await save(organizationId, "mileage_statutory", { sage_lohn: "4020" });

		expect(
			await resolveExpenseWageType(organizationId, "sage_lohn", "receipt_meals", { database }),
		).toBe("4010");
		expect(
			await resolveExpenseWageType(organizationId, "sage_lohn", "mileage_statutory", {
				database,
			}),
		).toBe("4020");
		expect(
			await resolveExpenseWageType(organizationId, "sage_lohn", "receipt_other", { database }),
		).toBeNull();
	});

	it("stores every payroll line kind", async () => {
		const organizationId = await fixture.createOrganization();
		for (const kind of PAYROLL_LINE_KINDS) {
			expect(await save(organizationId, kind, { datev_lohn: kind })).toMatchObject({
				status: "saved",
			});
		}
		expect(await getExpenseWageTypeMappings(organizationId, { database: fixture.db })).toEqual(
			PAYROLL_LINE_KINDS.map((kind) => ({
				kind,
				codes: { ...EMPTY_EXPENSE_WAGE_TYPE_CODES, datev_lohn: kind },
			})),
		);
	});

	it("refuses unknown kinds, unknown formats and malformed codes without writing", async () => {
		const organizationId = await fixture.createOrganization();

		expect(await save(organizationId, "per_diem_tax_free", { datev_lohn: "1" })).toEqual({
			status: "invalid",
		});
		expect(await save(organizationId, "receipt_meals", { personio: "1" })).toEqual({
			status: "invalid",
		});
		expect(await save(organizationId, "receipt_meals", { datev_lohn: "x".repeat(33) })).toEqual({
			status: "invalid",
		});
		expect(await save(organizationId, "receipt_meals", { datev_lohn: "12\n34" })).toEqual({
			status: "invalid",
		});
		expect(await save(organizationId, "receipt_meals", { datev_lohn: 1234 })).toEqual({
			status: "invalid",
		});
		expect(await save(organizationId, "receipt_meals", null)).toEqual({ status: "invalid" });
		expect(await audits(organizationId)).toEqual([]);
	});

	it("rejects a kind outside the check constraint", async () => {
		const organizationId = await fixture.createOrganization();
		await expect(
			fixture.pool.query(
				"insert into payroll_expense_wage_type_mapping (organization_id, payroll_line_kind) values ($1, 'receipt_fuel')",
				[organizationId],
			),
		).rejects.toThrow(/payroll_expense_wage_type_mapping_kind_check/);
	});
});
