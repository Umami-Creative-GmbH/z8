import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
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
import { integrationAdminPool } from "@/test/integration-database";

// Resolve the actual React server build for this test worker and its installed
// RSC renderer. Neither React.cache nor its dispatcher is replaced.
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
vi.mock("@/db", async () =>
	(await import("@/test/integration-database")).integrationDbModule({
		logQuery: (query) => boundary.queries.push(query),
	}),
);

import { getRenderUserPreferences } from "@/lib/user-preferences/render-snapshot";
import {
	getRenderAuthContext as getAuthContext,
	getRenderSettingsAccessTier as getCurrentSettingsAccessTier,
	getRenderOnboardingStatus as getOnboardingStatus,
	getRenderPendingInvitationId as getPendingInvitationId,
	getRenderOrganizationDisplayContext,
	getRenderUserOrganizations as getUserOrganizations,
} from "./render-context";
import { getRenderSession } from "./render-session";

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
		) {
			return { url: pathToFileURL(serverReact).href, shortCircuit: true };
		}
		return nextResolve(specifier, context);
	},
});
const { renderToReadableStream } =
	require("next/dist/compiled/react-server-dom-webpack/cjs/react-server-dom-webpack-server.node.production.js") as {
		renderToReadableStream: (
			children: ReactNode,
			manifest: object,
		) => ReadableStream;
	};
hook.deregister();

type Subject = {
	user: { id: string; name: string; email: string };
	session: { id: string; userId: string; activeOrganizationId: string | null };
	ssoRequired?: boolean;
	mfaRequired?: { organizationId: string; deadline: null };
};
const requests = new AsyncLocalStorage<Subject | null>();
boundary.session = () => requests.getStore();
const suffix = randomUUID();
const userId = `render-user-${suffix}`;
const organizationId = `render-org-${suffix}`;
const employeeId = randomUUID();
const employmentPeriodId = randomUUID();
const departureId = randomUUID();
const subject: Subject = {
	user: { id: userId, name: "Render Ada", email: `${userId}@example.test` },
	session: {
		id: `render-session-${suffix}`,
		userId,
		activeOrganizationId: organizationId,
	},
};
const otherEmployeeId = randomUUID();
const other: Subject = {
	user: {
		id: `other-user-${suffix}`,
		name: "Render Grace",
		email: `other-${suffix}@example.test`,
	},
	session: {
		id: `other-session-${suffix}`,
		userId: `other-user-${suffix}`,
		activeOrganizationId: `other-org-${suffix}`,
	},
};

// These are the read interfaces used by the migrated layout, sidebar identity
// and Dashboard access checks. Rendering them together exercises the real RSC
// request cache while PostgreSQL observes their actual production queries.
async function LayoutIdentity() {
	const session = await getRenderSession();
	if (!session?.user) return createElement("p", null, "signed out");
	const [preferences, display] = await Promise.all([
		getRenderUserPreferences(session.user.id),
		getRenderOrganizationDisplayContext(),
	]);
	return createElement("section", {
		"data-layout-user": session.user.id,
		"data-timezone": preferences.timezone,
		"data-settings-org": display?.organizationSettings?.organizationId ?? "none",
		"data-display": JSON.stringify(display),
	});
}

async function SidebarIdentity() {
	const [context, tier, organizations] = await Promise.all([
		getAuthContext(),
		getCurrentSettingsAccessTier(),
		getUserOrganizations(),
	]);
	return createElement("aside", {
		"data-employee": context?.employee?.id,
		"data-tier": tier,
		"data-organizations": organizations.map((org) => org.id).join(","),
	});
}

async function DashboardIdentity() {
	const [onboarding, organizations, invitation] = await Promise.all([
		getOnboardingStatus(),
		getUserOrganizations(),
		getPendingInvitationId(),
	]);
	return createElement("main", {
		"data-onboarded": onboarding?.onboardingComplete,
		"data-dashboard-org": organizations[0]?.id,
		"data-invitation": invitation,
	});
}

function render(subject: Subject | null) {
	return requests.run(subject, async () => {
		const stream = renderToReadableStream(
			createElement(
				"div",
				null,
				createElement(LayoutIdentity),
				createElement(SidebarIdentity),
				createElement(DashboardIdentity),
			),
			{},
		);
		return new Response(stream).text();
	});
}

