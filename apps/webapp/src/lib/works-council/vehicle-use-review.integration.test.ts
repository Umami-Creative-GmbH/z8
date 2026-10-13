/**
 * #1130: the works-council portal's vehicle use section and the review export
 * on PostgreSQL. The section shows the switch, assignments with their mode,
 * covered employees and the vehicle count of one organization only, names
 * follow the works council's identity visibility, and no odometer reading or
 * driven distance is ever part of it. Only the session is mocked.
 */

import { TolgeeProvider } from "@tolgee/react";
import type { NextRequest } from "next/server";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { VehicleUseReviewSection } from "@/components/works-council/vehicle-use-review-section";
import { integrationAdminPool } from "@/test/integration-database";
import { createTestTolgee } from "@/test/render-with-translations";

const harness = vi.hoisted(() => ({
	userId: null as string | null,
	organizationId: null as string | null,
}));

vi.mock("next/headers", async () => (await import("@/test/integration-harness")).nextHeaders());
vi.mock("next/server", async (importOriginal) =>
	(await import("@/test/integration-harness")).nextServer(importOriginal),
);
vi.mock("next/cache", async (importOriginal) =>
	(await import("@/test/integration-harness")).nextCache(importOriginal),
);
vi.mock("@/lib/auth", () => ({
	auth: {
		api: {
			getSession: async () =>
				harness.userId
					? {
							user: { id: harness.userId, role: "user" },
							session: {
								id: `t1130-session-${harness.userId}`,
								userId: harness.userId,
								activeOrganizationId: harness.organizationId,
							},
						}
					: null,
		},
	},
}));
vi.mock("@/lib/billing/guard", async () =>
	(await import("@/test/integration-harness")).billingGuard(),
);

const { POST } = await import("@/app/[locale]/(app)/works-council/export/route");
const { loadWorksCouncilVehicleUseReview } = await import("./vehicle-use-review-data");

const ids = {
	organization: "t1130-vehicle-org",
	otherOrganization: "t1130-other-org",
	ownerUser: "t1130-owner-user",
	annaUser: "t1130-anna-user",
	benUser: "t1130-ben-user",
	carlUser: "t1130-carl-user",
	ivoUser: "t1130-ivo-user",
	foreignUser: "t1130-foreign-user",
	owner: "d1130000-0000-4000-8000-000000000001",
	anna: "d1130000-0000-4000-8000-000000000002",
	ben: "d1130000-0000-4000-8000-000000000003",
	carl: "d1130000-0000-4000-8000-000000000004",
	ivo: "d1130000-0000-4000-8000-000000000005",
	foreign: "d1130000-0000-4000-8000-000000000006",
	team: "d1130000-0000-4000-8000-0000000000d1",
	foreignTeam: "d1130000-0000-4000-8000-0000000000d2",
} as const;

const names: Record<string, string> = {
	[ids.ownerUser]: "Olga Overseer",
	[ids.annaUser]: "Anna Fieldworker",
	[ids.benUser]: "Ben Backoffice",
	[ids.carlUser]: "Carl Courier",
	[ids.ivoUser]: "Ivo Inactive",
	[ids.foreignUser]: "Fiona Foreign",
};
const users = Object.keys(names);
const personNames = Object.values(names);

