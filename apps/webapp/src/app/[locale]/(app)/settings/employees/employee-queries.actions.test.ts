import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const source = readFileSync(
	fileURLToPath(new URL("./employee-queries.actions.ts", import.meta.url)),
	"utf8",
);

describe("employee query name source", () => {
	it("uses auth user structured names for employee search and sort", () => {
		expect(source).toContain("$" + "{user.firstName}");
		expect(source).toContain("$" + "{user.lastName}");
		expect(source).toContain("ilike(user.firstName, pattern)");
		expect(source).toContain("ilike(user.lastName, pattern)");
		expect(source).not.toContain("ilike(employee.firstName, pattern)");
		expect(source).not.toContain("ilike(employee.lastName, pattern)");
	});

	it("mirrors auth structured names onto selectable root fields", () => {
		expect(source).toContain("firstName: row.user.firstName");
		expect(source).toContain("lastName: row.user.lastName");
		expect(source).not.toContain("firstName: row.employee.firstName");
		expect(source).not.toContain("lastName: row.employee.lastName");
	});

	it("includes invitation draft rows for org admins", () => {
		expect(source).toContain("employeeInvitationDraft");
		expect(source).toContain('kind: "invitationDraft"');
		expect(source).toContain('actor.accessTier === "orgAdmin"');
		expect(source).toContain("decodeEmployeeInvitationDraftId(employeeId)");
	});

	it("searches invitation drafts by prepared names, email, and position", () => {
		expect(source).toContain("ilike(employeeInvitationDraft.firstName, pattern)");
		expect(source).toContain("ilike(employeeInvitationDraft.lastName, pattern)");
		expect(source).toContain("ilike(invitation.email, pattern)");
		expect(source).toContain("ilike(employeeInvitationDraft.position, pattern)");
	});
});
