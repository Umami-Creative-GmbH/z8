/**
 * #1440 (spec #1437, Organization ADR 0006): a deactivation ends the person's
 * manager links in both directions. Reports left with no current manager need
 * a replacement who is a current admin or manager; the others just lose this
 * manager. Each change is audited under the acting admin.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AuditTrail } from "@/lib/audit-trail";
import { type Instant, parseInstant } from "@/lib/datetime/temporal-core";
import {
	createLifecycleDatabaseFixture,
	type LifecycleDatabaseFixture,
	type SeededEmployee,
} from "../testing/database.test.fixture";
import {
	applyManagerLinks,
	ManagerLinksRefusedError,
	managerLinkAuthorizationEmployeeIds,
	planManagerLinks,
} from "./manager-links";
import type { DeactivationApplyContext, DeactivationPlanContext } from "./types";

const at: Instant = parseInstant("2026-10-24T09:00:00Z");

describe("deactivation ends manager links (#1440)", () => {
	let fixture: LifecycleDatabaseFixture;

	beforeAll(async () => {
		fixture = await createLifecycleDatabaseFixture();
	});

	afterAll(async () => {
		await fixture?.close();
	});

	async function person(
		organizationId: string,
		name: string,
		input: { role?: "admin" | "manager" | "employee"; isActive?: boolean } = {},
	): Promise<SeededEmployee> {
		const seeded = await fixture.seedEmployee({
			organizationId,
			role: input.role === "admin" ? "admin" : "member",
			isActive: input.isActive,
		});
		await fixture.pool.query(`update "user" set name = $2 where id = $1`, [seeded.userId, name]);
		if (input.role === "manager") {
			await fixture.pool.query(`update employee set role = 'manager' where id = $1`, [
				seeded.employeeId,
			]);
		}
		return seeded;
	}

	async function link(report: SeededEmployee, manager: SeededEmployee, isPrimary: boolean) {
		await fixture.pool.query(
			`insert into employee_managers (employee_id, manager_id, is_primary, assigned_by)
			 values ($1, $2, $3, $4)`,
			[report.employeeId, manager.employeeId, isPrimary, fixture.ownerUserId],
		);
	}

	async function links(organizationId: string) {
		const result = await fixture.pool.query<{
			employee_id: string;
			manager_id: string;
			is_primary: boolean;
		}>(
			`select l.employee_id, l.manager_id, l.is_primary from employee_managers l
			 join employee e on e.id = l.employee_id
			 where e.organization_id = $1 order by l.employee_id, l.manager_id`,
			[organizationId],
		);
		return result.rows;
	}

	async function auditRows(organizationId: string) {
		const result = await fixture.pool.query<{
			action: string;
			entity_type: string;
			employee_id: string | null;
			performed_by: string;
			metadata: string;
		}>(
			`select action, entity_type, employee_id, performed_by, metadata from audit_log
			 where organization_id = $1 order by action, metadata`,
			[organizationId],
		);
		return result.rows.map((row) => ({ ...row, metadata: JSON.parse(row.metadata) }));
	}

	/** The person who leaves manages two reports: one with another manager, one without. */
	async function organizationWithTeam() {
		const organizationId = await fixture.createOrganization();
		const leaver = await person(organizationId, "Lea Leaver", { role: "manager" });
		const theirManager = await person(organizationId, "Max Boss", { role: "manager" });
		const coManager = await person(organizationId, "Cora Comanager", { role: "manager" });
		const shared = await person(organizationId, "Sam Shared");
		const alone = await person(organizationId, "Ada Alone");
		const replacement = await person(organizationId, "Rita Replacement", { role: "manager" });
		const admin = await person(organizationId, "Alex Admin", { role: "admin" });
		const plain = await person(organizationId, "Pia Plain");
		const former = await person(organizationId, "Fred Former", {
			role: "manager",
			isActive: false,
		});
		await link(leaver, theirManager, true);
		await link(shared, leaver, true);
		await link(shared, coManager, false);
		await link(alone, leaver, true);
		return {
			organizationId,
			leaver,
			theirManager,
			coManager,
			shared,
			alone,
			replacement,
			admin,
			plain,
			former,
		};
	}

	function planContext(
		organizationId: string,
		leaver: SeededEmployee,
		replacementManagers: Record<string, string> = {},
		replaceManagers = true,
	): DeactivationPlanContext {
		return {
			organizationId,
			employeeId: leaver.employeeId,
			at,
			organizationTimeZone: "Europe/Berlin",
			employmentPeriodId: leaver.employmentPeriodId,
			replacementManagers,
			replaceManagers,
		};
	}

	function applyContext(plan: DeactivationPlanContext): DeactivationApplyContext {
		return {
			...plan,
			actorUserId: fixture.ownerUserId,
			deactivationId: randomUUID(),
			reason: "employee_deactivated",
			audit: new AuditTrail(),
		};
	}

	it("plans which reports need a replacement, who keeps another manager and which links end", async () => {
		const team = await organizationWithTeam();

		const plan = await planManagerLinks(
			fixture.db,
			planContext(team.organizationId, team.leaver, {
				[team.alone.employeeId]: team.replacement.employeeId,
			}),
		);

		expect(plan).toEqual({
			reportsNeedingReplacement: [
				{
					employeeId: team.alone.employeeId,
					name: "Ada Alone",
					wasPrimary: true,
					replacementEmployeeId: team.replacement.employeeId,
					refusal: null,
				},
			],
			reportsKeepingAnotherManager: [
				{
					employeeId: team.shared.employeeId,
					name: "Sam Shared",
					newPrimaryManagerId: team.coManager.employeeId,
				},
			],
			ownManagerLinks: [
				{ employeeId: team.theirManager.employeeId, name: "Max Boss", isPrimary: true },
			],
			// Current admins and managers only, never the person who leaves.
			replacementOptions: [
				{ employeeId: team.admin.employeeId, name: "Alex Admin" },
				{ employeeId: team.coManager.employeeId, name: "Cora Comanager" },
				{ employeeId: team.theirManager.employeeId, name: "Max Boss" },
				{ employeeId: team.replacement.employeeId, name: "Rita Replacement" },
			],
		});
	});

	it("refuses a missing replacement and an ineligible or former one", async () => {
		const team = await organizationWithTeam();
		const otherOrganization = await fixture.createOrganization();
		const outsider = await person(otherOrganization, "Olga Outsider", { role: "manager" });

		const refusalFor = async (replacement: string | undefined) => {
			const plan = await planManagerLinks(
				fixture.db,
				planContext(
					team.organizationId,
					team.leaver,
					replacement ? { [team.alone.employeeId]: replacement } : {},
				),
			);
			return plan.reportsNeedingReplacement.map((report) => report.refusal);
		};

		expect(await refusalFor(undefined)).toEqual(["replacement_missing"]);
		expect(await refusalFor(team.former.employeeId)).toEqual(["replacement_ineligible"]);
		expect(await refusalFor(team.plain.employeeId)).toEqual(["replacement_ineligible"]);
		expect(await refusalFor(team.alone.employeeId)).toEqual(["replacement_ineligible"]);
		expect(await refusalFor(team.leaver.employeeId)).toEqual(["replacement_ineligible"]);
		expect(await refusalFor(outsider.employeeId)).toEqual(["replacement_ineligible"]);
	});

	it("counts a report whose only other manager is a former employee as needing a replacement", async () => {
		const team = await organizationWithTeam();
		await link(team.alone, team.former, false);

		const plan = await planManagerLinks(fixture.db, planContext(team.organizationId, team.leaver));

		expect(plan.reportsNeedingReplacement.map((report) => report.employeeId)).toEqual([
			team.alone.employeeId,
		]);
	});

	it("ends the links, adds the replacement as primary, promotes the remaining manager and audits each change", async () => {
		const team = await organizationWithTeam();
		const context = planContext(team.organizationId, team.leaver, {
			[team.alone.employeeId]: team.replacement.employeeId,
		});
		const plan = await planManagerLinks(fixture.db, context);
		const apply = applyContext(context);

		const result = await fixture.db.transaction((tx) => applyManagerLinks(tx, apply, plan));

		expect(result.afterCommit).toEqual([]);
		expect(result.applied).toEqual({
			removedLinks: expect.arrayContaining([
				{ employeeId: team.shared.employeeId, managerId: team.leaver.employeeId },
				{ employeeId: team.alone.employeeId, managerId: team.leaver.employeeId },
				{ employeeId: team.leaver.employeeId, managerId: team.theirManager.employeeId },
			]),
			addedLinks: [
				{
					employeeId: team.alone.employeeId,
					managerId: team.replacement.employeeId,
					isPrimary: true,
				},
			],
			promotedLinks: [{ employeeId: team.shared.employeeId, managerId: team.coManager.employeeId }],
		});
		expect(result.applied.removedLinks).toHaveLength(3);
		expect(await links(team.organizationId)).toEqual(
			[
				{
					employee_id: team.alone.employeeId,
					manager_id: team.replacement.employeeId,
					is_primary: true,
				},
				{
					employee_id: team.shared.employeeId,
					manager_id: team.coManager.employeeId,
					is_primary: true,
				},
			].toSorted((a, b) => a.employee_id.localeCompare(b.employee_id)),
		);

		const metadata = { reason: "employee_deactivated", deactivationId: apply.deactivationId };
		const audits = await auditRows(team.organizationId);
		expect(audits).toHaveLength(5);
		for (const audit of audits) {
			expect(audit.performed_by).toBe(fixture.ownerUserId);
			expect(audit.entity_type).toBe("employee_manager");
			expect(audit.metadata).toMatchObject(metadata);
		}
		expect(
			audits.map((audit) => [audit.action, audit.employee_id, audit.metadata.managerId]),
		).toEqual(
			expect.arrayContaining([
				["manager.assigned", team.alone.employeeId, team.replacement.employeeId],
				["manager.primary_changed", team.shared.employeeId, team.coManager.employeeId],
				["manager.removed", team.shared.employeeId, team.leaver.employeeId],
				["manager.removed", team.alone.employeeId, team.leaver.employeeId],
				["manager.removed", team.leaver.employeeId, team.theirManager.employeeId],
			]),
		);

		// Applied again, the plan finds nothing left to change.
		const again = await planManagerLinks(fixture.db, context);
		expect(again.reportsNeedingReplacement).toEqual([]);
		expect(again.reportsKeepingAnotherManager).toEqual([]);
		expect(again.ownManagerLinks).toEqual([]);
	});

	it("refuses to apply a plan with a refusal", async () => {
		const team = await organizationWithTeam();
		const context = planContext(team.organizationId, team.leaver);
		const plan = await planManagerLinks(fixture.db, context);

		await expect(
			fixture.db.transaction((tx) => applyManagerLinks(tx, applyContext(context), plan)),
		).rejects.toBeInstanceOf(ManagerLinksRefusedError);
		expect(await links(team.organizationId)).toHaveLength(4);
	});

	it("keeps the link of a report with no current manager when replacements are not asked for (backfill)", async () => {
		const team = await organizationWithTeam();
		const context = planContext(team.organizationId, team.leaver, {}, false);
		const plan = await planManagerLinks(fixture.db, context);

		expect(plan.reportsNeedingReplacement).toEqual([
			expect.objectContaining({
				employeeId: team.alone.employeeId,
				replacementEmployeeId: null,
				refusal: null,
			}),
		]);

		const result = await fixture.db.transaction((tx) =>
			applyManagerLinks(tx, applyContext(context), plan),
		);

		expect(result.applied.removedLinks).toEqual(
			expect.not.arrayContaining([
				{ employeeId: team.alone.employeeId, managerId: team.leaver.employeeId },
			]),
		);
		expect(await links(team.organizationId)).toContainEqual({
			employee_id: team.alone.employeeId,
			manager_id: team.leaver.employeeId,
			is_primary: true,
		});
	});

	it("names everyone whose authorization facts change, for the mutation scope", async () => {
		const team = await organizationWithTeam();

		const ids = await managerLinkAuthorizationEmployeeIds(fixture.db, {
			organizationId: team.organizationId,
			employeeId: team.leaver.employeeId,
		});

		expect(ids).toEqual(
			[team.shared.employeeId, team.alone.employeeId, team.theirManager.employeeId].toSorted(),
		);
	});
});
