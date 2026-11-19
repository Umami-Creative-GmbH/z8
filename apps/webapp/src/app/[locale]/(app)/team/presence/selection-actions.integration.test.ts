import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import {
	createLifecycleDatabaseFixture,
	type LifecycleDatabaseFixture,
} from "@/lib/employee-lifecycle/testing/database.test.fixture";

const session = vi.hoisted(() => ({ userId: "", organizationId: "" }));
vi.mock("next/headers", async () => (await import("@/test/integration-harness")).nextHeaders());
vi.mock("next/server", async (original) =>
	(await import("@/test/integration-harness")).nextServer(original),
);
vi.mock("next/cache", async (original) =>
	(await import("@/test/integration-harness")).nextCache(original),
);
vi.mock("@/lib/auth", () => ({
	auth: {
		api: {
			getSession: async () =>
				session.userId
					? {
							user: { id: session.userId, role: "user" },
							session: {
								id: "presence-selection-test",
								userId: session.userId,
								activeOrganizationId: session.organizationId,
							},
						}
					: null,
		},
	},
}));

const { readPresenceLocations } = await import("./selection-actions");
let fixture: LifecycleDatabaseFixture;
let owner: string;
let manager: string;
let member: string;
let otherOrganizationId: string;
let locationId: string;

beforeAll(async () => {
	fixture = await createLifecycleDatabaseFixture();
	owner = (await fixture.seedEmployee({ role: "owner" })).userId;
	const managed = await fixture.seedEmployee();
	manager = managed.userId;
	await fixture.pool.query("update employee set role='manager' where id=$1", [managed.employeeId]);
	member = (await fixture.seedEmployee()).userId;
	otherOrganizationId = await fixture.createOrganization();
	locationId = randomUUID();
	await fixture.pool.query(
		"insert into location (id,organization_id,name,is_active,created_by,updated_at) values ($1,$2,'Active office',true,$3,now()), ($4,$2,'Inactive office',false,$3,now()), ($5,$6,'Foreign office',true,$3,now())",
		[locationId, fixture.organizationId, owner, randomUUID(), randomUUID(), otherOrganizationId],
	);
});
afterAll(async () => {
	await fixture?.close();
});

it("returns only active organization locations for the owner and a scoped manager", async () => {
	for (const userId of [owner, manager]) {
		Object.assign(session, { userId, organizationId: fixture.organizationId });
		await expect(readPresenceLocations({ ...session })).resolves.toEqual({
			status: "ok",
			userId,
			organizationId: fixture.organizationId,
			locations: [{ id: locationId, name: "Active office" }],
		});
	}
});

it("refuses ordinary members and missing sessions through current admission", async () => {
	for (const userId of [member, ""]) {
		Object.assign(session, { userId, organizationId: fixture.organizationId });
		await expect(
			readPresenceLocations({ userId: owner, organizationId: fixture.organizationId }),
		).resolves.toEqual({ status: "forbidden" });
	}
});

it("never treats the expected account or organization as an authorization grant", async () => {
	Object.assign(session, { userId: owner, organizationId: fixture.organizationId });
	await expect(
		readPresenceLocations({ userId: manager, organizationId: fixture.organizationId }),
	).resolves.toEqual({ status: "changed" });
	await expect(
		readPresenceLocations({ userId: owner, organizationId: otherOrganizationId }),
	).resolves.toEqual({ status: "changed" });
	Object.assign(session, { userId: owner, organizationId: otherOrganizationId });
	await expect(readPresenceLocations({ ...session })).resolves.toEqual({ status: "forbidden" });
});
