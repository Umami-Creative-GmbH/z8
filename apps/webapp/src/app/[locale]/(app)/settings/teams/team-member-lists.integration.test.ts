/**
 * #1438: team settings member lists mark former employees (deactivated, or
 * past a due departure) so the pages hide them until "Show former employees"
 * is on. The real loaders run against a disposable database; only the
 * request/session, Next cache and logger are replaced.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
	createLifecycleDatabaseFixture,
	type LifecycleDatabaseFixture,
	type SeededEmployee,
} from "@/lib/employee-lifecycle/testing/database.test.fixture";

const harness = vi.hoisted(() => ({
	userId: null as string | null,
	organizationId: null as string | null,
}));

vi.mock("next/server", async (importOriginal) =>
	(await import("@/test/integration-harness")).nextServer(importOriginal),
);

vi.mock("next/headers", async () => (await import("@/test/integration-harness")).nextHeaders());

vi.mock("next/cache", async (importOriginal) =>
	(await import("@/test/integration-harness")).nextCache(importOriginal),
);

vi.mock("@/lib/auth", () => ({
	auth: {
		api: {
			getSession: async () =>
				harness.userId
					? {
							user: { id: harness.userId, role: "user", name: "Owner" },
							session: {
								id: `session-${harness.userId}`,
								userId: harness.userId,
								activeOrganizationId: harness.organizationId,
							},
						}
					: null,
		},
	},
}));

vi.mock("@/lib/organization-mfa/organization-access", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/lib/organization-mfa/organization-access")>()),
	canAccessOrganization: async () => true,
}));

vi.mock("@/lib/logger", () => ({
	createLogger: () => ({
		error: () => {},
		warn: () => {},
		info: () => {},
		debug: () => {},
		child: () => ({ error: () => {}, warn: () => {}, info: () => {}, debug: () => {} }),
	}),
}));

const { getTeam } = await import("./actions");
const { loadTeamSettingsPageData } = await import("./team-settings-page-data");

const PAST_CUTOFF = "2026-02-01T00:00:00Z";

describe("team settings member lists on PostgreSQL (#1438)", () => {
	vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
	let fixture: LifecycleDatabaseFixture;
	let deactivated: SeededEmployee;
	let due: SeededEmployee;
	const teamId = randomUUID();

	beforeAll(async () => {
		fixture = await createLifecycleDatabaseFixture();
		deactivated = await fixture.seedEmployee({ isActive: false });
		due = await fixture.seedEmployee();
		await fixture.pool.query(
			`insert into employee_departure
			 (organization_id, employee_id, employment_period_id, mode, last_working_day, timezone,
			  cutoff_at, created_by, request_id, request_fingerprint, revision, status)
			 values ($1, $2, $3, 'scheduled', '2026-01-31', 'UTC', $4, $5, gen_random_uuid(), 'test', 1,
			         'pending')`,
			[
				fixture.organizationId,
				due.employeeId,
				due.employmentPeriodId,
				PAST_CUTOFF,
				fixture.ownerUserId,
			],
		);
		await fixture.pool.query(
			`insert into team (id, organization_id, name, updated_at) values ($1, $2, 'Ops', now())`,
			[teamId, fixture.organizationId],
		);
		for (const employeeId of [fixture.employeeId, deactivated.employeeId, due.employeeId]) {
			await fixture.pool.query(
				`insert into team_membership (organization_id, team_id, employee_id, created_by)
				 values ($1, $2, $3, $4)`,
				[fixture.organizationId, teamId, employeeId, fixture.ownerUserId],
			);
		}
		harness.userId = fixture.ownerUserId;
		harness.organizationId = fixture.organizationId;
	});

	afterAll(async () => {
		await fixture?.close();
	});

	it("marks former members on the team detail page", async () => {
		const result = await getTeam(teamId);

		if (!result.success) throw new Error(result.error);
		expect(
			new Map((result.data.employees ?? []).map((member) => [member.id, member.isFormer])),
		).toEqual(
			new Map([
				[fixture.employeeId, false],
				[deactivated.employeeId, true],
				[due.employeeId, true],
			]),
		);
	});

	it("marks former employees among the organization's members on the teams page", async () => {
		const { scopedMembers } = await loadTeamSettingsPageData({
			organizationId: fixture.organizationId,
			settingsRouteContext: { accessTier: "orgAdmin" },
			principalContext: { permissions: { orgWide: null, byTeamId: new Map() } },
		});

		const former = new Map(
			scopedMembers.flatMap((entry) =>
				entry.employee ? [[entry.employee.id, entry.isFormerEmployee] as const] : [],
			),
		);
		expect(former.get(fixture.ownerEmployeeId)).toBe(false);
		expect(former.get(fixture.employeeId)).toBe(false);
		expect(former.get(deactivated.employeeId)).toBe(true);
		expect(former.get(due.employeeId)).toBe(true);
	});
});
