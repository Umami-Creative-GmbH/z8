import { AsyncLocalStorage } from "node:async_hooks";
import { createRequire, registerHooks } from "node:module";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { createElement, type ReactNode } from "react";
import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from "vitest";
import {
	createLifecycleDatabaseFixture,
	type LifecycleDatabaseFixture,
} from "@/lib/employee-lifecycle/testing/database.test.fixture";

vi.mock("react", async () => {
	const { createRequire } = await import("node:module");
	const { dirname, join } = await import("node:path");
	const require = createRequire(import.meta.url);
	return require(
		join(
			dirname(require.resolve("react/package.json")),
			"cjs/react.react-server.production.js",
		),
	);
});
const boundary = vi.hoisted(() => ({
	session: () => null as unknown,
	reads: 0,
	queries: [] as string[],
	hold: null as Promise<void> | null,
	fail: false,
}));
vi.mock("@/lib/auth", () => ({
	auth: {
		api: {
			getSession: async () => {
				boundary.reads++;
				return boundary.session();
			},
		},
	},
}));
vi.mock("next/server", async (original) =>
	(await import("@/test/integration-harness")).nextServer(original),
);
vi.mock("next/headers", async () =>
	(await import("@/test/integration-harness")).nextHeaders(),
);
vi.mock("@/db", async () => {
	const module = await (
		await import("@/test/integration-database")
	).integrationDbModule({ logQuery: (query) => boundary.queries.push(query) });
	const query = module.pool.query.bind(module.pool);
	vi.spyOn(module.pool, "query").mockImplementation((...args) => {
		const config = args[0];
		const text = typeof config === "string" ? config : config.text;
		const run = () => Reflect.apply(query, module.pool, args);
		if (boundary.fail && text.includes('from "payroll_access_grant"'))
			return Promise.reject(new Error("Synthetic payroll failure"));
		return boundary.hold && text.includes('from "payroll_access_grant"')
			? boundary.hold.then(run)
			: run();
	});
	return module;
});
// RSC client transport: expose the public sidebar props as rendered navigation.
vi.mock("./app-sidebar", async () => ({
	AppSidebar: ({
		navigationCapabilities,
		...props
	}: {
		navigationCapabilities: Record<string, boolean>;
		employeeRole: string | null;
		capabilitiesUnavailable?: boolean;
	}) => {
		const { createElement } = awaitReact;
		return createElement(
			"nav",
			{ "data-employee-role": props.employeeRole },
			props.capabilitiesUnavailable
				? createElement(
						"p",
						{ role: "status" },
						"Some navigation is unavailable",
					)
				: null,
			Object.entries(navigationCapabilities)
				.filter(([, visible]) => visible)
				.map(([name]) =>
					createElement("a", { key: name, href: `/${name}` }, name),
				),
		);
	},
}));
const awaitReact = await import("react");
vi.mock("./sidebar-loading", () => ({
	SidebarLoading: () =>
		createElement(
			"aside",
			{ "aria-busy": true },
			createElement("span", { role: "status" }, "Loading navigation"),
		),
}));
const { ServerAppSidebar } = await import("./server-app-sidebar");
const { ServerSidebarRegion } = await import("./server-sidebar-region");
const { getTimeClockStatus } = await import(
	"@/app/[locale]/(app)/time-tracking/actions"
);
async function KnownClock() {
	const status = await getTimeClockStatus();
	return createElement(
		"button",
		{ type: "button", disabled: !status.hasEmployee },
		status.hasEmployee
			? status.isClockedIn
				? "Clock Out"
				: "Clock In"
			: "Clock unavailable",
	);
}
const require = createRequire(import.meta.url);
const serverReact = join(
	dirname(require.resolve("react/package.json")),
	"cjs/react.react-server.production.js",
);
const hook = registerHooks({
	resolve(specifier, context, nextResolve) {
		if (
			specifier === "react" &&
			context.parentURL?.includes("react-server-dom-webpack")
		)
			return { url: pathToFileURL(serverReact).href, shortCircuit: true };
		return nextResolve(specifier, context);
	},
});
const { renderToReadableStream } =
	require("next/dist/compiled/react-server-dom-webpack/cjs/react-server-dom-webpack-server.node.production.js") as {
		renderToReadableStream: (
			children: ReactNode,
			manifest: object,
			options?: { onError: (error: unknown) => string },
		) => ReadableStream;
	};
