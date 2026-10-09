import { describe, expect, it } from "vitest";
import {
	canManageDocument,
	canViewDocument,
	isOwnDocument,
	managedCategoriesFor,
	ORGANIZATION_ADMIN_GRANT,
	type PersonnelFileAccess,
} from "./access";

const anna = { id: "anna", teamIds: ["berlin"] };
const ben = { id: "ben", teamIds: ["munich"] };

function access(overrides: Partial<PersonnelFileAccess> = {}): PersonnelFileAccess {
	return { organizationId: "org", userId: "u", selfEmployeeId: null, grants: [], ...overrides };
}

const admin = access({ grants: [ORGANIZATION_ADMIN_GRANT] });
const employeeAnna = access({ selfEmployeeId: "anna" });

describe("personnel file access", () => {
	it("lets an owner or admin manage every category of every employee", () => {
		for (const employee of [anna, ben]) {
			expect([...managedCategoriesFor(admin, employee)].sort()).toEqual([
				"certificate",
				"contract",
				"other",
				"payslip",
				"sick_note",
			]);
		}
		expect(
			canViewDocument(admin, { employee: ben, category: "sick_note", visibility: "hr_only" }),
		).toBe(true);
	});

	it("lets an employee view only their own shared documents and manage none", () => {
		expect(
			canViewDocument(employeeAnna, { employee: anna, category: "payslip", visibility: "shared" }),
		).toBe(true);
		expect(
			canViewDocument(employeeAnna, { employee: anna, category: "payslip", visibility: "hr_only" }),
		).toBe(false);
		expect(
			canViewDocument(employeeAnna, { employee: ben, category: "payslip", visibility: "shared" }),
		).toBe(false);
		expect(canManageDocument(employeeAnna, anna, "certificate")).toBe(false);
	});

	it("grants nothing to someone without a grant or own profile, such as a manager", () => {
		const manager = access({ selfEmployeeId: "manager" });
		expect(
			canViewDocument(manager, { employee: anna, category: "contract", visibility: "shared" }),
		).toBe(false);
		expect(managedCategoriesFor(manager, anna).size).toBe(0);
	});

	it("limits a scoped grant to its named employees, live teams and categories", () => {
		const scoped = access({
			grants: [
				{
					source: "officer_grant",
					scope: { kind: "specific", employeeIds: [], teamIds: ["berlin"] },
					categories: new Set(["payslip"]),
				},
				{
					source: "officer_grant",
					scope: { kind: "specific", employeeIds: ["ben"], teamIds: [] },
					categories: new Set(["certificate"]),
				},
			],
		});
		expect(canManageDocument(scoped, anna, "payslip")).toBe(true);
		expect(canManageDocument(scoped, anna, "contract")).toBe(false);
		expect(canManageDocument(scoped, ben, "certificate")).toBe(true);
		expect(canManageDocument(scoped, ben, "payslip")).toBe(false);
		expect(
			canViewDocument(scoped, { employee: ben, category: "certificate", visibility: "hr_only" }),
		).toBe(true);
	});

	it("tells an employee's own documents apart, so their views go unaudited", () => {
		expect(isOwnDocument(employeeAnna, "anna")).toBe(true);
		expect(isOwnDocument(employeeAnna, "ben")).toBe(false);
		expect(isOwnDocument(admin, "anna")).toBe(false);
	});
});