describe("works-council vehicle use section on PostgreSQL", () => {
	vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
	const pool = integrationAdminPool();

	async function cleanup() {
		await pool.query("delete from organization where id in ($1, $2)", [
			ids.organization,
			ids.otherOrganization,
		]);
		await pool.query('delete from "user" where id = any($1::text[])', [users]);
	}

	async function seed() {
		await cleanup();
		const at = new Date("2026-01-01T00:00:00Z");
		await pool.query(
			`insert into organization (id, name, slug, timezone, created_at, works_council_enabled) values
			 ($1, 'T1130 vehicles', $1, 'Europe/Berlin', $3, true), ($2, 'T1130 other', $2, 'UTC', $3, true)`,
			[ids.organization, ids.otherOrganization, at],
		);
		for (const userId of users) {
			await pool.query(
				`insert into "user" (id, name, email, role, created_at, updated_at)
				 values ($1, $2, $1 || '@example.test', 'user', $3, $3)`,
				[userId, names[userId], at],
			);
			const organizationId = userId === ids.foreignUser ? ids.otherOrganization : ids.organization;
			await pool.query(
				`insert into member (id, organization_id, user_id, role, status, created_at)
				 values ($1, $2, $3, $4, 'approved', $5)`,
				[
					`m-${userId}`,
					organizationId,
					userId,
					userId === ids.ownerUser || userId === ids.foreignUser ? "owner" : "member",
					at,
				],
			);
		}
		await pool.query(
			`insert into team (id, organization_id, name, updated_at) values
			 ($1, $2, 'Field service', $5), ($3, $4, 'Foreign field', $5)`,
			[ids.team, ids.organization, ids.foreignTeam, ids.otherOrganization, at],
		);
		const employees: Array<[string, string, string, string | null, boolean]> = [
			[ids.owner, ids.ownerUser, ids.organization, null, true],
			[ids.anna, ids.annaUser, ids.organization, ids.team, true],
			[ids.ben, ids.benUser, ids.organization, null, true],
			[ids.carl, ids.carlUser, ids.organization, ids.team, true],
			[ids.ivo, ids.ivoUser, ids.organization, ids.team, false],
			[ids.foreign, ids.foreignUser, ids.otherOrganization, ids.foreignTeam, true],
		];
		for (const [employeeId, userId, organizationId, teamId, isActive] of employees) {
			await pool.query(
				`insert into employee (id, user_id, organization_id, role, team_id, is_active, updated_at)
				 values ($1, $2, $3, $4, $5, $6, $7)`,
				[
					employeeId,
					userId,
					organizationId,
					userId === ids.ownerUser || userId === ids.foreignUser ? "admin" : "employee",
					teamId,
					isActive,
					at,
				],
			);
		}

		// Vehicle use on: expected of the field team, asked of Ben, Anna excluded.
		// The other organization has its own, broader configuration.
		await pool.query(
			`insert into vehicle_use_setting (organization_id, enabled) values ($1, true), ($2, true)`,
			[ids.organization, ids.otherOrganization],
		);
		await pool.query(
			`insert into vehicle_use_assignment (organization_id, assignment_type, team_id, employee_id, priority, mode, created_by) values
			 ($1, 'team', $2, null, 1, 'expected', $5),
			 ($1, 'employee', null, $3, 2, 'asked', $5),
			 ($1, 'employee', null, $4, 2, 'off', $5),
			 ($6, 'organization', null, null, 0, 'expected', $7),
			 ($6, 'team', $8, null, 1, 'asked', $7),
			 ($6, 'employee', null, $9, 2, 'asked', $7)`,
			[
				ids.organization,
				ids.team,
				ids.ben,
				ids.anna,
				ids.ownerUser,
				ids.otherOrganization,
				ids.foreignUser,
				ids.foreignTeam,
				ids.foreign,
			],
		);
		await pool.query(
			`insert into organization_vehicle (organization_id, name, licence_plate, archived_at) values
			 ($1, 'Van 1', 'B-AB 1001', null),
			 ($1, 'Van 2', 'B-AB 1002', null),
			 ($1, 'Old van', 'B-AB 1003', $3),
			 ($2, 'Foreign van', 'M-XY 1', null)`,
			[ids.organization, ids.otherOrganization, at],
		);
	}

	async function setWorksCouncil(
		identityVisibility: "aggregated" | "pseudonymized" | "named",
		minimumAggregationThreshold = 1,
	) {
		await pool.query(
			`insert into works_council_settings (organization_id, enabled, identity_visibility, export_enabled,
				minimum_aggregation_threshold, updated_at)
			 values ($1, true, $2, true, $3, now())
			 on conflict (organization_id) do update set identity_visibility = excluded.identity_visibility,
				minimum_aggregation_threshold = excluded.minimum_aggregation_threshold`,
			[ids.organization, identityVisibility, minimumAggregationThreshold],
		);
		return { identityVisibility, minimumAggregationThreshold };
	}

	async function exportCsv(): Promise<string> {
		harness.userId = ids.ownerUser;
		harness.organizationId = ids.organization;
		const response = await POST(
			new Request(
				"https://app.example.test/en/works-council/export?from=2026-09-01&to=2026-09-30",
				{ method: "POST" },
			) as NextRequest,
		);
		expect(response.status).toBe(200);
		return response.text();
	}

	async function renderSection(
		identityVisibility: "aggregated" | "pseudonymized" | "named",
		minimumAggregationThreshold = 1,
	) {
		const review = await loadWorksCouncilVehicleUseReview({
			organizationId: ids.organization,
			settings: await setWorksCouncil(identityVisibility, minimumAggregationThreshold),
		});
		const tolgee = createTestTolgee();
		return {
			review,
			html: renderToStaticMarkup(
				createElement(
					TolgeeProvider,
					{ tolgee, fallback: null },
					createElement(VehicleUseReviewSection, { review, t: tolgee.t }),
				),
			),
		};
	}

	beforeEach(async () => {
		harness.userId = null;
		harness.organizationId = null;
		await seed();
	});

	afterAll(async () => {
		await cleanup();
	});

	it("shows this organization's switch, assignments, covered employees and vehicle count", async () => {
		const { review } = await renderSection("named");

		expect(review).toEqual({
			enabled: true,
			organizationAssignment: null,
			teamAssignments: [{ teamName: "Field service", mode: "expected" }],
			employeeAssignments: {
				state: "listed",
				rows: [
					{ employee: { kind: "named", name: "Anna Fieldworker" }, mode: "off" },
					{ employee: { kind: "named", name: "Ben Backoffice" }, mode: "asked" },
				],
			},
			// Carl (team) expected, Ben asked; Anna excluded, Ivo inactive, the owner unassigned.
			coveredEmployees: { state: "available", coveredEmployees: 2, asked: 1, expected: 1 },
			vehicles: { active: 2, archived: 1 },
		});
	});

	it("names employees only under named identity visibility, in the section and the review pack", async () => {
		const { html } = await renderSection("named");
		expect(html).toContain("Anna Fieldworker");
		expect(html).toContain("Ben Backoffice");

		const csv = await exportCsv();
		expect(csv).toContain('"Vehicle use enabled","yes"');
		expect(csv).toContain('"Team assignment","Field service","expected"');
		expect(csv).toContain('"Employee assignment","Ben Backoffice","asked"');
		expect(csv).toContain('"Organization vehicles (active)","2"');
		expect(csv).not.toContain("Foreign");
	});

	it("shows no employee name when identities are pseudonymized or aggregated", async () => {
		for (const identityVisibility of ["pseudonymized", "aggregated"] as const) {
			const { html } = await renderSection(identityVisibility);
			const csv = await exportCsv();
			for (const text of [html, csv]) {
				for (const name of personNames) expect(text).not.toContain(name);
			}
			expect(csv).toContain('"Vehicle use: covered employees","2"');
			if (identityVisibility === "pseudonymized") {
				expect(csv).toContain('"Employee assignment","Employee B","asked"');
			} else {
				expect(csv).toContain('"Employee assignments asked","1"');
			}
		}
	});

	it("withholds the asked/expected split below the minimum aggregation threshold", async () => {
		const { review } = await renderSection("aggregated", 3);
		expect(review.coveredEmployees).toEqual({ state: "insufficient_data", coveredEmployees: 2 });

		const csv = await exportCsv();
		expect(csv).toContain('"Vehicle use counts","insufficient_data"');
		expect(csv).not.toContain('"Vehicle use: asked"');
	});

	it("never carries an odometer reading or a driven distance", async () => {
		// The section renders only the review model, so the model and the pack's
		// rows are where a reading or distance would have to show up.
		const { review } = await renderSection("named");
		const csv = await exportCsv();
		const vehicleUseCsv = csv.slice(csv.indexOf('"Vehicle use"'));

		expect(vehicleUseCsv).toContain('"Vehicle use enabled"');
		for (const text of [JSON.stringify(review), vehicleUseCsv]) {
			expect(text).not.toMatch(/reading|distance|odometer|kilomet|\bkm\b/i);
		}
	});
});
