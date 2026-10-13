/**
 * PostgreSQL contract (#1156): a scheduled export recipient gets their own recipient
 * language only when their address belongs to a member of the exporting organization.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
	createLifecycleDatabaseFixture,
	type LifecycleDatabaseFixture,
} from "@/lib/employee-lifecycle/testing/database.test.fixture";
import { findMemberUserIdsByEmail } from "./member-recipients";

describe("findMemberUserIdsByEmail", () => {
	let fixture: LifecycleDatabaseFixture;

	beforeAll(async () => {
		fixture = await createLifecycleDatabaseFixture();
	});

	afterAll(async () => {
		await fixture?.close();
	});

	it("matches addresses to members of the organization only, ignoring case", async () => {
		const organizationId = await fixture.createOrganization();
		const otherOrganizationId = await fixture.createOrganization();
		const admin = await fixture.seedEmployee({ organizationId, role: "admin" });
		const outsider = await fixture.seedEmployee({ organizationId: otherOrganizationId });
		const adminEmail = `${admin.userId}@lifecycle.test`;
		const outsiderEmail = `${outsider.userId}@lifecycle.test`;

		const matches = await findMemberUserIdsByEmail(organizationId, [
			adminEmail.toUpperCase(),
			outsiderEmail,
			"payroll@tax-office.example",
		]);

		expect(matches).toEqual(new Map([[adminEmail, admin.userId]]));
	});

	it("looks nothing up without addresses", async () => {
		await expect(findMemberUserIdsByEmail(fixture.organizationId, [])).resolves.toEqual(new Map());
	});
});
