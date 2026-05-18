import { describe, expect, it } from "vitest";
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
});
