import { describe, expect, it } from "vitest";
import { parseInstant } from "@/lib/datetime/temporal-core";
import {
	canDeleteOwnSickNote,
	canManageDocument,
	canUploadOwnDocument,
	canViewDocument,
	isOwnDocument,
	managedCategoriesFor,
	ORGANIZATION_ADMIN_GRANT,
	type PersonnelFileAccess,
	sickNoteAttachRefusal,
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

	it("lets an employee upload only certificates and other documents into their own file", () => {
		expect(canUploadOwnDocument(employeeAnna, "anna", "certificate")).toBe(true);
		expect(canUploadOwnDocument(employeeAnna, "anna", "other")).toBe(true);
		for (const category of ["contract", "payslip", "sick_note"] as const) {
			expect(canUploadOwnDocument(employeeAnna, "anna", category)).toBe(false);
		}
		expect(canUploadOwnDocument(employeeAnna, "ben", "certificate")).toBe(false);
		expect(canUploadOwnDocument(access(), "anna", "certificate")).toBe(false);
	});

	it("treats an owner, admin or officer as an employee for their own file", () => {
		const adminAnna = access({ selfEmployeeId: "anna", grants: [ORGANIZATION_ADMIN_GRANT] });
		const officerAnna = access({
			selfEmployeeId: "anna",
			grants: [
				{
					source: "officer_grant",
					scope: { kind: "specific", employeeIds: [], teamIds: ["berlin"] },
					categories: new Set(["payslip", "certificate"]),
				},
			],
		});
		for (const actor of [adminAnna, officerAnna]) {
			expect(managedCategoriesFor(actor, anna).size).toBe(0);
			expect(canManageDocument(actor, anna, "payslip")).toBe(false);
			expect(
				canViewDocument(actor, { employee: anna, category: "payslip", visibility: "hr_only" }),
			).toBe(false);
			expect(
				canViewDocument(actor, { employee: anna, category: "payslip", visibility: "shared" }),
			).toBe(true);
			expect(canUploadOwnDocument(actor, "anna", "certificate")).toBe(true);
		}
		// Everyone else in scope stays managed.
		expect(canManageDocument(adminAnna, ben, "contract")).toBe(true);
		expect(canManageDocument(officerAnna, { id: "carla", teamIds: ["berlin"] }, "payslip")).toBe(
			true,
		);
	});

	it("tells an employee's own documents apart, so their views go unaudited", () => {
		expect(isOwnDocument(employeeAnna, "anna")).toBe(true);
		expect(isOwnDocument(employeeAnna, "ben")).toBe(false);
		expect(isOwnDocument(admin, "anna")).toBe(false);
	});
});

describe("sick notes on absences (#982)", () => {
	const sickLeave = { employeeId: "anna", categoryType: "sick", status: "pending" } as const;

	it("lets an employee attach a sick note to their own pending or approved sick leave", () => {
		for (const status of ["pending", "approved"] as const) {
			expect(
				sickNoteAttachRefusal(employeeAnna, {
					employeeSickNoteUpload: true,
					absence: { ...sickLeave, status },
				}),
			).toBeNull();
		}
	});

	it("refuses while the organization does not allow employee sick notes", () => {
		expect(
			sickNoteAttachRefusal(employeeAnna, { employeeSickNoteUpload: false, absence: sickLeave }),
		).toBe("setting_off");
	});

	it("refuses someone else's absence, even for an owner or admin", () => {
		for (const actor of [employeeAnna, admin]) {
			expect(
				sickNoteAttachRefusal(actor, {
					employeeSickNoteUpload: true,
					absence: { ...sickLeave, employeeId: "ben" },
				}),
			).toBe("not_own");
		}
	});

	it("refuses an absence that is no sick leave", () => {
		expect(
			sickNoteAttachRefusal(employeeAnna, {
				employeeSickNoteUpload: true,
				absence: { ...sickLeave, categoryType: "vacation" },
			}),
		).toBe("not_sick");
	});

	it("refuses a rejected absence", () => {
		expect(
			sickNoteAttachRefusal(employeeAnna, {
				employeeSickNoteUpload: true,
				absence: { ...sickLeave, status: "rejected" },
			}),
		).toBe("rejected");
	});

	describe("deleting an own sick note", () => {
		const uploadedAt = parseInstant("2026-10-12T08:00:00Z");
		const note = {
			employeeId: "anna",
			category: "sick_note",
			visibility: "shared",
			uploadedBy: "u",
			createdAt: uploadedAt,
		} as const;
		const at = (iso: string) => parseInstant(iso);

		it("lets the uploader delete it within 24 hours of uploading it", () => {
			expect(canDeleteOwnSickNote(employeeAnna, note, at("2026-10-12T08:00:00Z"))).toBe(true);
			expect(canDeleteOwnSickNote(employeeAnna, note, at("2026-10-13T07:59:59Z"))).toBe(true);
		});

		it("refuses after 24 hours", () => {
			expect(canDeleteOwnSickNote(employeeAnna, note, at("2026-10-13T08:00:00Z"))).toBe(false);
		});

		it("refuses a sick note someone else uploaded or another category", () => {
			const now = at("2026-10-12T09:00:00Z");
			expect(canDeleteOwnSickNote(employeeAnna, { ...note, uploadedBy: "officer" }, now)).toBe(
				false,
			);
			expect(canDeleteOwnSickNote(employeeAnna, { ...note, category: "certificate" }, now)).toBe(
				false,
			);
			expect(canDeleteOwnSickNote(employeeAnna, { ...note, employeeId: "ben" }, now)).toBe(false);
			// An officer made it HR-only: the employee no longer sees it.
			expect(canDeleteOwnSickNote(employeeAnna, { ...note, visibility: "hr_only" }, now)).toBe(
				false,
			);
		});
	});
});
