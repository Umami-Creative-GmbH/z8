import { afterAll, beforeAll, expect, it, vi } from "vitest";
import {
	createLifecycleDatabaseFixture,
	type LifecycleDatabaseFixture,
} from "@/lib/employee-lifecycle/testing/database.test.fixture";

const actor = vi.hoisted(() => ({
	userId: "",
	organizationId: "",
	queries: [] as string[],
}));
vi.mock("@/db", async () =>
	(await import("@/test/integration-database")).integrationDbModule({
		logQuery: (query) => actor.queries.push(query),
	}),
);
vi.mock("next/headers", async () =>
	(await import("@/test/integration-harness")).nextHeaders(),
);
vi.mock("next/server", async (original) =>
	(await import("@/test/integration-harness")).nextServer(original),
);
vi.mock("next/cache", async (original) =>
	(await import("@/test/integration-harness")).nextCache(original),
);
vi.mock("@/lib/auth", () => ({
	auth: {
		api: {
			getSession: async () => ({
				user: { id: actor.userId, role: "user" },
				session: {
					id: `t1475-${actor.userId}`,
					userId: actor.userId,
					activeOrganizationId: actor.organizationId,
				},
			}),
		},
	},
}));
vi.mock("@/env", async (original) => ({
	env: {
		...(await original<typeof import("@/env")>()).env,
		BILLING_ENABLED: "true",
		STRIPE_SECRET_KEY: undefined,
	},
}));

const { GET: dashboard } = await import(
	"@/app/api/dashboard/widgets/[widget]/route"
);
const { GET: employees } = await import(
	"@/app/api/settings/employees/read/[dataset]/route"
);
const { requireBillingForMutation } = await import("./guard");
let fixture: LifecycleDatabaseFixture;
beforeAll(async () => {
	fixture = await createLifecycleDatabaseFixture();
	actor.userId = fixture.ownerUserId;
	actor.organizationId = fixture.organizationId;
});
afterAll(async () => fixture?.close());

it.each(["dashboard", "employees"])(
	"denies a direct %s GET with no subscription without provisioning a trial",
	async (kind) => {
		actor.organizationId = await fixture.createOrganization();
		const subject = await fixture.seedEmployee({
			organizationId: actor.organizationId,
			role: "admin",
		});
		actor.userId = subject.userId;
		const request = new Request(
			kind === "dashboard"
				? "https://z8.test/api/dashboard/widgets/birthday-reminders"
				: "https://z8.test/api/settings/employees/read/directory",
			{
				headers: {
					"x-z8-context-user": actor.userId,
					"x-z8-context-organization": actor.organizationId,
				},
			},
		);
		const read = () =>
			kind === "dashboard"
				? dashboard(request, {
						params: Promise.resolve({ widget: "birthday-reminders" }),
					})
				: employees(request, {
						params: Promise.resolve({ dataset: "directory" }),
					});
		actor.queries = [];
		const response = await read();
		expect(response.status).toBe(402);
		expect(await response.json()).toMatchObject({
			error: "billing_required",
			reason: "subscription_required",
		});
		expect(
			actor.queries.some((query) =>
				/(?:insert into|update|delete from) "subscription"/.test(query),
			),
		).toBe(false);
		// The existing explicit mutation gate still owns lazy trial provisioning.
		expect(await requireBillingForMutation(actor.organizationId)).toMatchObject(
			{ canAccess: true, state: "trialing" },
		);
		expect((await read()).status).toBe(200);
	},
);
