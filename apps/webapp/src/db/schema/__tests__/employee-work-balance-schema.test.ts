import { existsSync, readFileSync } from "node:fs";
import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { employee } from "../organization";
import { employeeWorkBalance } from "../time-tracking";

const migration0026Url = new URL(
	"../../../../drizzle/0026_employee_work_balance.sql",
	import.meta.url,
);
const migrationJournal = JSON.parse(
	readFileSync(new URL("../../../../drizzle/meta/_journal.json", import.meta.url), "utf8"),
) as { entries: Array<{ idx: number; tag: string }> };

describe("employee work balance schema", () => {
	it("defines organization-scoped all-time balance columns", () => {
		expect(employeeWorkBalance.id.name).toBe("id");
		expect(employeeWorkBalance.organizationId.name).toBe("organization_id");
		expect(employeeWorkBalance.employeeId.name).toBe("employee_id");
		expect(employeeWorkBalance.actualMinutes.name).toBe("actual_minutes");
		expect(employeeWorkBalance.requiredMinutes.name).toBe("required_minutes");
		expect(employeeWorkBalance.balanceMinutes.name).toBe("balance_minutes");
		expect(employeeWorkBalance.computedFromDate.name).toBe("computed_from_date");
		expect(employeeWorkBalance.computedThroughDate.name).toBe("computed_through_date");
		expect(employeeWorkBalance.computedAt.name).toBe("computed_at");
		expect(employeeWorkBalance.isDirty.name).toBe("is_dirty");
		expect(employeeWorkBalance.dirtyFromDate.name).toBe("dirty_from_date");
		expect(employeeWorkBalance.refreshRequestedAt.name).toBe("refresh_requested_at");
		expect(employeeWorkBalance.lastError.name).toBe("last_error");
		expect(employeeWorkBalance.createdAt.name).toBe("created_at");
		expect(employeeWorkBalance.updatedAt.name).toBe("updated_at");
	});

	it("enforces employee and organization consistency", () => {
		const foreignKeys = getTableConfig(employeeWorkBalance).foreignKeys.map((foreignKey) =>
			foreignKey.reference(),
		);

		expect(
			foreignKeys.some((reference) => {
				return (
					reference.columns.length === 2 &&
					reference.columns[0]?.name === "employee_id" &&
					reference.columns[1]?.name === "organization_id" &&
					reference.foreignColumns.length === 2 &&
					reference.foreignColumns[0]?.table === employee &&
					reference.foreignColumns[0]?.name === "id" &&
					reference.foreignColumns[1]?.table === employee &&
					reference.foreignColumns[1]?.name === "organization_id"
				);
			}),
		).toBe(true);
	});

	it("includes a migration for the all-time balance table", () => {
		expect(existsSync(migration0026Url)).toBe(true);

		const migration = readFileSync(migration0026Url, "utf8");
		expect(migration).toContain('CREATE TABLE "employee_work_balance"');
		expect(migration).toContain(
			'CREATE UNIQUE INDEX "employeeWorkBalance_org_employee_idx"',
		);
		expect(migration).toContain(
			'CREATE INDEX "employeeWorkBalance_org_idx"',
		);
		expect(migration).toContain(
			'CREATE INDEX "employeeWorkBalance_employee_org_idx"',
		);
		expect(migration).toContain(
			'CREATE INDEX "employeeWorkBalance_dirty_idx"',
		);
		expect(migration).toContain(
			'FOREIGN KEY ("employee_id","organization_id") REFERENCES "public"."employee"("id","organization_id") ON DELETE cascade',
		);
		expect(migrationJournal.entries).toContainEqual(
			expect.objectContaining({ idx: 26, tag: "0026_employee_work_balance" }),
		);
	});
});
