import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
	join(process.cwd(), "src/app/[locale]/(app)/settings/employees/employees-page-client.tsx"),
	"utf8",
);

describe("EmployeesPageClient people-management tabs", () => {
	it("keeps the employee directory as a focused child component", () => {
		expect(source).toContain("function EmployeeDirectoryTab");
		expect(source).toContain("<EmployeeDirectoryTab");
	});

	it("renders org-admin people tabs on the employees page", () => {
		expect(source).toContain('Tabs defaultValue="employees"');
		expect(source).toContain('TabsTrigger value="employees"');
		expect(source).toContain('TabsTrigger value="members"');
		expect(source).toContain('TabsTrigger value="invitations"');
		expect(source).toContain('TabsTrigger value="invite-codes"');
		expect(source).toContain("<MembersTable");
		expect(source).toContain("<PendingMembersCard");
		expect(source).toContain("<InviteCodeManagement");
		expect(source).toContain("<InviteMemberDialog");
	});

	it("does not send invite actions back to organization settings", () => {
		expect(source).not.toContain('href="/settings/organizations"');
		expect(source).not.toContain("href='/settings/organizations'");
	});
});