hook.deregister();
type Subject = {
	user: { id: string; role: string };
	session: { id: string; userId: string; activeOrganizationId: string | null };
	mfaRequired?: boolean;
	ssoRequired?: boolean;
};
const requests = new AsyncLocalStorage<Subject | null>();
boundary.session = () => requests.getStore();
let fixture: LifecycleDatabaseFixture;
function subject(
	userId = fixture.ownerUserId,
	organizationId: string | null = fixture.organizationId,
): Subject {
	return {
		user: { id: userId, role: "user" },
		session: {
			id: `sidebar-${userId}`,
			userId,
			activeOrganizationId: organizationId,
		},
	};
}
function startRegion(actor: Subject | null) {
	return requests.run(actor, () => {
		const stream = renderToReadableStream(
			createElement(
				"div",
				null,
				createElement(ServerSidebarRegion, {
					showWorksCouncilNav: true,
					variant: "inset",
				}),
				createElement(KnownClock),
				createElement("main", null, "Protected page content"),
			),
			{},
			{ onError: () => "synthetic-sidebar-error" },
		);
		let output = "";
		const completion = (async () => {
			const reader = stream.getReader();
			const decoder = new TextDecoder();
			while (true) {
				const row = await reader.read();
				if (row.done) break;
				output += decoder.decode(row.value, { stream: true });
			}
			return output;
		})();
		return { completion, output: () => output };
	});
}
function render(actor: Subject | null) {
	return requests.run(actor, () =>
		new Response(
			renderToReadableStream(
				createElement(ServerAppSidebar, { showWorksCouncilNav: true }),
				{},
			),
		).text(),
	);
}
describe("authorized sidebar capabilities on the real RSC request cache", () => {
	beforeAll(async () => {
		fixture = await createLifecycleDatabaseFixture();
		await fixture.pool.query(
			`update organization set works_council_enabled=true,personnel_files_enabled=true,projects_enabled=true where id=$1`,
			[fixture.organizationId],
		);
	});
	beforeEach(() => {
		boundary.reads = 0;
		boundary.queries = [];
	});
	afterAll(async () => {
		await fixture?.close();
	});
	it("shares one render identity across works council, finance, personnel and driving decisions", async () => {
		const output = await render(subject());
		expect(output).toContain('"href":"/finance"');
		expect(output).toContain('"href":"/personnelFiles"');
		expect(boundary.reads).toBe(1);
		expect(
			boundary.queries.filter((query) =>
				/from "member" inner join "organization"/.test(query),
			),
		).toHaveLength(1);
		expect(
			boundary.queries.filter((query) => query.includes('from "employee"')),
		).toHaveLength(1);
	});
	it("offers presence only for an active own-organization location, using a bounded existence read", async () => {
		const otherOrg = await fixture.createOrganization();
		const id = (await import("node:crypto")).randomUUID();
		const foreign = (await import("node:crypto")).randomUUID();
		await fixture.pool.query(
			`insert into location (id,organization_id,name,is_active,created_by,updated_at) values ($1,$2,'Inactive own location',false,$3,now()),($4,$5,'Foreign location',true,$3,now())`,
			[id, fixture.organizationId, fixture.ownerUserId, foreign, otherOrg],
		);
		expect(await render(subject())).not.toContain('"href":"/teamPresence"');
		await fixture.pool.query(
			`update location set is_active=true where id=$1 and organization_id=$2`,
			[id, fixture.organizationId],
		);
		boundary.queries = [];
		expect(await render(subject())).toContain('"href":"/teamPresence"');
		const locationQueries = boundary.queries.filter((query) =>
			query.includes('from "location"'),
		);
		expect(locationQueries).toHaveLength(1);
		expect(locationQueries[0]).not.toContain('"name"');
		expect(locationQueries[0]).toMatch(/limit \$\d+/);
	});
	it("starts unrelated capability reads before a held payroll read finishes", async () => {
		let release = () => {};
		boundary.hold = new Promise<void>((resolve) => {
			release = resolve;
		});
		const pending = render(subject());
		try {
			await vi.waitFor(() =>
				expect(
					boundary.queries.some((query) =>
						query.includes('from "payroll_access_grant"'),
					),
				).toBe(true),
			);
			await vi.waitFor(() =>
				expect(
					boundary.queries.some((query) =>
						query.includes('from "driving_licence_policy"'),
					),
				).toBe(true),
			);
			expect(
				boundary.queries.some((query) => query.includes('from "location"')),
			).toBe(true);
		} finally {
			release();
			boundary.hold = null;
			await pending;
		}
	});
	it("streams permitted page content and known clock status while sidebar payroll is pending", async () => {
		let release = () => {};
		boundary.hold = new Promise<void>((resolve) => {
			release = resolve;
		});
		const pending = startRegion(subject());
		try {
			await vi.waitFor(() =>
				expect(pending.output()).toContain("Loading navigation"),
			);
			await vi.waitFor(() => expect(pending.output()).toContain("Clock In"));
			expect(pending.output()).toContain("Protected page content");
			expect(pending.output()).not.toContain('"href":"/finance"');
		} finally {
			release();
			boundary.hold = null;
			await pending.completion;
		}
		expect(pending.output()).toContain('"href":"/finance"');
	});
	it("keeps successful navigation, permitted page and known clock when one capability fails", async () => {
		boundary.fail = true;
		try {
			const output = await startRegion(subject()).completion;
			expect(output).toContain("Some navigation is unavailable");
			expect(output).toContain('"href":"/finance"');
			expect(output).toContain('"href":"/personnelFiles"');
			expect(output).toContain("Clock In");
			expect(output).toContain("Protected page content");
			expect(output).not.toContain("Synthetic payroll failure");
		} finally {
			boundary.fail = false;
		}
	});
	it("preserves restricted custom-role and independent officer grants, then observes revocation on a new render", async () => {
		const person = await fixture.seedEmployee();
		const { randomUUID } = await import("node:crypto");
		const roleId = randomUUID();
		await fixture.pool.query(
			`insert into custom_role (id,organization_id,name,base_tier,created_by,updated_at) values ($1,$2,'Sidebar restricted','employee',$3,now())`,
			[roleId, fixture.organizationId, fixture.ownerUserId],
		);
		await fixture.pool.query(
			`insert into custom_role_permission (custom_role_id,action,subject) values ($1,'read','WorksCouncil'),($1,'read','TravelExpenseFinance')`,
			[roleId],
		);
		await fixture.pool.query(
			`insert into employee_custom_role (employee_id,custom_role_id,assigned_by) values ($1,$2,$3)`,
			[person.employeeId, roleId, fixture.ownerUserId],
		);
		const customOnly = await render(subject(person.userId));
		expect(customOnly).toContain('"href":"/worksCouncil"');
		expect(customOnly).not.toContain('"href":"/finance"');
		expect(customOnly).not.toContain('"href":"/personnelFiles"');
		expect(customOnly).not.toContain('"href":"/payroll"');
		await fixture.pool.query(
			`insert into expense_officer_grant (organization_id,officer_employee_id,scope,created_by) values ($1,$2,'specific',$3)`,
			[fixture.organizationId, person.employeeId, fixture.ownerUserId],
		);
		await fixture.pool.query(
			`insert into personnel_file_officer_grant (organization_id,officer_employee_id,scope,categories,created_by) values ($1,$2,'specific',ARRAY['payslip'],$3)`,
			[fixture.organizationId, person.employeeId, fixture.ownerUserId],
		);
		await fixture.pool.query(
			`insert into payroll_access_grant (organization_id,payroll_employee_id,scope,created_by,updated_at) values ($1,$2,'specific',$3,now())`,
			[fixture.organizationId, person.employeeId, fixture.ownerUserId],
		);
		const granted = await render(subject(person.userId));
		for (const name of ["finance", "personnelFiles", "payroll"])
			expect(granted).toContain(`"href":"/${name}"`);
		await fixture.pool.query(
			`update custom_role set is_active=false where id=$1`,
			[roleId],
		);
		for (const table of [
			"expense_officer_grant",
			"personnel_file_officer_grant",
		])
			await fixture.pool.query(
				`update ${table} set is_active=false where organization_id=$1 and officer_employee_id=$2`,
				[fixture.organizationId, person.employeeId],
			);
		await fixture.pool.query(
			`update payroll_access_grant set is_active=false where organization_id=$1 and payroll_employee_id=$2`,
			[fixture.organizationId, person.employeeId],
		);
		const revoked = await render(subject(person.userId));
		for (const name of ["worksCouncil", "finance", "personnelFiles", "payroll"])
			expect(revoked).not.toContain(`"href":"/${name}"`);
	});
	it("preserves personnel-file owner access without an employee and skips employee-only capability reads", async () => {
		const owner = await fixture.seedEmployee({ role: "owner" });
		await fixture.pool.query(
			`delete from employee where id=$1 and organization_id=$2`,
			[owner.employeeId, fixture.organizationId],
		);
		boundary.queries = [];
		const output = await render(subject(owner.userId));
		expect(output).toContain('"href":"/personnelFiles"');
		expect(output).toContain('"href":"/worksCouncil"');
		for (const name of [
			"finance",
			"payroll",
			"myDocuments",
			"teamPresence",
			"periodSubmissions",
		])
			expect(output).not.toContain(`"href":"/${name}"`);
		expect(
			boundary.queries.some((query) =>
				query.includes('from "payroll_access_grant"'),
			),
		).toBe(false);
		expect(
			boundary.queries.some((query) =>
				query.includes('from "expense_officer_grant"'),
			),
		).toBe(false);
		expect(boundary.reads).toBe(1);
	});
	it("does not run disabled personnel/project capability reads or offer their navigation", async () => {
		const person = await fixture.seedEmployee();
		await fixture.pool.query(
			`update organization set personnel_files_enabled=false,projects_enabled=false,works_council_enabled=false where id=$1`,
			[fixture.organizationId],
		);
		try {
			const output = await render(subject(person.userId));
			expect(output).not.toContain('"href":"/personnelFiles"');
			expect(output).not.toContain('"href":"/worksCouncil"');
			expect(
				boundary.queries.some((query) =>
					query.includes('from "personnel_file_officer_grant"'),
				),
			).toBe(false);
			expect(
				boundary.queries.some((query) => query.includes('from "project"')),
			).toBe(false);
		} finally {
			await fixture.pool.query(
				`update organization set personnel_files_enabled=true,projects_enabled=true,works_council_enabled=true where id=$1`,
				[fixture.organizationId],
			);
		}
	});
	it.each(["inactive", "unapproved"])(
		"does not offer privileged navigation for an %s employee",
		async (kind) => {
			const person = await fixture.seedEmployee({ role: "admin" });
			if (kind === "inactive")
				await fixture.pool.query(
					`update employee set is_active=false where id=$1`,
					[person.employeeId],
				);
			else
				await fixture.pool.query(
					`update member set status='pending' where id=$1`,
					[person.memberId],
				);
			const output = await render(subject(person.userId));
			for (const name of [
				"finance",
				"payroll",
				"personnelFiles",
				"worksCouncil",
				"teamPresence",
				"periodSubmissions",
			])
				expect(output).not.toContain(`"href":"/${name}"`);
			expect(
				boundary.queries.some((query) =>
					query.includes('from "payroll_access_grant"'),
				),
			).toBe(false);
		},
	);
	it("recovers a failed payroll capability on a fresh sidebar render without retaining failure state", async () => {
		await fixture.pool.query(
			`insert into payroll_access_grant (organization_id,payroll_employee_id,scope,created_by,updated_at) values ($1,$2,'all',$3,now())`,
			[fixture.organizationId, fixture.ownerEmployeeId, fixture.ownerUserId],
		);
		boundary.fail = true;
		try {
			expect(await startRegion(subject()).completion).not.toContain(
				'"href":"/payroll"',
			);
		} finally {
			boundary.fail = false;
		}
		const recovered = await startRegion(subject()).completion;
		expect(recovered).toContain('"href":"/payroll"');
		expect(recovered).not.toContain("Some navigation is unavailable");
	});
	it("isolates simultaneous user/organization capability results without sharing another render's grants", async () => {
		const otherOrg = await fixture.createOrganization();
		const other = await fixture.seedEmployee({ organizationId: otherOrg });
		boundary.reads = 0;
		const [ownerOutput, otherOutput] = await Promise.all([
			render(subject()),
			render(subject(other.userId, otherOrg)),
		]);
		expect(ownerOutput).toContain('"href":"/finance"');
		expect(ownerOutput).toContain('"href":"/personnelFiles"');
		expect(otherOutput).not.toContain('"href":"/finance"');
		expect(otherOutput).not.toContain('"href":"/personnelFiles"');
		expect(otherOutput).not.toContain('"href":"/payroll"');
		expect(boundary.reads).toBe(2);
	});
});
