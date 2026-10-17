import { readFileSync } from "node:fs";
import path from "node:path";
import { eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Temporal } from "temporal-polyfill";
import { organization } from "@/db/auth-schema";
import {
	team,
	teamMembership,
	vacationAllowance,
	vacationPolicyAssignment,
} from "@/db/schema";
import {
	createLifecycleDatabaseFixture,
	type LifecycleDatabaseFixture,
} from "@/lib/employee-lifecycle/testing/database.test.fixture";
import {
	loadEmployeeVacationPolicy,
	loadEmployeeVacationPolicyPeriods,
} from "./vacation-policy-history";
import { loadVacationBalances } from "./vacation-balance-store";

const session = vi.hoisted(() => ({ userId: "", organizationId: "" }));
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
				user: { id: session.userId, role: "user", email: "owner@example.test" },
				session: {
					id: "vacation-history-regression-session",
					userId: session.userId,
					activeOrganizationId: session.organizationId,
				},
			}),
		},
	},
}));
const { deleteVacationPolicyAssignment } = await import(
	"@/app/[locale]/(app)/settings/vacation/assignment-actions"
);
const { updateVacationPolicy } = await import(
	"@/app/[locale]/(app)/settings/vacation/actions"
);
/** Public resolver regressions for dated history written through database compatibility paths. */
describe("vacation policy history compatibility", () => {
	let fixture: LifecycleDatabaseFixture;
	beforeEach(async () => {
		fixture = await createLifecycleDatabaseFixture();
		// These scenarios describe reviewed 2026/2027 history, independent of the database clock.
		await fixture.pool.query(
			"update vacation_policy_rollout set baseline_date=DATE '2026-01-01' where organization_id=$1",
			[fixture.organizationId],
		);
		session.userId = fixture.ownerUserId;
		session.organizationId = fixture.organizationId;
	});
	afterEach(async () => {
		vi.restoreAllMocks();
		await fixture?.close();
	});
	it("extends a policy through the public edit without leaving its new dates uncovered", async () => {
		const [policy] = await fixture.db
			.insert(vacationAllowance)
			.values({
				organizationId: fixture.organizationId,
				name: "Extended policy",
				startDate: "2027-01-01",
				validUntil: "2027-06-30",
				defaultAnnualDays: "25",
				statutoryMinimumDays: "20",
				accrualType: "annual",
				createdBy: fixture.ownerUserId,
			})
			.returning();
		await fixture.db.insert(vacationPolicyAssignment).values({
			organizationId: fixture.organizationId,
			policyId: policy.id,
			assignmentType: "employee",
			employeeId: fixture.employeeId,
			effectiveStartDate: "2027-01-01",
			createdBy: fixture.ownerUserId,
		});
		vi.spyOn(Temporal.Now, "plainDateISO").mockReturnValue(
			Temporal.PlainDate.from("2027-06-30"),
		);
		expect(
			await updateVacationPolicy(policy.id, {
				name: policy.name,
				startDate: policy.startDate,
				validUntil: "2027-12-31",
				isCompanyDefault: false,
				defaultAnnualDays: "25",
				accrualType: "annual",
				allowCarryover: false,
			}),
		).toMatchObject({ success: true });
		expect(
			await loadEmployeeVacationPolicy(fixture.db, {
				organizationId: fixture.organizationId,
				employeeId: fixture.employeeId,
				date: "2027-07-01",
			}),
		).toMatchObject({
			status: "resolved",
			policy: { id: policy.id, defaultAnnualDays: "25" },
		});
		expect(
			(
				await loadVacationBalances(fixture.db, {
					organizationId: fixture.organizationId,
					employeeIds: [fixture.employeeId],
					year: 2027,
					timezone: "UTC",
				})
			).balances.get(fixture.employeeId),
		).toMatchObject({ totalDays: 25 });
	});

	it("stores combined end-date and amount edits from their effective date while preserving earlier terms", async () => {
		const [policy] = await fixture.db
			.insert(vacationAllowance)
			.values({
				organizationId: fixture.organizationId,
				name: "Edited terms",
				startDate: "2027-01-01",
				defaultAnnualDays: "30",
				statutoryMinimumDays: "20",
				accrualType: "annual",
				createdBy: fixture.ownerUserId,
			})
			.returning();
		await fixture.db.insert(vacationPolicyAssignment).values({
			organizationId: fixture.organizationId,
			policyId: policy.id,
			assignmentType: "employee",
			employeeId: fixture.employeeId,
			effectiveStartDate: "2027-01-01",
			createdBy: fixture.ownerUserId,
		});
		vi.spyOn(Temporal.Now, "plainDateISO").mockReturnValue(
			Temporal.PlainDate.from("2027-07-01"),
		);
		expect(
			await updateVacationPolicy(policy.id, {
				name: policy.name,
				startDate: policy.startDate,
				validUntil: "2027-12-31",
				isCompanyDefault: false,
				defaultAnnualDays: "24",
				accrualType: "annual",
				allowCarryover: false,
			}),
		).toMatchObject({ success: true });
		for (const [date, days] of [
			["2027-06-30", "30"],
			["2027-07-01", "24"],
			["2027-12-31", "24"],
		]) {
			expect(
				await loadEmployeeVacationPolicy(fixture.db, {
					organizationId: fixture.organizationId,
					employeeId: fixture.employeeId,
					date,
				}),
			).toMatchObject({
				status: "resolved",
				policy: { id: policy.id, defaultAnnualDays: days },
			});
		}
		expect(
			(
				await loadVacationBalances(fixture.db, {
					organizationId: fixture.organizationId,
					employeeIds: [fixture.employeeId],
					year: 2027,
					timezone: "UTC",
				})
			).balances.get(fixture.employeeId),
		).toMatchObject({ totalDays: 27 });
	});
	it("interprets legacy UTC assignment instants in the organization zone independently of the database session", async () => {
		await fixture.db
			.update(organization)
			.set({ timezone: "America/Los_Angeles" })
			.where(eq(organization.id, fixture.organizationId));
		const [policy] = await fixture.db
			.insert(vacationAllowance)
			.values({
				organizationId: fixture.organizationId,
				name: "Legacy assigned policy",
				startDate: "2026-01-01",
				defaultAnnualDays: "25",
				statutoryMinimumDays: "20",
				accrualType: "annual",
				createdBy: fixture.ownerUserId,
			})
			.returning();
		for (const timezone of ["UTC", "Pacific/Honolulu"]) {
			const person = await fixture.seedEmployee();
			await fixture.db.transaction(async (tx) => {
				await tx.execute(sql`select set_config('TimeZone', ${timezone}, true)`);
				await tx.insert(vacationPolicyAssignment).values({
					organizationId: fixture.organizationId,
					policyId: policy.id,
					assignmentType: "employee",
					employeeId: person.employeeId,
					createdBy: fixture.ownerUserId,
					// 1 January, 16:30 in Los Angeles; a timestamp without zone stores the UTC boundary.
					effectiveFrom: new Date("2027-01-02T00:30:00.000Z"),
					effectiveUntil: new Date("2027-01-03T00:30:00.000Z"),
				});
				expect(
					await loadEmployeeVacationPolicy(tx, {
						organizationId: fixture.organizationId,
						employeeId: person.employeeId,
						date: "2027-01-01",
					}),
				).toMatchObject({
					status: "resolved",
					source: "employee",
					policy: { id: policy.id },
				});
				expect(
					await loadEmployeeVacationPolicy(tx, {
						organizationId: fixture.organizationId,
						employeeId: person.employeeId,
						date: "2027-01-02",
					}),
				).toEqual({ status: "missing" });
			});
		}
	});
	it("allows metadata edits after a policy expires without changing its earlier effective policy", async () => {
		const [policy] = await fixture.db
			.insert(vacationAllowance)
			.values({
				organizationId: fixture.organizationId,
				name: "Expired assigned policy",
				startDate: "2027-01-01",
				validUntil: "2027-06-30",
				defaultAnnualDays: "25",
				statutoryMinimumDays: "20",
				accrualType: "annual",
				createdBy: fixture.ownerUserId,
			})
			.returning();
		await fixture.db.insert(vacationPolicyAssignment).values({
			organizationId: fixture.organizationId,
			policyId: policy.id,
			assignmentType: "employee",
			employeeId: fixture.employeeId,
			createdBy: fixture.ownerUserId,
			effectiveStartDate: "2027-01-01",
		});
		await fixture.db.transaction(async (tx) => {
			await tx.execute(
				sql`select set_config('z8.vacation_effective_date', '2027-10-01', true)`,
			);
			await tx
				.update(vacationAllowance)
				.set({ name: "Renamed expired policy" })
				.where(eq(vacationAllowance.id, policy.id));
		});
		expect(
			await loadEmployeeVacationPolicy(fixture.db, {
				organizationId: fixture.organizationId,
				employeeId: fixture.employeeId,
				date: "2027-06-30",
			}),
		).toMatchObject({
			status: "resolved",
			policy: {
				id: policy.id,
				name: "Expired assigned policy",
				defaultAnnualDays: "25",
			},
		});
		expect(
			await loadEmployeeVacationPolicy(fixture.db, {
				organizationId: fixture.organizationId,
				employeeId: fixture.employeeId,
				date: "2027-07-01",
			}),
		).toEqual({ status: "missing" });
	});
	it("keeps the newer company default when an older overlapping default is edited", async () => {
		const policies = await fixture.db
			.insert(vacationAllowance)
			.values(
				[
					{
						name: "Older company default",
						startDate: "2027-01-01",
						defaultAnnualDays: "30",
					},
					{
						name: "Newer company default",
						startDate: "2027-07-01",
						defaultAnnualDays: "24",
					},
				].map((policy) => ({
					...policy,
					organizationId: fixture.organizationId,
					validUntil: "2029-12-31",
					isCompanyDefault: true,
					statutoryMinimumDays: "20",
					accrualType: "annual" as const,
					createdBy: fixture.ownerUserId,
				})),
			)
			.returning();
		const [older, newer] = policies;
		const scope = {
			organizationId: fixture.organizationId,
			employeeId: fixture.employeeId,
		};
		expect(
			await loadEmployeeVacationPolicy(fixture.db, {
				...scope,
				date: "2028-09-30",
			}),
		).toMatchObject({
			status: "resolved",
			source: "company_default",
			policy: { id: newer.id },
		});
		await fixture.db.transaction(async (tx) => {
			await tx.execute(
				sql`select set_config('z8.vacation_effective_date', '2028-10-01', true)`,
			);
			await tx
				.update(vacationAllowance)
				.set({ name: "Renamed older default" })
				.where(eq(vacationAllowance.id, older.id));
		});
		expect(
			await loadEmployeeVacationPolicy(fixture.db, {
				...scope,
				date: "2028-10-01",
			}),
		).toMatchObject({
			status: "resolved",
			source: "company_default",
			policy: { id: newer.id, defaultAnnualDays: "24" },
		});
	});
	it("refuses membership identity retargets without changing either employee's effective policy", async () => {
		const person = await fixture.seedEmployee();
		const foreignOrganizationId = await fixture.createOrganization();
		const foreignPerson = await fixture.seedEmployee({
			organizationId: foreignOrganizationId,
		});
		const [assignedTeam] = await fixture.db
			.insert(team)
			.values({ organizationId: fixture.organizationId, name: "Original team" })
			.returning();
		const [foreignTeam] = await fixture.db
			.insert(team)
			.values({ organizationId: foreignOrganizationId, name: "Foreign team" })
			.returning();
		const [policy] = await fixture.db
			.insert(vacationAllowance)
			.values({
				organizationId: fixture.organizationId,
				name: "Original team policy",
				startDate: "2027-01-01",
				defaultAnnualDays: "25",
				statutoryMinimumDays: "20",
				accrualType: "annual",
				createdBy: fixture.ownerUserId,
			})
			.returning();
		await fixture.db.insert(vacationPolicyAssignment).values({
			organizationId: fixture.organizationId,
			policyId: policy.id,
			assignmentType: "team",
			teamId: assignedTeam.id,
			createdBy: fixture.ownerUserId,
			effectiveStartDate: "2027-01-01",
		});
		const membership = await fixture.db.transaction(async (tx) => {
			await tx.execute(
				sql`select set_config('z8.vacation_effective_date', '2027-01-01', true)`,
			);
			const [row] = await tx
				.insert(teamMembership)
				.values({
					organizationId: fixture.organizationId,
					teamId: assignedTeam.id,
					employeeId: fixture.employeeId,
				})
				.returning();
			return row;
		});
		for (const destination of [
			{ employeeId: person.employeeId },
			{
				organizationId: foreignOrganizationId,
				employeeId: foreignPerson.employeeId,
				teamId: foreignTeam.id,
			},
		]) {
			await expect(
				fixture.db.transaction(async (tx) => {
					await tx.execute(
						sql`select set_config('z8.vacation_effective_date', '2027-07-01', true)`,
					);
					await tx
						.update(teamMembership)
						.set(destination)
						.where(eq(teamMembership.id, membership.id));
				}),
			).rejects.toMatchObject({
				cause: { message: expect.stringContaining("identity") },
			});
		}
		for (const date of ["2027-06-30", "2027-07-01"]) {
			expect(
				await loadEmployeeVacationPolicy(fixture.db, {
					organizationId: fixture.organizationId,
					employeeId: fixture.employeeId,
					date,
				}),
			).toMatchObject({
				status: "resolved",
				source: "team",
				policy: { id: policy.id },
			});
			expect(
				await loadEmployeeVacationPolicy(fixture.db, {
					organizationId: fixture.organizationId,
					employeeId: person.employeeId,
					date,
				}),
			).toEqual({ status: "missing" });
			expect(
				await loadEmployeeVacationPolicy(fixture.db, {
					organizationId: foreignOrganizationId,
					employeeId: foreignPerson.employeeId,
					date,
				}),
			).toEqual({ status: "missing" });
		}
	});
	it("keeps a removed team's closed eligibility when migration backfills run again", async () => {
		const [assignedTeam] = await fixture.db
			.insert(team)
			.values({ organizationId: fixture.organizationId, name: "Former team" })
			.returning();
		const [policy] = await fixture.db
			.insert(vacationAllowance)
			.values({
				organizationId: fixture.organizationId,
				name: "Former team policy",
				startDate: "2027-01-01",
				defaultAnnualDays: "25",
				statutoryMinimumDays: "20",
				accrualType: "annual",
				createdBy: fixture.ownerUserId,
			})
			.returning();
		await fixture.db.insert(vacationPolicyAssignment).values({
			organizationId: fixture.organizationId,
			policyId: policy.id,
			assignmentType: "team",
			teamId: assignedTeam.id,
			createdBy: fixture.ownerUserId,
			effectiveStartDate: "2027-01-01",
		});
		const membership = await fixture.db.transaction(async (tx) => {
			await tx.execute(
				sql`select set_config('z8.vacation_effective_date', '2027-01-01', true)`,
			);
			const [row] = await tx
				.insert(teamMembership)
				.values({
					organizationId: fixture.organizationId,
					teamId: assignedTeam.id,
					employeeId: fixture.employeeId,
				})
				.returning();
			return row;
		});
		await fixture.db.transaction(async (tx) => {
			await tx.execute(
				sql`select set_config('z8.vacation_effective_date', '2027-07-01', true)`,
			);
			await tx
				.delete(teamMembership)
				.where(eq(teamMembership.id, membership.id));
		});
		const expected = [
			["2027-01-01", "2027-06-30", policy.id],
			["2027-07-01", "2027-12-31", "missing"],
		];
		async function observedPeriods() {
			const periods = await loadEmployeeVacationPolicyPeriods(fixture.db, {
				organizationId: fixture.organizationId,
				employeeIds: [fixture.employeeId],
				startDate: "2027-01-01",
				endDate: "2027-12-31",
			});
			return periods
				.get(fixture.employeeId)
				?.map(({ startDate, endDate, resolution }) => [
					startDate,
					endDate,
					resolution.status === "resolved"
						? resolution.policy.id
						: resolution.status,
				]);
		}
		expect(await observedPeriods()).toEqual(expected);
		const backfills = readFileSync(
			path.join(process.cwd(), "drizzle/0264_vacation_policy_history.sql"),
			"utf8",
		)
			.split("--> statement-breakpoint")
			.map((statement) => statement.trim())
			.filter((statement) =>
				/^(?:INSERT INTO vacation_policy_rollout|UPDATE vacation_policy_assignment a SET|INSERT INTO vacation_team_eligibility|INSERT INTO vacation_policy_revision)/.test(
					statement,
				),
			);
		if (backfills.length === 0)
			throw new Error(
				"Vacation history migration must expose its data backfill statements",
			);
		for (let attempt = 0; attempt < 2; attempt++) {
			await fixture.db.transaction(async (tx) => {
				for (const statement of backfills) await tx.execute(sql.raw(statement));
			});
			expect(await observedPeriods()).toEqual(expected);
		}
	});
	it("does not extend a previously ended assignment when the public ending action is repeated", async () => {
		const [policy] = await fixture.db
			.insert(vacationAllowance)
			.values({
				organizationId: fixture.organizationId,
				name: "Ended employee policy",
				startDate: "2027-01-01",
				defaultAnnualDays: "25",
				statutoryMinimumDays: "20",
				accrualType: "annual",
				createdBy: fixture.ownerUserId,
			})
			.returning();
		const [assignment] = await fixture.db
			.insert(vacationPolicyAssignment)
			.values({
				organizationId: fixture.organizationId,
				policyId: policy.id,
				assignmentType: "employee",
				employeeId: fixture.employeeId,
				createdBy: fixture.ownerUserId,
				effectiveStartDate: "2027-01-01",
			})
			.returning();
		expect(
			await deleteVacationPolicyAssignment(assignment.id, "2027-07-01"),
		).toMatchObject({
			success: true,
		});
		expect(
			await deleteVacationPolicyAssignment(assignment.id, "2027-08-01"),
		).toMatchObject({
			success: true,
		});
		expect(
			await loadEmployeeVacationPolicy(fixture.db, {
				organizationId: fixture.organizationId,
				employeeId: fixture.employeeId,
				date: "2027-06-30",
			}),
		).toMatchObject({ status: "resolved", policy: { id: policy.id } });
		expect(
			await loadEmployeeVacationPolicy(fixture.db, {
				organizationId: fixture.organizationId,
				employeeId: fixture.employeeId,
				date: "2027-07-01",
			}),
		).toEqual({ status: "missing" });
	});
	it("keeps explicit history deletion blocked while allowing existing demo employee cleanup", async () => {
		const [policy] = await fixture.db
			.insert(vacationAllowance)
			.values({
				organizationId: fixture.organizationId,
				name: "Demo cleanup policy",
				startDate: "2027-01-01",
				defaultAnnualDays: "25",
				statutoryMinimumDays: "20",
				accrualType: "annual",
				createdBy: fixture.ownerUserId,
			})
			.returning();
		const [assignment] = await fixture.db
			.insert(vacationPolicyAssignment)
			.values({
				organizationId: fixture.organizationId,
				policyId: policy.id,
				assignmentType: "employee",
				employeeId: fixture.employeeId,
				createdBy: fixture.ownerUserId,
				effectiveStartDate: "2027-01-01",
			})
			.returning();
		await expect(
			fixture.db
				.delete(vacationPolicyAssignment)
				.where(eq(vacationPolicyAssignment.id, assignment.id)),
		).rejects.toThrow();
		const { deleteNonAdminEmployeesData } = await import(
			"@/lib/demo/delete-non-admin"
		);
		await expect(
			deleteNonAdminEmployeesData(fixture.organizationId, fixture.ownerUserId),
		).resolves.toMatchObject({ employeesDeleted: 1 });
	});
});