describe("render-local authenticated identity", () => {
	beforeAll(async () => {
		const pool = integrationAdminPool();
		await pool.query(
			`insert into "user" (id, name, email, email_verified) values ($1, 'Render Ada', $2, true)`,
			[userId, subject.user.email],
		);
		await pool.query(
			`insert into organization (id, name, slug, created_at, timezone) values ($1, 'Render organization', $1, now(), 'Europe/Berlin')`,
			[organizationId],
		);
		await pool.query(
			`insert into member (id, organization_id, user_id, role, status, created_at) values ($1, $2, $3, 'admin', 'approved', now())`,
			[randomUUID(), organizationId, userId],
		);
		await pool.query(
			`insert into employee (id, user_id, organization_id, role, start_date, updated_at) values ($1, $2, $3, 'admin', now(), now())`,
			[employeeId, userId, organizationId],
		);
		await pool.query(
			`insert into user_settings (user_id, timezone, week_start_day, time_format, onboarding_complete, updated_at) values ($1, 'Europe/Berlin', 'monday', '12h', true, now())`,
			[userId],
		);
		await pool.query(
			`insert into employee_employment_period (id, organization_id, employee_id, status, started_at, start_provenance, created_by) values ($1, $2, $3, 'open', '2025-01-01T00:00:00Z', 'recorded', $4)`,
			[employmentPeriodId, organizationId, employeeId, userId],
		);
		await pool.query(
			`insert into "user" (id, name, email, email_verified) values ($1, 'Render Grace', $2, true)`,
			[other.user.id, other.user.email],
		);
		await pool.query(
			`insert into organization (id, name, slug, created_at, timezone) values ($1, 'Other organization', $1, now(), 'America/New_York')`,
			[other.session.activeOrganizationId],
		);
		await pool.query(
			`insert into member (id, organization_id, user_id, role, status, created_at) values ($1, $2, $3, 'member', 'approved', now())`,
			[randomUUID(), other.session.activeOrganizationId, other.user.id],
		);
		await pool.query(
			`insert into employee (id, user_id, organization_id, role, start_date, updated_at) values ($1, $2, $3, 'employee', now(), now())`,
			[otherEmployeeId, other.user.id, other.session.activeOrganizationId],
		);
		await pool.query(
			`insert into user_settings (user_id, timezone, onboarding_complete, updated_at) values ($1, 'America/New_York', true, now())`,
			[other.user.id],
		);
	});
	beforeEach(() => {
		boundary.reads = 0;
		boundary.queries = [];
	});
	afterAll(async () => {
		const pool = integrationAdminPool();
		await pool.query(`delete from organization where id=$1`, [organizationId]);
		await pool.query(`delete from "user" where id=$1`, [userId]);
		await pool.query(`delete from organization where id=$1`, [
			other.session.activeOrganizationId,
		]);
		await pool.query(`delete from "user" where id=$1`, [other.user.id]);
	});

	it("renders the same authorized identity and presentation with one session evaluation", async () => {
		const output = await render(subject);
		expect(output).toContain(employeeId);
		expect(output).toContain(organizationId);
		expect(output).toContain("Europe/Berlin");
		expect(boundary.reads).toBe(1);
		expect(
			boundary.queries.filter((query) =>
				/from "member" inner join "organization"/.test(query),
			),
		).toHaveLength(1);
		expect(
			boundary.queries.filter((query) => query.includes('from "employee"')),
		).toHaveLength(1);
		expect(
			boundary.queries.filter((query) =>
				query.includes('from "user_settings"'),
			),
		).toHaveLength(1);
	});

	it("projects only display identity and settings into the client bootstrap", async () => {
		const output = await render(subject);
		expect(output).toContain("employeeId");
		expect(output).toContain("organizationSettings");
		expect(output).toContain("updatedAt");
		expect(output).not.toContain(subject.session.id);
		expect(output).not.toContain(subject.user.email);
		expect(output).not.toContain(subject.user.name);
		expect(boundary.reads).toBe(1);
	});

	it("isolates concurrent organizations and reevaluates a later signed-out request", async () => {
		const [ada, grace] = await Promise.all([render(subject), render(other)]);
		expect(ada).toContain(employeeId);
		expect(ada).not.toContain(otherEmployeeId);
		expect(ada).not.toContain(other.session.activeOrganizationId);
		expect(grace).toContain(otherEmployeeId);
		expect(grace).toContain("America/New_York");
		expect(grace).not.toContain(employeeId);
		expect(grace).not.toContain(organizationId);
		expect(boundary.reads).toBe(2);
		const signedOut = await render(null);
		expect(signedOut).toContain("signed out");
		expect(signedOut).not.toContain(employeeId);
		expect(signedOut).not.toContain(otherEmployeeId);
		expect(boundary.reads).toBe(3);
	});

	it("selects the current organization independently for simultaneous requests by the same user", async () => {
		const pool = integrationAdminPool();
		const switchedEmployeeId = randomUUID();
		try {
			await pool.query(
				`insert into member (id, organization_id, user_id, role, status, created_at) values ($1, $2, $3, 'member', 'approved', now())`,
				[randomUUID(), other.session.activeOrganizationId, userId],
			);
			await pool.query(
				`insert into employee (id, user_id, organization_id, role, start_date, updated_at) values ($1, $2, $3, 'employee', now(), now())`,
				[switchedEmployeeId, userId, other.session.activeOrganizationId],
			);
			const switched = {
				...subject,
				session: {
					...subject.session,
					activeOrganizationId: other.session.activeOrganizationId,
				},
			};
			const [first, second] = await Promise.all([
				render(subject),
				render(switched),
			]);
			expect(first).toContain(`"data-employee":"${employeeId}"`);
			expect(first).not.toContain(switchedEmployeeId);
			expect(second).toContain(`"data-employee":"${switchedEmployeeId}"`);
			expect(second).toContain('"data-tier":"member"');
			expect(second).not.toContain(employeeId);
			expect(boundary.reads).toBe(2);
		} finally {
			await pool.query(
				`delete from employee where id=$1 and organization_id=$2`,
				[switchedEmployeeId, other.session.activeOrganizationId],
			);
			await pool.query(
				`delete from member where user_id=$1 and organization_id=$2`,
				[userId, other.session.activeOrganizationId],
			);
		}
	});

	it.each(["pending membership", "inactive employee", "due departure"])(
		"does not reuse earlier employee authority after %s takes effect",
		async (caseName) => {
			expect(await render(subject)).toContain(employeeId);
			const pool = integrationAdminPool();
			try {
				if (caseName === "pending membership") {
					await pool.query(
						`update member set status='pending' where user_id=$1 and organization_id=$2`,
						[userId, organizationId],
					);
				} else if (caseName === "inactive employee") {
					await pool.query(
						`update employee set is_active=false where id=$1 and organization_id=$2`,
						[employeeId, organizationId],
					);
				} else {
					await pool.query(
						`insert into employee_departure (id, organization_id, employee_id, employment_period_id, mode, timezone, cutoff_at, created_by, request_id, request_fingerprint, revision, status) values ($1, $2, $3, $4, 'immediate', 'UTC', '2025-10-01T00:00:00Z', $5, gen_random_uuid(), 'render-fixture', 1, 'pending')`,
						[
							departureId,
							organizationId,
							employeeId,
							employmentPeriodId,
							userId,
						],
					);
				}
				const reduced = await render(subject);
				expect(reduced).not.toContain(employeeId);
				expect(reduced).toContain('"data-tier":"member"');
				expect(boundary.reads).toBe(2);
			} finally {
				await pool.query(
					`delete from employee_departure where id=$1 and organization_id=$2`,
					[departureId, organizationId],
				);
				await pool.query(
					`update member set status='approved' where user_id=$1 and organization_id=$2`,
					[userId, organizationId],
				);
				await pool.query(
					`update employee set is_active=true where id=$1 and organization_id=$2`,
					[employeeId, organizationId],
				);
			}
		},
	);

	it("never falls back to an employee from another organization when no organization is active", async () => {
		const output = await render({
			...subject,
			session: { ...subject.session, activeOrganizationId: null },
		});
		expect(output).not.toContain(employeeId);
		expect(output).toContain('"data-tier":"member"');
		expect(output).toContain('"data-settings-org":"none"');
	});

	it.each(["sso", "mfa"])(
		"does not derive employee or settings authority from an %s-held identity",
		async (challenge) => {
			const output = await render({
				...subject,
				...(challenge === "sso"
					? { ssoRequired: true }
					: { mfaRequired: { organizationId, deadline: null } }),
			});
			expect(output).not.toContain(employeeId);
			expect(output).toContain('"data-tier":"member"');
		},
	);
});
