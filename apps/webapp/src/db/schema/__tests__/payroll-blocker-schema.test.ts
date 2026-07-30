import { existsSync, readFileSync } from "node:fs";
import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, expectTypeOf, it } from "vitest";
import { employee, payrollBlockerDismissal } from "@/db/schema";

type NewPayrollBlockerDismissal = typeof payrollBlockerDismissal.$inferInsert;

describe("payroll blocker dismissal schema", () => {
	it("exports the immutable dismissal record columns", () => {
		const config = getTableConfig(payrollBlockerDismissal);

		expect(config.columns.map((column) => column.name)).toEqual([
			"id",
			"organization_id",
			"blocker_type",
			"source_id",
			"employee_id",
			"dismissed_by_employee_id",
			"dismissed_at",
		]);
		expect(payrollBlockerDismissal.id).toMatchObject({
			hasDefault: true,
			notNull: true,
			primary: true,
		});
		expect(payrollBlockerDismissal.organizationId.notNull).toBe(true);
		expect(payrollBlockerDismissal.blockerType.notNull).toBe(true);
		expect(payrollBlockerDismissal.sourceId.notNull).toBe(true);
		expect(payrollBlockerDismissal.employeeId.notNull).toBe(true);
		expect(payrollBlockerDismissal.dismissedByEmployeeId.notNull).toBe(true);
		expect(payrollBlockerDismissal.dismissedAt).toMatchObject({
			hasDefault: true,
			notNull: true,
		});
	});

	it("types blocker values as the supported payroll blocker types", () => {
		expectTypeOf<NewPayrollBlockerDismissal["blockerType"]>().toEqualTypeOf<
			"missing_clock_out" | "pending_absence" | "pending_time_correction"
		>();
	});

	it("enforces scoped uniqueness and lookup indexes", () => {
		const config = getTableConfig(payrollBlockerDismissal);
		const indexes = config.indexes.map((index) => ({
			columns: index.config.columns.map((column) => column.name),
			name: index.config.name,
			unique: index.config.unique,
		}));
		const scopedUniqueConstraint = config.uniqueConstraints.find(
			(constraint) =>
				constraint.getName() ===
				"payrollBlockerDismissal_org_type_source_unique_idx",
		);

		expect(
			scopedUniqueConstraint?.columns.map((column) => column.name),
		).toEqual(["organization_id", "blocker_type", "source_id"]);
		expect(indexes).toEqual(
			expect.arrayContaining([
				{
					columns: ["organization_id", "employee_id"],
					name: "payrollBlockerDismissal_org_employee_idx",
					unique: false,
				},
				{
					columns: ["dismissed_by_employee_id"],
					name: "payrollBlockerDismissal_dismissedByEmployeeId_idx",
					unique: false,
				},
			]),
		);
	});

	it("scopes the subject and actor employee foreign keys to the organization", () => {
		const foreignKeys = getTableConfig(payrollBlockerDismissal).foreignKeys.map(
			(foreignKey) => {
				const reference = foreignKey.reference();

				return {
					columns: reference.columns.map((column) => column.name),
					foreignColumns: reference.foreignColumns.map((column) => column.name),
					foreignTable: reference.foreignTable,
					onDelete: foreignKey.onDelete,
				};
			},
		);

		expect(foreignKeys).toEqual(
			expect.arrayContaining([
				{
					columns: ["employee_id", "organization_id"],
					foreignColumns: ["id", "organization_id"],
					foreignTable: employee,
					onDelete: "cascade",
				},
				{
					columns: ["dismissed_by_employee_id", "organization_id"],
					foreignColumns: ["id", "organization_id"],
					foreignTable: employee,
					onDelete: "cascade",
				},
			]),
		);
	});

	it("creates the matching SQL table and constraints", () => {
		const migration = readFileSync(
			"drizzle/0056_payroll_blocker_dismissal.sql",
			"utf8",
		);

		expect(migration).toContain(
			'CREATE TABLE IF NOT EXISTS "payroll_blocker_dismissal"',
		);
		expect(migration).toContain('"blocker_type" text NOT NULL');
		expect(migration).toContain(
			'UNIQUE ("organization_id","blocker_type","source_id")',
		);
		expect(migration).toContain(
			'FOREIGN KEY ("employee_id","organization_id") REFERENCES "public"."employee"("id","organization_id") ON DELETE cascade',
		);
		expect(migration).toContain(
			'FOREIGN KEY ("dismissed_by_employee_id","organization_id") REFERENCES "public"."employee"("id","organization_id") ON DELETE cascade',
		);
		expect(migration).toContain(
			"CHECK (\"blocker_type\" IN ('missing_clock_out', 'pending_absence', 'pending_time_correction'))",
		);
		expect(migration).toContain(
			'CREATE INDEX IF NOT EXISTS "payrollBlockerDismissal_org_employee_idx"',
		);
		expect(migration).toContain(
			'CREATE INDEX IF NOT EXISTS "payrollBlockerDismissal_dismissedByEmployeeId_idx"',
		);
	});

	it("registers migration 0056 after every predecessor", () => {
		const journal = JSON.parse(
			readFileSync("drizzle/meta/_journal.json", "utf8"),
		) as {
			entries: Array<{
				breakpoints: boolean;
				idx: number;
				tag: string;
				version: string;
				when: number;
			}>;
		};
		const migrationIndex = journal.entries.findIndex(
			(entry) => entry.tag === "0056_payroll_blocker_dismissal",
		);
		const migrationEntry = journal.entries[migrationIndex];
		const latestPriorWhen = Math.max(
			...journal.entries.slice(0, migrationIndex).map((entry) => entry.when),
		);

		expect(migrationIndex).toBe(journal.entries.length - 1);
		expect(migrationEntry).toMatchObject({
			breakpoints: true,
			idx: 56,
			tag: "0056_payroll_blocker_dismissal",
			version: "7",
		});
		expect(migrationEntry?.when).toBeGreaterThan(latestPriorWhen);
	});

	it("snapshots the dismissal table after snapshot 0055", () => {
		const snapshotPath = "drizzle/meta/0056_snapshot.json";

		expect(existsSync(snapshotPath)).toBe(true);
		if (!existsSync(snapshotPath)) return;

		const previousSnapshot = JSON.parse(
			readFileSync("drizzle/meta/0055_snapshot.json", "utf8"),
		) as { id: string };
		const snapshot = JSON.parse(readFileSync(snapshotPath, "utf8")) as {
			prevId: string;
			tables: Record<
				string,
				{
					columns: Record<string, { type: string; notNull: boolean }>;
					foreignKeys: Record<
						string,
						{
							columnsFrom: string[];
							columnsTo: string[];
							onDelete: string;
							tableTo: string;
						}
					>;
					name: string;
					uniqueConstraints: Record<string, { columns: string[] }>;
				}
			>;
		};
		const table = snapshot.tables["public.payroll_blocker_dismissal"];

		expect(snapshot.prevId).toBe(previousSnapshot.id);
		expect(table?.name).toBe("payroll_blocker_dismissal");
		expect(table?.columns).toMatchObject({
			blocker_type: { notNull: true, type: "text" },
			dismissed_by_employee_id: { notNull: true, type: "uuid" },
			employee_id: { notNull: true, type: "uuid" },
			organization_id: { notNull: true, type: "text" },
			source_id: { notNull: true, type: "uuid" },
		});
		expect(
			table?.uniqueConstraints
				.payrollBlockerDismissal_org_type_source_unique_idx?.columns,
		).toEqual(["organization_id", "blocker_type", "source_id"]);
		expect(Object.values(table?.foreignKeys ?? {})).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					columnsFrom: ["employee_id", "organization_id"],
					columnsTo: ["id", "organization_id"],
					onDelete: "cascade",
					tableTo: "employee",
				}),
				expect.objectContaining({
					columnsFrom: ["dismissed_by_employee_id", "organization_id"],
					columnsTo: ["id", "organization_id"],
					onDelete: "cascade",
					tableTo: "employee",
				}),
			]),
		);
	});
});
