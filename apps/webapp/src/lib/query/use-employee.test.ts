import { describe, expect, expectTypeOf, it } from "vitest";
import { queryKeys } from "./keys";
import type { useEmployee } from "./use-employee";

describe("useEmployee contracts", () => {
	it("exposes a stable employment history query key", () => {
		expect(queryKeys.employees.employmentHistory("employee-1")).toEqual([
			"employees",
			"detail",
			"employee-1",
			"employment-history",
		]);
	});

	it("returns employment history query and mutation helpers", () => {
		type UseEmployeeResult = ReturnType<typeof useEmployee>;

		expectTypeOf<UseEmployeeResult>().toHaveProperty("employmentHistory");
		expectTypeOf<UseEmployeeResult>().toHaveProperty("isLoadingEmploymentHistory");
		expectTypeOf<UseEmployeeResult>().toHaveProperty("createEmploymentHistory");
		expectTypeOf<UseEmployeeResult>().toHaveProperty("isCreatingEmploymentHistory");
		expectTypeOf<UseEmployeeResult>().toHaveProperty("confirmEmploymentHistory");
		expectTypeOf<UseEmployeeResult>().toHaveProperty("isConfirmingEmploymentHistory");
		expectTypeOf<UseEmployeeResult>().toHaveProperty("cancelEmploymentHistory");
		expectTypeOf<UseEmployeeResult>().toHaveProperty("isCancelingEmploymentHistory");
	});
});
