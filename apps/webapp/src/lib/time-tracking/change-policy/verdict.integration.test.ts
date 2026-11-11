/**
 * #1639: what the change policy in effect allows for one employee's work, read on real rows.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { parseInstant } from "@/lib/datetime/temporal-core";
import type { DatabaseClient } from "@/lib/effect/services/database.service";
import {
	createLifecycleDatabaseFixture,
	type LifecycleDatabaseFixture,
} from "@/lib/employee-lifecycle/testing/database.test.fixture";
import { ChangePolicySubjectNotFoundError, readChangePolicyVerdict } from "./verdict";

const NOW = parseInstant("2026-06-15T10:00:00Z");

describe("readChangePolicyVerdict (PostgreSQL)", () => {
	let fixture: LifecycleDatabaseFixture;
	let organizationId: string;
	let owner: { userId: string };

	beforeAll(async () => {
		fixture = await createLifecycleDatabaseFixture();
	});

	afterAll(async () => {
		await fixture?.close();
	});

	beforeEach(async () => {
		organizationId = await fixture.createOrganization();
		owner = await fixture.seedEmployee({ organizationId, role: "owner" });
	});

	const sql = (text: string, values: unknown[] = []) => fixture.pool.query(text, values);
	const reader = () => fixture.db as unknown as DatabaseClient;

	const verdict = (
		employeeId: string,
		over: Partial<Parameters<typeof readChangePolicyVerdict>[1]> = {},
	) =>
		readChangePolicyVerdict(reader(), {
			organizationId,
			employeeId,
			workEnd: parseInstant("2026-06-12T16:00:00Z"),
			now: NOW,
			...over,
		});

	async function policy(values: { selfServiceDays: number; approvalDays: number }) {
		const { rows } = await sql(
			`insert into change_policy (organization_id, name, self_service_days, approval_days, created_by, updated_at)
			 values ($1, 'Policy', $2, $3, $4, now()) returning id`,
			[organizationId, values.selfServiceDays, values.approvalDays, owner.userId],
		);
		return rows[0].id as string;
	}

	async function assign(
		policyId: string,
		to: { teamId?: string; employeeId?: string; effectiveUntil?: string } = {},
	) {
		const type = to.employeeId ? "employee" : to.teamId ? "team" : "organization";
		const { rows } = await sql(
			`insert into change_policy_assignment
			 (policy_id, organization_id, assignment_type, team_id, employee_id, priority, effective_until, created_by, updated_at)
			 values ($1, $2, $3, $4, $5, 1, $6, $7, now()) returning id`,
			[
				policyId,
				organizationId,
				type,
				to.teamId ?? null,
				to.employeeId ?? null,
				to.effectiveUntil ?? null,
				owner.userId,
			],
		);
		return rows[0].id as string;
	}

	async function teamMember() {
		const { rows } = await sql(
			`insert into team (organization_id, name, updated_at) values ($1, 'Warehouse', now()) returning id`,
			[organizationId],
		);
		const teamId = rows[0].id as string;
		const seeded = await fixture.seedEmployee({ organizationId });
		await sql("update employee set team_id = $1 where id = $2", [teamId, seeded.employeeId]);
		return { teamId, ...seeded };
	}

	it("is direct with no policy when the organization has assigned none", async () => {
		const { employeeId } = await fixture.seedEmployee({ organizationId });

		await expect(verdict(employeeId)).resolves.toEqual({
			type: "direct",
			reason: "no_policy",
			daysBack: 3,
			policy: null,
		});
	});

	it("names the policy and the assignment that decided", async () => {
		const { teamId, employeeId } = await teamMember();
		const policyId = await policy({ selfServiceDays: 0, approvalDays: 7 });
		const assignmentId = await assign(policyId, { teamId, effectiveUntil: "2026-12-31T23:00:00" });

		await expect(verdict(employeeId)).resolves.toEqual({
			type: "approval_required",
			reason: "within_approval_window",
			daysBack: 3,
			policy: {
				policyId,
				policyName: "Policy",
				assignmentId,
				level: "team",
				selfServiceDays: 0,
				approvalDays: 7,
				noApprovalRequired: false,
				notifyAllManagers: false,
			},
		});
	});

	it("stops applying a team assignment once it has ended", async () => {
		const { teamId, employeeId } = await teamMember();
		await assign(await policy({ selfServiceDays: 0, approvalDays: 7 }), {
			teamId,
			effectiveUntil: "2026-06-15T09:00:00",
		});

		await expect(verdict(employeeId)).resolves.toMatchObject({
			type: "direct",
			reason: "no_policy",
		});
	});

	it("forbids work older than both windows", async () => {
		const { employeeId } = await fixture.seedEmployee({ organizationId });
		await assign(await policy({ selfServiceDays: 1, approvalDays: 1 }));

		await expect(verdict(employeeId)).resolves.toMatchObject({
			type: "forbidden",
			reason: "beyond_approval_window",
			daysBack: 3,
		});
	});

	it("is direct for an exemption and leaves the policy unread", async () => {
		const { employeeId } = await fixture.seedEmployee({ organizationId });
		await assign(await policy({ selfServiceDays: 0, approvalDays: 0 }));

		await expect(verdict(employeeId, { exemption: "on_behalf" })).resolves.toEqual({
			type: "direct",
			reason: "on_behalf",
			daysBack: 3,
			policy: null,
		});
	});

	it("treats live work as today's", async () => {
		const { employeeId } = await fixture.seedEmployee({ organizationId });
		await assign(await policy({ selfServiceDays: 0, approvalDays: 0 }));

		await expect(verdict(employeeId, { workEnd: null })).resolves.toMatchObject({
			type: "direct",
			reason: "within_self_service",
			daysBack: 0,
		});
	});

	describe("the zone days back are counted in", () => {
		// 22:30Z on the 14th is still the 14th in UTC and already the 15th in Berlin.
		const workEnd = parseInstant("2026-06-14T22:30:00Z");

		async function employeeWithZones(zones: { user?: string; organization: string }) {
			await sql("update organization set timezone = $1 where id = $2", [
				zones.organization,
				organizationId,
			]);
			const seeded = await fixture.seedEmployee({ organizationId });
			await sql("delete from user_settings where user_id = $1", [seeded.userId]);
			if (zones.user) {
				await sql(
					"insert into user_settings (user_id, timezone, updated_at) values ($1, $2, now())",
					[seeded.userId, zones.user],
				);
			}
			return seeded.employeeId;
		}

		it("is the employee's own timezone setting", async () => {
			const employeeId = await employeeWithZones({ user: "Europe/Berlin", organization: "UTC" });

			await expect(verdict(employeeId, { workEnd })).resolves.toMatchObject({ daysBack: 0 });
		});

		it("is the organization's timezone when the employee has no setting", async () => {
			const employeeId = await employeeWithZones({ organization: "Europe/Berlin" });

			await expect(verdict(employeeId, { workEnd })).resolves.toMatchObject({ daysBack: 0 });
		});

		it("is the zone the caller recorded the work in, when it passes one", async () => {
			const employeeId = await employeeWithZones({ user: "Europe/Berlin", organization: "UTC" });

			await expect(verdict(employeeId, { workEnd, timezone: "UTC" })).resolves.toMatchObject({
				daysBack: 1,
			});
		});
	});

	describe("an employee who is not in the organization", () => {
		it("is refused for an employee of another organization, even one whose policy would allow it", async () => {
			const otherOrganizationId = await fixture.createOrganization();
			const { employeeId } = await fixture.seedEmployee({ organizationId: otherOrganizationId });

			await expect(verdict(employeeId)).rejects.toBeInstanceOf(ChangePolicySubjectNotFoundError);
		});

		it("is refused for an unknown employee", async () => {
			await expect(verdict("00000000-0000-4000-8000-000000000000")).rejects.toBeInstanceOf(
				ChangePolicySubjectNotFoundError,
			);
		});
	});
});
