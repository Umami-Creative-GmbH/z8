import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
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

import { loadCompanyDefaultVacationPolicy } from "./vacation-policy-store";

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
					id: "test-session",
					userId: session.userId,
					activeOrganizationId: session.organizationId,
				},
			}),
		},
	},
}));
vi.mock("@/lib/notifications/triggers", async (original) =>
	(await import("@/test/integration-harness")).notificationTriggers(original),
);
const { addTeamMember } = await import(
	"@/app/[locale]/(app)/settings/teams/actions"
);
const { createVacationPolicy, updateVacationPolicy } = await import(
	"@/app/[locale]/(app)/settings/vacation/actions"
);
const {
	setEmployeePolicyAssignment,
	previewEmployeeVacationPolicy,
	createVacationPolicyAssignment,
	deleteVacationPolicyAssignment,
} = await import("@/app/[locale]/(app)/settings/vacation/assignment-actions");
describe("dated employee vacation policy eligibility (#989)", () => {
	let fixture: LifecycleDatabaseFixture;
	beforeAll(async () => {
		fixture = await createLifecycleDatabaseFixture();
		session.userId = fixture.ownerUserId;
		session.organizationId = fixture.organizationId;
	});
	afterAll(async () => {
		await fixture?.close();
	});
	it("previews the team's 25 days while the staged legacy balance keeps its company default", async () => {
		const [company, assigned] = await fixture.db
			.insert(vacationAllowance)
			.values(
				[30, 25].map((days) => ({
					organizationId: fixture.organizationId,
					name: `${days} days`,
					startDate: "2026-01-01",
					isCompanyDefault: days === 30,
					defaultAnnualDays: String(days),
					statutoryMinimumDays: "20",
					accrualType: "annual" as const,
					createdBy: fixture.ownerUserId,
				})),
			)
			.returning();
		const [targetTeam] = await fixture.db
			.insert(team)
			.values({ organizationId: fixture.organizationId, name: "Assigned team" })
			.returning();
		await fixture.db.insert(teamMembership).values({
			organizationId: fixture.organizationId,
			teamId: targetTeam.id,
			employeeId: fixture.employeeId,
		});
		await fixture.db.insert(vacationPolicyAssignment).values({
			organizationId: fixture.organizationId,
			policyId: assigned.id,
			assignmentType: "team",
			teamId: targetTeam.id,
			createdBy: fixture.ownerUserId,
		});
		expect(
			await loadCompanyDefaultVacationPolicy(fixture.db, {
				organizationId: fixture.organizationId,
				year: 2027,
			}),
		).toMatchObject({ id: company.id, defaultAnnualDays: "30" });
		const result = await loadEmployeeVacationPolicy(fixture.db, {
			organizationId: fixture.organizationId,
			employeeId: fixture.employeeId,
			date: "2027-01-01",
		});
		expect(result).toMatchObject({
			status: "resolved",
			source: "team",
			policy: { id: assigned.id, defaultAnnualDays: "25" },
		});
	});
	it("schedules an employee replacement and preserves the old policy on its earlier dates", async () => {
		const [oldPolicy, newPolicy] = await fixture.db
			.insert(vacationAllowance)
			.values(
				[26, 24].map((days) => ({
					organizationId: fixture.organizationId,
					name: `Replacement ${days}`,
					startDate: "2026-01-01",
					defaultAnnualDays: String(days),
					statutoryMinimumDays: "20",
					accrualType: "annual" as const,
					createdBy: fixture.ownerUserId,
				})),
			)
			.returning();
		expect(
			await setEmployeePolicyAssignment(fixture.employeeId, oldPolicy.id, {
				effectiveFrom: "2027-01-01",
			}),
		).toMatchObject({ success: true });
		expect(
			await setEmployeePolicyAssignment(fixture.employeeId, newPolicy.id, {
				effectiveFrom: "2027-07-01",
			}),
		).toMatchObject({ success: true });
		expect(
			await previewEmployeeVacationPolicy(fixture.employeeId, "2027-06-30"),
		).toMatchObject({
			success: true,
			data: {
				status: "resolved",
				source: "employee",
				policy: { id: oldPolicy.id },
			},
		});
		expect(
			await previewEmployeeVacationPolicy(fixture.employeeId, "2027-07-01"),
		).toMatchObject({
			success: true,
			data: {
				status: "resolved",
				source: "employee",
				policy: { id: newPolicy.id },
			},
		});
	});
	it("rejects a mid-year assignment method transition but accepts 1 January", async () => {
		const [monthly] = await fixture.db
			.insert(vacationAllowance)
			.values({
				organizationId: fixture.organizationId,
				name: "Monthly alternative",
				startDate: "2026-01-01",
				defaultAnnualDays: "24",
				statutoryMinimumDays: "20",
				accrualType: "monthly",
				createdBy: fixture.ownerUserId,
			})
			.returning();
		expect(
			await setEmployeePolicyAssignment(fixture.employeeId, monthly.id, {
				effectiveFrom: "2028-07-01",
			}),
		).toMatchObject({
			success: false,
			error: expect.stringContaining("1 January"),
		});
		expect(
			await setEmployeePolicyAssignment(fixture.employeeId, monthly.id, {
				effectiveFrom: "2028-01-01",
			}),
		).toMatchObject({ success: true });
	});
	it("returns exact per-employee policy periods for annual consumers", async () => {
		const periods = await loadEmployeeVacationPolicyPeriods(fixture.db, {
			organizationId: fixture.organizationId,
			employeeIds: [fixture.employeeId],
			startDate: "2027-01-01",
			endDate: "2027-12-31",
		});
		expect(
			periods
				.get(fixture.employeeId)
				?.map((p) => [
					p.startDate,
					p.endDate,
					p.resolution.status === "resolved"
						? p.resolution.policy.defaultAnnualDays
						: p.resolution.status,
				]),
		).toEqual([
			["2027-01-01", "2027-06-30", "26"],
			["2027-07-01", "2027-12-31", "24"],
		]);
	});
	it("shows an incompatible undated rollout as configuration conflict rather than applying a mixed method", async () => {
		const target = await fixture.seedEmployee();
		const [monthly] = await fixture.db
			.insert(vacationAllowance)
			.values({
				organizationId: fixture.organizationId,
				name: "Legacy monthly",
				startDate: "2026-01-01",
				defaultAnnualDays: "24",
				statutoryMinimumDays: "20",
				accrualType: "monthly",
				createdBy: fixture.ownerUserId,
			})
			.returning();
		await fixture.db.insert(vacationPolicyAssignment).values({
			organizationId: fixture.organizationId,
			policyId: monthly.id,
			assignmentType: "employee",
			employeeId: target.employeeId,
			legacyBaseline: true,
			createdBy: fixture.ownerUserId,
		});
		expect(
			await loadEmployeeVacationPolicy(fixture.db, {
				organizationId: fixture.organizationId,
				employeeId: target.employeeId,
				date: "2026-12-31",
			}),
		).toMatchObject({ status: "conflict", reason: "incompatible_transition" });
		const crossYear = await loadEmployeeVacationPolicyPeriods(fixture.db, {
			organizationId: fixture.organizationId,
			employeeIds: [target.employeeId],
			startDate: "2026-12-31",
			endDate: "2027-01-01",
		});
		expect(crossYear.get(target.employeeId)).toMatchObject([
			{
				startDate: "2026-12-31",
				endDate: "2026-12-31",
				resolution: { status: "conflict", reason: "incompatible_transition" },
			},
			{
				startDate: "2027-01-01",
				endDate: "2027-01-01",
				resolution: { status: "resolved", policy: { accrualType: "monthly" } },
			},
		]);
	});
	it("rejects changing calculation method across an unconfigured gap in the same year", async () => {
		const gap = await createLifecycleDatabaseFixture();
		try {
			session.userId = gap.ownerUserId;
			session.organizationId = gap.organizationId;
			const [annual, monthly] = await gap.db
				.insert(vacationAllowance)
				.values(
					["annual", "monthly"].map((accrualType) => ({
						organizationId: gap.organizationId,
						name: accrualType,
						startDate: "2027-01-01",
						defaultAnnualDays: "24",
						statutoryMinimumDays: "20",
						accrualType: accrualType as "annual" | "monthly",
						createdBy: gap.ownerUserId,
					})),
				)
				.returning();
			expect(
				await setEmployeePolicyAssignment(gap.employeeId, annual.id, {
					effectiveFrom: "2027-01-01",
					effectiveUntil: "2027-07-01",
				}),
			).toMatchObject({ success: true });
			expect(
				await setEmployeePolicyAssignment(gap.employeeId, monthly.id, {
					effectiveFrom: "2027-08-01",
				}),
			).toMatchObject({
				success: false,
				error: expect.stringContaining("1 January"),
			});
		} finally {
			await gap.close();
			session.userId = fixture.ownerUserId;
			session.organizationId = fixture.organizationId;
		}
	});
	it("rejects an invalid replacement company default atomically with a clear error", async () => {
		const result = await createVacationPolicy({
			organizationId: fixture.organizationId,
			name: "Invalid July default",
			startDate: "2029-07-01",
			isCompanyDefault: true,
			defaultAnnualDays: "24",
			accrualType: "monthly",
			allowCarryover: false,
		});
		expect(result).toMatchObject({
			success: false,
			error: expect.stringContaining("1 January"),
		});
		expect(
			await loadEmployeeVacationPolicy(fixture.db, {
				organizationId: fixture.organizationId,
				employeeId: fixture.ownerEmployeeId,
				date: "2029-08-01",
			}),
		).toMatchObject({
			status: "resolved",
			source: "company_default",
			policy: { defaultAnnualDays: "30" },
		});
	});
	it("reviews a backdated employee assignment without changing another employee's legacy baseline", async () => {
		const target = await fixture.seedEmployee();
		const [policy] = await fixture.db
			.insert(vacationAllowance)
			.values({
				organizationId: fixture.organizationId,
				name: "Reviewed annual",
				startDate: "2026-01-01",
				defaultAnnualDays: "28",
				statutoryMinimumDays: "20",
				accrualType: "annual",
				createdBy: fixture.ownerUserId,
			})
			.returning();
		expect(
			await setEmployeePolicyAssignment(target.employeeId, policy.id, {
				effectiveFrom: "2026-01-01",
				reviewedBackdate: true,
			}),
		).toMatchObject({ success: true });
		expect(
			await previewEmployeeVacationPolicy(target.employeeId, "2026-01-01"),
		).toMatchObject({
			success: true,
			data: {
				status: "resolved",
				source: "employee",
				policy: { id: policy.id },
			},
		});
		expect(
			await previewEmployeeVacationPolicy(
				fixture.ownerEmployeeId,
				"2026-01-01",
			),
		).toMatchObject({ success: true, data: { status: "legacy" } });
	});
	it("rejects a team membership change that introduces a midyear method transition", async () => {
		const target = await fixture.seedEmployee();
		const [monthly] = await fixture.db
			.insert(vacationAllowance)
			.values({
				organizationId: fixture.organizationId,
				name: "Team monthly",
				startDate: "2026-01-01",
				defaultAnnualDays: "24",
				statutoryMinimumDays: "20",
				accrualType: "monthly",
				createdBy: fixture.ownerUserId,
			})
			.returning();
		const [targetTeam] = await fixture.db
			.insert(team)
			.values({ organizationId: fixture.organizationId, name: "Monthly team" })
			.returning();
		expect(
			await createVacationPolicyAssignment({
				policyId: monthly.id,
				assignmentType: "team",
				teamId: targetTeam.id,
				effectiveFrom: "2026-01-01",
				reviewedBackdate: true,
			}),
		).toMatchObject({ success: true });
		expect(await addTeamMember(targetTeam.id, target.employeeId)).toMatchObject(
			{
				success: false,
				error: expect.stringContaining("1 January"),
			},
		);
		expect(
			await previewEmployeeVacationPolicy(target.employeeId, "2026-12-31"),
		).toMatchObject({
			success: true,
			data: { status: "resolved", source: "company_default" },
		});
	});
	it("coalesces all matching teams, reports conflicting teams, and lets a valid employee assignment win", async () => {
		const target = await fixture.seedEmployee();
		const policies = await fixture.db
			.insert(vacationAllowance)
			.values(
				[25, 24, 26].map((days) => ({
					organizationId: fixture.organizationId,
					name: `Team combination ${days}`,
					startDate: "2030-01-01",
					defaultAnnualDays: String(days),
					statutoryMinimumDays: "20",
					accrualType: "annual" as const,
					createdBy: fixture.ownerUserId,
				})),
			)
			.returning();
		const teams = await fixture.db
			.insert(team)
			.values(
				["A", "B"].map((name) => ({
					organizationId: fixture.organizationId,
					name: `Combination ${name}`,
				})),
			)
			.returning();
		for (const item of teams) {
			expect(await addTeamMember(item.id, target.employeeId)).toMatchObject({
				success: true,
			});
			expect(
				await createVacationPolicyAssignment({
					policyId: policies[0].id,
					assignmentType: "team",
					teamId: item.id,
					effectiveFrom: "2030-01-01",
				}),
			).toMatchObject({ success: true });
		}
		expect(
			await previewEmployeeVacationPolicy(target.employeeId, "2030-06-30"),
		).toMatchObject({
			success: true,
			data: {
				status: "resolved",
				source: "team",
				policy: { id: policies[0].id },
			},
		});
		expect(
			await createVacationPolicyAssignment({
				policyId: policies[1].id,
				assignmentType: "team",
				teamId: teams[1].id,
				effectiveFrom: "2030-07-01",
			}),
		).toMatchObject({ success: true });
		expect(
			await previewEmployeeVacationPolicy(target.employeeId, "2030-07-01"),
		).toMatchObject({
			success: true,
			data: {
				status: "conflict",
				policyIds: expect.arrayContaining([policies[0].id, policies[1].id]),
			},
		});
		expect(
			await setEmployeePolicyAssignment(target.employeeId, policies[2].id, {
				effectiveFrom: "2030-07-01",
			}),
		).toMatchObject({ success: true });
		expect(
			await previewEmployeeVacationPolicy(target.employeeId, "2030-07-01"),
		).toMatchObject({
			success: true,
			data: {
				status: "resolved",
				source: "employee",
				policy: { id: policies[2].id },
			},
		});
	});
	it("denies foreign organization employees and policies and keeps an unauthorized actor out of preview", async () => {
		const foreignOrg = await fixture.createOrganization();
		const foreignEmployee = await fixture.seedEmployee({
			organizationId: foreignOrg,
		});
		const [foreignPolicy] = await fixture.db
			.insert(vacationAllowance)
			.values({
				organizationId: foreignOrg,
				name: "Foreign policy",
				startDate: "2026-01-01",
				defaultAnnualDays: "99",
				statutoryMinimumDays: "20",
				accrualType: "annual",
				createdBy: fixture.ownerUserId,
			})
			.returning();
		expect(
			await previewEmployeeVacationPolicy(
				foreignEmployee.employeeId,
				"2027-01-01",
			),
		).toMatchObject({ success: false });
		expect(
			await setEmployeePolicyAssignment(
				fixture.ownerEmployeeId,
				foreignPolicy.id,
				{
					effectiveFrom: "2031-01-01",
				},
			),
		).toMatchObject({ success: false });
		expect(
			await loadEmployeeVacationPolicy(fixture.db, {
				organizationId: fixture.organizationId,
				employeeId: foreignEmployee.employeeId,
				date: "2027-01-01",
			}),
		).toEqual({ status: "missing" });
		const [foreignAssignment] = await fixture.db
			.insert(vacationPolicyAssignment)
			.values({
				organizationId: foreignOrg,
				policyId: foreignPolicy.id,
				assignmentType: "employee",
				employeeId: foreignEmployee.employeeId,
				effectiveStartDate: "2031-01-01",
				createdBy: fixture.ownerUserId,
			})
			.returning();
		expect(
			await deleteVacationPolicyAssignment(foreignAssignment.id, "2031-07-01"),
		).toMatchObject({
			success: false,
			code: "NotFoundError",
		});
		const actor = await fixture.seedEmployee();
		session.userId = actor.userId;
		try {
			expect(
				await previewEmployeeVacationPolicy(
					fixture.ownerEmployeeId,
					"2027-01-01",
				),
			).toMatchObject({ success: false });
		} finally {
			session.userId = fixture.ownerUserId;
		}
	});
	it("rejects in-place midyear method edits with a clear refusal and keeps historical terms", async () => {
		const [policy] = await fixture.db
			.insert(vacationAllowance)
			.values({
				organizationId: fixture.organizationId,
				name: "Method edit",
				startDate: "2026-01-01",
				defaultAnnualDays: "24",
				statutoryMinimumDays: "20",
				accrualType: "annual",
				createdBy: fixture.ownerUserId,
			})
			.returning();
		expect(
			await updateVacationPolicy(policy.id, {
				name: policy.name,
				defaultAnnualDays: "24",
				accrualType: "monthly",
				allowCarryover: false,
			}),
		).toMatchObject({
			success: false,
			error: expect.stringContaining("1 January"),
		});
	});
	it("allows a future 1 January method edit while retaining the previous year's method", async () => {
		const [policy] = await fixture.db
			.insert(vacationAllowance)
			.values({
				organizationId: fixture.organizationId,
				name: "Future method edit",
				startDate: "2032-01-01",
				defaultAnnualDays: "24",
				statutoryMinimumDays: "20",
				accrualType: "annual",
				createdBy: fixture.ownerUserId,
			})
			.returning();
		expect(
			await setEmployeePolicyAssignment(fixture.ownerEmployeeId, policy.id, {
				effectiveFrom: "2032-01-01",
			}),
		).toMatchObject({ success: true });
		expect(
			await updateVacationPolicy(policy.id, {
				name: policy.name,
				startDate: "2032-01-01",
				defaultAnnualDays: "24",
				accrualType: "monthly",
				allowCarryover: false,
			}),
		).toMatchObject({ success: true });
		expect(
			await previewEmployeeVacationPolicy(
				fixture.ownerEmployeeId,
				"2031-12-31",
			),
		).toMatchObject({
			success: true,
			data: { status: "resolved", policy: { accrualType: "annual" } },
		});
		expect(
			await previewEmployeeVacationPolicy(
				fixture.ownerEmployeeId,
				"2032-01-01",
			),
		).toMatchObject({
			success: true,
			data: { status: "resolved", policy: { accrualType: "monthly" } },
		});
	});
	it("schedules a future company default through editing without losing the current fallback", async () => {
		const [policy] = await fixture.db
			.insert(vacationAllowance)
			.values({
				organizationId: fixture.organizationId,
				name: "Scheduled default edit",
				startDate: "2033-01-01",
				defaultAnnualDays: "22",
				statutoryMinimumDays: "20",
				accrualType: "annual",
				createdBy: fixture.ownerUserId,
			})
			.returning();
		expect(
			await updateVacationPolicy(policy.id, {
				name: policy.name,
				startDate: "2033-01-01",
				isCompanyDefault: true,
				defaultAnnualDays: "22",
				accrualType: "annual",
				allowCarryover: false,
			}),
		).toMatchObject({ success: true });
		const target = await fixture.seedEmployee();
		expect(
			await previewEmployeeVacationPolicy(target.employeeId, "2032-12-31"),
		).toMatchObject({
			success: true,
			data: {
				status: "resolved",
				source: "company_default",
				policy: { defaultAnnualDays: "30" },
			},
		});
		expect(
			await previewEmployeeVacationPolicy(target.employeeId, "2033-01-01"),
		).toMatchObject({
			success: true,
			data: {
				status: "resolved",
				source: "company_default",
				policy: { id: policy.id },
			},
		});
	});
	it("lets a manager assign and preview a managed employee while protecting unmanaged targets and backdating", async () => {
		const manager = await fixture.seedEmployee();
		const managed = await fixture.seedEmployee();
		const unmanaged = await fixture.seedEmployee();
		await fixture.pool.query("update employee set role='manager' where id=$1", [
			manager.employeeId,
		]);
		await fixture.pool.query(
			"insert into employee_managers(employee_id,manager_id,assigned_by) values($1,$2,$3)",
			[managed.employeeId, manager.employeeId, fixture.ownerUserId],
		);
		const [policy] = await fixture.db
			.insert(vacationAllowance)
			.values({
				organizationId: fixture.organizationId,
				name: "Manager policy",
				startDate: "2034-01-01",
				defaultAnnualDays: "26",
				statutoryMinimumDays: "20",
				accrualType: "annual",
				createdBy: fixture.ownerUserId,
			})
			.returning();
		session.userId = manager.userId;
		try {
			const result = await createVacationPolicyAssignment({
				policyId: policy.id,
				assignmentType: "employee",
				employeeId: managed.employeeId,
				effectiveFrom: "2034-01-01",
			});
			expect(result).toMatchObject({ success: true });
			expect(
				await previewEmployeeVacationPolicy(managed.employeeId, "2034-01-01"),
			).toMatchObject({
				success: true,
				data: {
					status: "resolved",
					source: "employee",
					policy: { id: policy.id },
				},
			});
			expect(
				await createVacationPolicyAssignment({
					policyId: policy.id,
					assignmentType: "employee",
					employeeId: unmanaged.employeeId,
					effectiveFrom: "2034-01-01",
				}),
			).toMatchObject({ success: false, code: "AuthorizationError" });
			expect(
				await previewEmployeeVacationPolicy(unmanaged.employeeId, "2034-01-01"),
			).toMatchObject({ success: false, code: "AuthorizationError" });
			expect(
				await setEmployeePolicyAssignment(managed.employeeId, policy.id, {
					effectiveFrom: "2026-01-01",
					reviewedBackdate: true,
				}),
			).toMatchObject({ success: false, code: "AuthorizationError" });
		} finally {
			session.userId = fixture.ownerUserId;
		}
	});
	it("resolves an organization assignment before company default and restores fallback at its exclusive end", async () => {
		const target = await fixture.seedEmployee();
		const [policy] = await fixture.db
			.insert(vacationAllowance)
			.values({
				organizationId: fixture.organizationId,
				name: "Organization assignment",
				startDate: "2035-01-01",
				defaultAnnualDays: "28",
				statutoryMinimumDays: "20",
				accrualType: "annual",
				createdBy: fixture.ownerUserId,
			})
			.returning();
		const assigned = await createVacationPolicyAssignment({
			policyId: policy.id,
			assignmentType: "organization",
			effectiveFrom: "2035-01-01",
		});
		expect(assigned).toMatchObject({ success: true });
		if (!assigned.success) throw new Error(assigned.error);
		expect(
			await previewEmployeeVacationPolicy(target.employeeId, "2034-12-31"),
		).toMatchObject({
			success: true,
			data: {
				status: "resolved",
				source: "company_default",
				policy: { defaultAnnualDays: "22" },
			},
		});
		expect(
			await previewEmployeeVacationPolicy(target.employeeId, "2035-01-01"),
		).toMatchObject({
			success: true,
			data: {
				status: "resolved",
				source: "organization",
				policy: { id: policy.id },
			},
		});
		expect(
			await deleteVacationPolicyAssignment(assigned.data.id, "2035-07-01"),
		).toMatchObject({
			success: true,
		});
		expect(
			await previewEmployeeVacationPolicy(target.employeeId, "2035-06-30"),
		).toMatchObject({
			success: true,
			data: {
				status: "resolved",
				source: "organization",
				policy: { id: policy.id },
			},
		});
		expect(
			await previewEmployeeVacationPolicy(target.employeeId, "2035-07-01"),
		).toMatchObject({
			success: true,
			data: {
				status: "resolved",
				source: "company_default",
				policy: { defaultAnnualDays: "22" },
			},
		});
	});
	it("applies the same January boundary to the joiner/leaver proration switch", async () => {
		const target = await fixture.seedEmployee();
		const [policy] = await fixture.db
			.insert(vacationAllowance)
			.values({
				organizationId: fixture.organizationId,
				name: "No proration",
				startDate: "2036-01-01",
				defaultAnnualDays: "24",
				statutoryMinimumDays: "20",
				prorateInStartAndExitYear: false,
				accrualType: "annual",
				createdBy: fixture.ownerUserId,
			})
			.returning();
		expect(
			await setEmployeePolicyAssignment(target.employeeId, policy.id, {
				effectiveFrom: "2036-07-01",
			}),
		).toMatchObject({
			success: false,
			error: expect.stringContaining("1 January"),
		});
		expect(
			await setEmployeePolicyAssignment(target.employeeId, policy.id, {
				effectiveFrom: "2036-01-01",
			}),
		).toMatchObject({ success: true });
	});
});
