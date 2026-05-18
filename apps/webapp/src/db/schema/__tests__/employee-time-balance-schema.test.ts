import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { employee } from "../organization";
import { employeeTimeBalance } from "../time-tracking";

describe("employee time balance schema", () => {
	it("defines organization-scoped yearly balance columns", () => {
		expect(employeeTimeBalance.organizationId.name).toBe("organization_id");
		expect(employeeTimeBalance.employeeId.name).toBe("employee_id");
		expect(employeeTimeBalance.year.name).toBe("year");
		expect(employeeTimeBalance.actualMinutes.name).toBe("actual_minutes");
		expect(employeeTimeBalance.expectedMinutes.name).toBe("expected_minutes");
		expect(employeeTimeBalance.absenceAdjustedMinutes.name).toBe("absence_adjusted_minutes");
		expect(employeeTimeBalance.balanceMinutes.name).toBe("balance_minutes");
		expect(employeeTimeBalance.calculatedAt.name).toBe("calculated_at");
	});

	it("enforces employee and organization consistency", () => {
		const foreignKeys = getTableConfig(employeeTimeBalance).foreignKeys.map((foreignKey) =>
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
});
