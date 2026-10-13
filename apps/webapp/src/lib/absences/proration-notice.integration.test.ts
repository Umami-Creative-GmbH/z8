/**
 * #1112: the one-time list of employees whose 2026 allowance is now prorated, against
 * PostgreSQL, and its organization-wide dismissal.
 *
 * Local contract: pnpm --filter webapp test:integration
 */

import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { LifecycleDatabaseFixture } from "@/lib/employee-lifecycle/testing/database.test.fixture";

vi.mock("next/headers", async () => (await import("@/test/integration-harness")).nextHeaders());
vi.mock("next/server", async (original) =>
	(await import("@/test/integration-harness")).nextServer(original),
);
vi.mock("next/cache", async (original) =>
	(await import("@/test/integration-harness")).nextCache(original),
);

const { absenceCategory, absenceEntry, employeeVacationAllowance, vacationAllowance } =
	await import("@/db/schema");
const { createLifecycleDatabaseFixture } = await import(
	"@/lib/employee-lifecycle/testing/database.test.fixture"
);
const { dismissProrationNotice, loadProrationNotice } = await import("./proration-notice-store");

const utcDate = (date: string) => new Date(`${date}T00:00:00.000Z`);

describe("one-time proration notice (#1112)", () => {
	let fixture: LifecycleDatabaseFixture;
	let foreignOrganizationId: string;
	let joinerId: string;
	let leaverId: string;
	let departedId: string;
	let customJoinerId: string;
	let foreignJoinerId: string;

	async function seedLegacyPeriod(input: {
		organizationId?: string;
		employeeId: string;
		startedAt: Date;
		endedAt?: Date;
	}) {
		const periodId = randomUUID();
		await fixture.pool.query(
			`insert into employee_employment_period
			 (id, organization_id, employee_id, status, started_at, ended_at, start_provenance)
			 values ($1, $2, $3, $4, $5, $6, 'legacy')`,
			[
				periodId,
				input.organizationId ?? fixture.organizationId,
				input.employeeId,
				input.endedAt ? "closed" : "open",
				input.startedAt,
				input.endedAt ?? null,
			],
		);
		return periodId;
	}

	async function seedDeparture(input: {
		employeeId: string;
		periodId: string;
		lastWorkingDay: string;
		cutoffAt: Date;
		status: "pending" | "effective";
	}) {
		await fixture.pool.query(
			`insert into employee_departure
			 (organization_id, employee_id, employment_period_id, mode, last_working_day, timezone,
			  cutoff_at, effective_at, revision, status, created_by, request_id, request_fingerprint)
			 values ($1, $2, $3, 'scheduled', $4, 'UTC', $5, $6, 1, $7, $8, $9, 'fp')`,
			[
				fixture.organizationId,
				input.employeeId,
				input.periodId,
				input.lastWorkingDay,
				input.cutoffAt,
				input.status === "effective" ? input.cutoffAt : null,
				input.status,
				fixture.ownerUserId,
				randomUUID(),
			],
		);
	}

	async function seedPolicy(organizationId: string) {
		await fixture.db.insert(vacationAllowance).values({
			organizationId,
			name: "Default",
			startDate: "2025-01-01",
			isCompanyDefault: true,
			defaultAnnualDays: "30",
			allowCarryover: true,
			statutoryMinimumDays: "20",
			accrualType: "annual",
			createdBy: fixture.ownerUserId,
		});
	}

	beforeAll(async () => {
		fixture = await createLifecycleDatabaseFixture();
		await seedPolicy(fixture.organizationId);

		// Joined on 1 October (8 days) and already took two weeks of vacation: 2 days overdrawn.
		joinerId = (await fixture.seedEmployee({ startDate: utcDate("2026-10-01"), withPeriod: false }))
			.employeeId;
		await seedLegacyPeriod({ employeeId: joinerId, startedAt: utcDate("2026-10-01") });
		const [vacation] = await fixture.db
			.insert(absenceCategory)
			.values({ organizationId: fixture.organizationId, name: "Vacation", type: "vacation" })
			.returning();
		await fixture.db.insert(absenceEntry).values({
			organizationId: fixture.organizationId,
			employeeId: joinerId,
			categoryId: vacation.id,
			startDate: "2026-10-05",
			endDate: "2026-10-16",
			status: "approved",
		});

		// Leaves on 30 November, a last working day still ahead: 11 months, 28 days.
		leaverId = (await fixture.seedEmployee({ startDate: utcDate("2020-01-01"), withPeriod: false }))
			.employeeId;
		await seedDeparture({
			employeeId: leaverId,
			periodId: await seedLegacyPeriod({ employeeId: leaverId, startedAt: utcDate("2020-01-01") }),
			lastWorkingDay: "2026-11-30",
			cutoffAt: utcDate("2026-12-01"),
			status: "pending",
		});

		// Left on 31 March and is no longer active: 3 months, 7.5 → 8 days, no floor.
		departedId = (
			await fixture.seedEmployee({
				startDate: utcDate("2020-01-01"),
				withPeriod: false,
				isActive: false,
			})
		).employeeId;
		await seedDeparture({
			employeeId: departedId,
			periodId: await seedLegacyPeriod({
				employeeId: departedId,
				startedAt: utcDate("2020-01-01"),
				endedAt: utcDate("2026-04-01"),
			}),
			lastWorkingDay: "2026-03-31",
			cutoffAt: utcDate("2026-04-01"),
			status: "effective",
		});

		// A custom allowance is final, so the joiner's allowance did not change.
		customJoinerId = (
			await fixture.seedEmployee({ startDate: utcDate("2026-10-01"), withPeriod: false })
		).employeeId;
		await fixture.db.insert(employeeVacationAllowance).values({
			employeeId: customJoinerId,
			year: 2026,
			customAnnualDays: "25",
		});

		foreignOrganizationId = await fixture.createOrganization();
		await seedPolicy(foreignOrganizationId);
		foreignJoinerId = (
			await fixture.seedEmployee({
				organizationId: foreignOrganizationId,
				startDate: utcDate("2026-10-01"),
				withPeriod: false,
			})
		).employeeId;
	});

	afterAll(async () => {
		await fixture?.close();
	});

	it("lists every prorated 2026 joiner and leaver of the organization with overdrawn days", async () => {
		const rows = await loadProrationNotice(fixture.db, { organizationId: fixture.organizationId });

		expect(
			rows
				?.map(({ employeeId, fullAllowance, proratedAllowance, overdrawnDays }) => ({
					employeeId,
					fullAllowance,
					proratedAllowance,
					overdrawnDays,
				}))
				.toSorted((left, right) => left.employeeId.localeCompare(right.employeeId)),
		).toEqual(
			[
				{ employeeId: joinerId, fullAllowance: 30, proratedAllowance: 8, overdrawnDays: 2 },
				{ employeeId: leaverId, fullAllowance: 30, proratedAllowance: 28, overdrawnDays: 0 },
				{ employeeId: departedId, fullAllowance: 30, proratedAllowance: 8, overdrawnDays: 0 },
			].toSorted((left, right) => left.employeeId.localeCompare(right.employeeId)),
		);
		expect(rows?.[0]?.name).toBe("Lifecycle");
	});

	it("hides the notice for the whole organization once dismissed, and only there", async () => {
		await dismissProrationNotice(fixture.db, {
			organizationId: fixture.organizationId,
			actorUserId: fixture.ownerUserId,
		});
		// A second dismissal keeps the first one.
		await dismissProrationNotice(fixture.db, {
			organizationId: fixture.organizationId,
			actorUserId: fixture.ownerUserId,
		});

		expect(await loadProrationNotice(fixture.db, { organizationId: fixture.organizationId })).toBe(
			null,
		);
		expect(
			(await loadProrationNotice(fixture.db, { organizationId: foreignOrganizationId }))?.map(
				(row) => row.employeeId,
			),
		).toEqual([foreignJoinerId]);
	});
});
