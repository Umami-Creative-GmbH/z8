import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SERVICE_SOURCE = fileURLToPath(new URL("./platform-admin.service.ts", import.meta.url));

function getListUsersSource(): string {
	const source = readFileSync(SERVICE_SOURCE, "utf8");
	const start = source.indexOf("listUsers: (filters, pagination) =>");
	const end = source.indexOf("\n\t\t\tbanUser:", start);

	expect(start).toBeGreaterThan(-1);
	expect(end).toBeGreaterThan(start);

	return source.slice(start, end);
}

function getListOrganizationsSource(): string {
	const source = readFileSync(SERVICE_SOURCE, "utf8");
	const start = source.indexOf("listOrganizations: (filters, pagination) =>");
	const end = source.indexOf("\n\t\t\tsuspendOrganization:", start);

	expect(start).toBeGreaterThan(-1);
	expect(end).toBeGreaterThan(start);

	return source.slice(start, end);
}

describe("PlatformAdminService listUsers privacy guardrails", () => {
	it("does not select full names or profile images for the platform users list", () => {
		const listUsersSource = getListUsersSource();

		expect(listUsersSource).not.toContain("name: user.name");
		expect(listUsersSource).not.toContain("image: user.image");
	});

	it("searches platform users by email only", () => {
		const listUsersSource = getListUsersSource();

		expect(listUsersSource).toContain("ilike(user.email");
		expect(listUsersSource).not.toContain("ilike(user.name");
	});

	it("selects organization memberships without selecting organization private fields", () => {
		const listUsersSource = getListUsersSource();

		expect(listUsersSource).toContain("member.userId");
		expect(listUsersSource).toContain("member.organizationId");
		expect(listUsersSource).toContain("role: member.role");
		expect(listUsersSource).toContain("status: member.status");
		expect(listUsersSource).toContain("name: organization.name");
		expect(listUsersSource).toContain("slug: organization.slug");
		expect(listUsersSource).not.toContain("logo: organization.logo");
	});

	it("supports filtering users by organization membership", () => {
		const listUsersSource = getListUsersSource();

		expect(listUsersSource).toContain("organizationId");
		expect(listUsersSource).toContain("EXISTS");
		// biome-ignore lint/suspicious/noTemplateCurlyInString: its ok
		expect(listUsersSource).toContain('"member"."user_id" = ${user.id}');
		expect(listUsersSource).toContain(
			// biome-ignore lint/suspicious/noTemplateCurlyInString: its ok
			'"member"."organization_id" = ${organizationId}',
		);
		expect(listUsersSource).not.toContain("inArray(user.id");
	});
});

describe("PlatformAdminService listOrganizations query guardrails", () => {
	it("qualifies organization count subquery columns to avoid ambiguous SQL", () => {
		const listOrganizationsSource = getListOrganizationsSource();

		expect(listOrganizationsSource).toContain('"employee"."organization_id" = "organization"."id"');
		expect(listOrganizationsSource).toContain('"member"."organization_id" = "organization"."id"');
	});
});
