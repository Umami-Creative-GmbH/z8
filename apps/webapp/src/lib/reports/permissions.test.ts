import { describe, expect, it } from "vitest";
import {
	canReadReportEmployee,
	getManagerReportAccessibleEmployees,
	getReportAccessibleEmployeeIds,
} from "./permissions";

function employeeSource(overrides: {
	id: string;
	organizationId?: string;
	role?: "admin" | "manager" | "employee";
	user?: Partial<{
		firstName: string | null;
		lastName: string | null;
		name: string | null;
		email: string;
		image: string | null;
	}>;
}) {
	return {
		id: overrides.id,
		organizationId: overrides.organizationId ?? "org-1",
		pronouns: null,
		position: null,
		role: overrides.role ?? "employee",
		user: {
			firstName: null,
			lastName: null,
			name: `Name ${overrides.id}`,
			email: `${overrides.id}@example.com`,
			image: null,
			...overrides.user,
		},
	};
}

describe("getReportAccessibleEmployeeIds", () => {
	it("returns only self for employees", () => {
		expect(
			getReportAccessibleEmployeeIds({
				currentEmployeeId: "employee-1",
				role: "employee",
				managedEmployeeIds: ["employee-2"],
			}),
		).toEqual(["employee-1"]);
	});

	it("returns self and direct reports for managers", () => {
		expect(
			getReportAccessibleEmployeeIds({
				currentEmployeeId: "manager-1",
				role: "manager",
				managedEmployeeIds: ["employee-2", "employee-3"],
			}),
		).toEqual(["manager-1", "employee-2", "employee-3"]);
	});

	it("returns null for admins because the organization filter is sufficient", () => {
		expect(
			getReportAccessibleEmployeeIds({
				currentEmployeeId: "admin-1",
				role: "admin",
				managedEmployeeIds: ["employee-2"],
			}),
		).toBeNull();
	});
});

describe("getManagerReportAccessibleEmployees", () => {
	it("deduplicates duplicate direct reports while preserving the first occurrence", () => {
		const employees = getManagerReportAccessibleEmployees({
			currentEmployee: employeeSource({ id: "manager-1", role: "manager" }),
			directReports: [
				employeeSource({ id: "employee-1", user: { name: "First Employee" } }),
				employeeSource({ id: "employee-1", user: { name: "Duplicate Employee" } }),
			],
		});

		expect(employees.map((emp) => emp.id)).toEqual(["manager-1", "employee-1"]);
		expect(employees[1]?.name).toBe("First Employee");
	});

	it("filters direct reports from other organizations", () => {
		const employees = getManagerReportAccessibleEmployees({
			currentEmployee: employeeSource({
				id: "manager-1",
				role: "manager",
				organizationId: "org-1",
			}),
			directReports: [
				employeeSource({ id: "employee-1", organizationId: "org-1" }),
				employeeSource({ id: "employee-2", organizationId: "org-2" }),
			],
		});

		expect(employees.map((emp) => emp.id)).toEqual(["manager-1", "employee-1"]);
	});

	it("maps first and last names from auth user fields", () => {
		const directReport = {
			...employeeSource({
				id: "employee-1",
				user: { firstName: "UserFirst", lastName: "UserLast" },
			}),
			firstName: "EmployeeFirst",
			lastName: "EmployeeLast",
		};

		const employees = getManagerReportAccessibleEmployees({
			currentEmployee: employeeSource({ id: "manager-1", role: "manager" }),
			directReports: [directReport],
		});

		expect(employees[1]).toMatchObject({
			firstName: "UserFirst",
			lastName: "UserLast",
		});
	});
});

describe("canReadReportEmployee", () => {
	it("uses CASL Employee object-subject visibility for report targets", () => {
		expect(
			canReadReportEmployee({
				currentEmployee: employeeSource({ id: "manager-1", role: "manager" }),
				managedEmployeeIds: ["employee-1"],
				targetEmployee: employeeSource({ id: "employee-1" }),
			}),
		).toBe(true);

		expect(
			canReadReportEmployee({
				currentEmployee: employeeSource({ id: "manager-1", role: "manager" }),
				managedEmployeeIds: ["employee-1"],
				targetEmployee: employeeSource({ id: "employee-2" }),
			}),
		).toBe(false);
	});

	it("preserves admin all-in-org and employee self report visibility", () => {
		expect(
			canReadReportEmployee({
				currentEmployee: employeeSource({ id: "admin-1", role: "admin" }),
				managedEmployeeIds: [],
				targetEmployee: employeeSource({ id: "employee-1" }),
			}),
		).toBe(true);

		expect(
			canReadReportEmployee({
				currentEmployee: employeeSource({ id: "employee-1" }),
				managedEmployeeIds: [],
				targetEmployee: employeeSource({ id: "employee-2" }),
			}),
		).toBe(false);
	});
});
