import { describe, expect, it } from "vitest";
import type { PersonalDataExportScope } from "./collector";
import { ACTION_ON_OTHERS_COLUMNS, actionOnOtherRow, otherPeopleOf } from "./redaction";

function scope(overrides: Partial<PersonalDataExportScope> = {}): PersonalDataExportScope {
	return {
		organizationId: "org-1",
		employeeId: "emp-subject",
		userId: "user-subject",
		kind: "employee",
		...overrides,
	};
}

const COLLEAGUE = "6f1c2d4e-0000-4000-8000-00000000c011";
const OTHER_COLLEAGUE = "6f1c2d4e-0000-4000-8000-00000000c022";

describe("other people in a personal data export", () => {
	it("gives a colleague one opaque id across the whole export, never their own id", () => {
		const exportScope = scope();
		const first = otherPeopleOf(exportScope).employee(COLLEAGUE);
		const again = otherPeopleOf(exportScope).employee(COLLEAGUE);

		expect(first).toMatch(/^person-[0-9a-f]{16}$/);
		expect(again).toBe(first);
		expect(first).not.toContain(COLLEAGUE.replaceAll("-", "").slice(0, 8));
		expect(otherPeopleOf(exportScope).employee(OTHER_COLLEAGUE)).not.toBe(first);
		expect(otherPeopleOf(exportScope).employee(null)).toBeNull();
	});

	it("gives the same colleague a different id in another export", () => {
		expect(otherPeopleOf(scope()).employee(COLLEAGUE)).not.toBe(
			otherPeopleOf(scope()).employee(COLLEAGUE),
		);
	});

	it("names a colleague known by user id with their employee id's opaque id once linked", () => {
		const people = otherPeopleOf(scope());
		const unlinked = people.user("user-colleague");
		expect(unlinked).toMatch(/^person-[0-9a-f]{16}$/);

		people.linkUser("user-colleague", COLLEAGUE);
		expect(people.user("user-colleague")).toBe(people.employee(COLLEAGUE));
	});

	it("shapes an action on another person as kind, action, time and opaque id only", () => {
		const people = otherPeopleOf(scope());
		const row = actionOnOtherRow(people, {
			recordKind: "absence",
			authority: "canonical",
			action: "approved",
			actedAt: new Date("2026-03-02T09:15:00.000Z"),
			asDeputy: false,
			otherEmployeeId: COLLEAGUE,
		});

		expect(row).toEqual({
			record_kind: "absence",
			authority: "canonical",
			action: "approved",
			acted_at: "2026-03-02T09:15:00Z",
			as_deputy: false,
			other_person: people.employee(COLLEAGUE),
		});
		expect(Object.keys(row)).toEqual([...ACTION_ON_OTHERS_COLUMNS]);
	});
});
