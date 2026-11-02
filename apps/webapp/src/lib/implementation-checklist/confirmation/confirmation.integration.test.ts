import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DatabaseClient } from "@/lib/effect/services/database.service";
import {
	createLifecycleDatabaseFixture,
	type LifecycleDatabaseFixture,
} from "@/lib/employee-lifecycle/testing/database.test.fixture";
import type { ImplementationChecklistCoveredConfiguration } from "../definition";
import { computeConfirmationFingerprint } from "./fingerprint";
import { loadManualConfirmations } from "./load";
import { confirmImplementationChecklistItem, unconfirmImplementationChecklistItem } from "./store";

describe("manual confirmation fingerprints (PostgreSQL)", () => {
	let fixture: LifecycleDatabaseFixture;
	let db: DatabaseClient;

	beforeAll(async () => {
		fixture = await createLifecycleDatabaseFixture();
		db = fixture.db as unknown as DatabaseClient;
		await fixture.pool.query(
			`insert into payroll_export_format (id, name, version, updated_at)
			 values ('datev_lohn', 'DATEV', '2024.1', now()), ('lexware_lohn', 'Lexware', '2024.1', now())
			 on conflict do nothing`,
		);
	});

	afterAll(async () => {
		await fixture.close();
	});

	const sql = (text: string, values: unknown[] = []) => fixture.pool.query(text, values);

	async function organization() {
		const organizationId = await fixture.createOrganization();
		const owner = await fixture.seedEmployee({ organizationId, role: "owner" });
		const employee = await fixture.seedEmployee({ organizationId });
		return { organizationId, owner, employee };
	}

	function fingerprint(
		organizationId: string,
		covers: ImplementationChecklistCoveredConfiguration,
	) {
		return computeConfirmationFingerprint(db, organizationId, covers);
	}

	/** Asserts whether `change` moves the fingerprint of `covers`. */
	async function expectChange(
		organizationId: string,
		covers: ImplementationChecklistCoveredConfiguration,
		change: () => Promise<unknown>,
		changes: boolean,
	) {
		const before = await fingerprint(organizationId, covers);
		await change();
		const after = await fingerprint(organizationId, covers);
		if (changes) expect(after).not.toBe(before);
		else expect(after).toBe(before);
	}

	async function team(organizationId: string, name: string) {
		const { rows } = await sql(
			`insert into team (organization_id, name, updated_at) values ($1, $2, now()) returning id`,
			[organizationId, name],
		);
		return rows[0].id as string;
	}

	async function changePolicy(organizationId: string, userId: string, name = "Default") {
		const { rows } = await sql(
			`insert into change_policy (organization_id, name, created_by, updated_at)
			 values ($1, $2, $3, now()) returning id`,
			[organizationId, name, userId],
		);
		return rows[0].id as string;
	}

	async function routingPolicy(organizationId: string, userId: string) {
		const { rows } = await sql(
			`insert into approval_policy (organization_id, name, is_active, priority, created_by, updated_at)
			 values ($1, 'Routing', true, 1, $2, now()) returning id`,
			[organizationId, userId],
		);
		return rows[0].id as string;
	}

	async function stage(organizationId: string, policyId: string, stepOrder: number) {
		const { rows } = await sql(
			`insert into approval_policy_stage
			 (organization_id, policy_id, step_order, label, approver_type, updated_at)
			 values ($1, $2, $3, 'Manager', 'direct_manager', now()) returning id`,
			[organizationId, policyId, stepOrder],
		);
		return rows[0].id as string;
	}

	async function absenceCategory(organizationId: string, name = "Vacation") {
		const { rows } = await sql(
			`insert into absence_category (organization_id, type, name, requires_approval, updated_at)
			 values ($1, 'vacation', $2, true, now()) returning id`,
			[organizationId, name],
		);
		return rows[0].id as string;
	}

	async function wageMapping(organizationId: string, userId: string, special = "overtime") {
		const { rows } = await sql(
			`insert into payroll_wage_type_mapping
			 (organization_id, special_category, datev_wage_type_code, created_by, updated_at)
			 values ($1, $2, '1000', $3, now()) returning id`,
			[organizationId, special, userId],
		);
		return rows[0].id as string;
	}

	describe("fingerprint", () => {
		it("is the same for the same configuration, including a save that changes nothing", async () => {
			const { organizationId, owner, employee } = await organization();
			const teamId = await team(organizationId, "Kitchen");
			await sql(
				`insert into team_membership (organization_id, team_id, employee_id) values ($1, $2, $3)`,
				[organizationId, teamId, employee.employeeId],
			);
			await changePolicy(organizationId, owner.userId);
			await wageMapping(organizationId, owner.userId);

			for (const covers of [
				"organization-structure",
				"approval-rules",
				"payroll-export",
			] as const) {
				const first = await fingerprint(organizationId, covers);
				expect(first).toMatch(/^[0-9a-f]{64}$/);
				expect(await fingerprint(organizationId, covers)).toBe(first);
			}

			await expectChange(
				organizationId,
				"organization-structure",
				() => sql(`update team set updated_at = now() + interval '1 hour' where id = $1`, [teamId]),
				false,
			);
		});

		it("differs between configurations of different organizations", async () => {
			const first = await organization();
			const second = await organization();
			await team(first.organizationId, "Kitchen");
			expect(await fingerprint(first.organizationId, "organization-structure")).not.toBe(
				await fingerprint(second.organizationId, "organization-structure"),
			);
		});

		describe("organization structure", () => {
			it("changes when a team is added, renamed or deleted", async () => {
				const { organizationId } = await organization();
				let teamId = "";
				await expectChange(
					organizationId,
					"organization-structure",
					async () => {
						teamId = await team(organizationId, "Kitchen");
					},
					true,
				);
				await expectChange(
					organizationId,
					"organization-structure",
					() => sql(`update team set name = 'Bar' where id = $1`, [teamId]),
					true,
				);
				await expectChange(
					organizationId,
					"organization-structure",
					() => sql(`delete from team where id = $1`, [teamId]),
					true,
				);
			});

			it("changes when a team membership or primary team is added or removed", async () => {
				const { organizationId, employee } = await organization();
				const teamId = await team(organizationId, "Kitchen");
				await expectChange(
					organizationId,
					"organization-structure",
					() =>
						sql(
							`insert into team_membership (organization_id, team_id, employee_id) values ($1, $2, $3)`,
							[organizationId, teamId, employee.employeeId],
						),
					true,
				);
				await expectChange(
					organizationId,
					"organization-structure",
					() =>
						sql(`update employee set team_id = $1 where id = $2`, [teamId, employee.employeeId]),
					true,
				);
				await expectChange(
					organizationId,
					"organization-structure",
					() => sql(`delete from team_membership where team_id = $1`, [teamId]),
					true,
				);
			});

			it("changes when a manager link is added, changed or deleted", async () => {
				const { organizationId, owner, employee } = await organization();
				await expectChange(
					organizationId,
					"organization-structure",
					() =>
						sql(
							`insert into employee_managers (employee_id, manager_id, is_primary, assigned_by)
							 values ($1, $2, false, $3)`,
							[employee.employeeId, owner.employeeId, owner.userId],
						),
					true,
				);
				await expectChange(
					organizationId,
					"organization-structure",
					() =>
						sql(`update employee_managers set is_primary = true where employee_id = $1`, [
							employee.employeeId,
						]),
					true,
				);
				await expectChange(
					organizationId,
					"organization-structure",
					() => sql(`delete from employee_managers where employee_id = $1`, [employee.employeeId]),
					true,
				);
			});

			it("changes when a member's role changes or a member joins", async () => {
				const { organizationId, employee } = await organization();
				await expectChange(
					organizationId,
					"organization-structure",
					() => sql(`update member set role = 'admin' where id = $1`, [employee.memberId]),
					true,
				);
				await expectChange(
					organizationId,
					"organization-structure",
					() => sql(`update employee set role = 'manager' where id = $1`, [employee.employeeId]),
					true,
				);
				await expectChange(
					organizationId,
					"organization-structure",
					() => fixture.seedEmployee({ organizationId }),
					true,
				);
			});

			it("ignores unrelated configuration and other organizations", async () => {
				const { organizationId, owner } = await organization();
				const other = await organization();
				await expectChange(
					organizationId,
					"organization-structure",
					async () => {
						await sql(
							`insert into holiday_preset (organization_id, name, created_by, updated_at)
							 values ($1, 'Germany', $2, now())`,
							[organizationId, owner.userId],
						);
						await changePolicy(organizationId, owner.userId);
						await team(other.organizationId, "Elsewhere");
						await sql(
							`insert into employee_managers (employee_id, manager_id, is_primary, assigned_by)
							 values ($1, $2, true, $3)`,
							[other.employee.employeeId, other.owner.employeeId, other.owner.userId],
						);
					},
					false,
				);
			});
		});

		describe("approval rules", () => {
			it("changes when a change policy or its assignment changes", async () => {
				const { organizationId, owner } = await organization();
				const policyId = await changePolicy(organizationId, owner.userId);
				await expectChange(
					organizationId,
					"approval-rules",
					() => sql(`update change_policy set approval_days = 3 where id = $1`, [policyId]),
					true,
				);
				await expectChange(
					organizationId,
					"approval-rules",
					() =>
						sql(
							`insert into change_policy_assignment
							 (policy_id, organization_id, assignment_type, priority, created_by, updated_at)
							 values ($1, $2, 'organization', 0, $3, now())`,
							[policyId, organizationId, owner.userId],
						),
					true,
				);
				await expectChange(
					organizationId,
					"approval-rules",
					() =>
						sql(`update change_policy_assignment set is_active = false where policy_id = $1`, [
							policyId,
						]),
					true,
				);
			});

			it("changes when a routing stage or condition is added, changed or deleted", async () => {
				const { organizationId, owner } = await organization();
				const policyId = await routingPolicy(organizationId, owner.userId);
				let stageId = "";
				await expectChange(
					organizationId,
					"approval-rules",
					async () => {
						stageId = await stage(organizationId, policyId, 1);
					},
					true,
				);
				await expectChange(
					organizationId,
					"approval-rules",
					() =>
						sql(`update approval_policy_stage set fallback_behavior = 'org_admin' where id = $1`, [
							stageId,
						]),
					true,
				);
				await expectChange(
					organizationId,
					"approval-rules",
					() =>
						sql(
							`insert into approval_policy_condition
							 (organization_id, policy_id, condition_type, operator, value_json, updated_at)
							 values ($1, $2, 'approval_type', 'equals', '"absence_entry"'::jsonb, now())`,
							[organizationId, policyId],
						),
					true,
				);
				await expectChange(
					organizationId,
					"approval-rules",
					() => sql(`delete from approval_policy_condition where policy_id = $1`, [policyId]),
					true,
				);
				await expectChange(
					organizationId,
					"approval-rules",
					() => sql(`delete from approval_policy_stage where id = $1`, [stageId]),
					true,
				);
			});

			it("stays the same when a routing policy is saved again with the same stages", async () => {
				const { organizationId, owner } = await organization();
				const policyId = await routingPolicy(organizationId, owner.userId);
				await stage(organizationId, policyId, 1);
				await expectChange(
					organizationId,
					"approval-rules",
					async () => {
						// The settings page replaces every stage on save.
						await sql(`delete from approval_policy_stage where policy_id = $1`, [policyId]);
						await stage(organizationId, policyId, 1);
					},
					false,
				);
			});

			it("changes when an absence category's approval requirement changes, not its name", async () => {
				const { organizationId } = await organization();
				const categoryId = await absenceCategory(organizationId);
				await expectChange(
					organizationId,
					"approval-rules",
					() => sql(`update absence_category set name = 'Holiday' where id = $1`, [categoryId]),
					false,
				);
				await expectChange(
					organizationId,
					"approval-rules",
					() =>
						sql(`update absence_category set requires_approval = false where id = $1`, [
							categoryId,
						]),
					true,
				);
				await expectChange(
					organizationId,
					"approval-rules",
					() => sql(`delete from absence_category where id = $1`, [categoryId]),
					true,
				);
			});

			it("ignores another organization's approval rules", async () => {
				const { organizationId } = await organization();
				const other = await organization();
				await expectChange(
					organizationId,
					"approval-rules",
					async () => {
						const policyId = await routingPolicy(other.organizationId, other.owner.userId);
						await stage(other.organizationId, policyId, 1);
						await changePolicy(other.organizationId, other.owner.userId);
						await absenceCategory(other.organizationId);
					},
					false,
				);
			});
		});

		describe("payroll export", () => {
			it("changes when an export config is added or changed", async () => {
				const { organizationId, owner } = await organization();
				let configId = "";
				await expectChange(
					organizationId,
					"payroll-export",
					async () => {
						const { rows } = await sql(
							`insert into payroll_export_config (organization_id, format_id, config, created_by, updated_at)
						 values ($1, 'datev_lohn', '{"beraternummer":"1","mandantennummer":"2"}'::jsonb, $2, now())
						 returning id`,
							[organizationId, owner.userId],
						);
						configId = rows[0].id;
					},
					true,
				);
				await expectChange(
					organizationId,
					"payroll-export",
					() =>
						sql(
							`update payroll_export_config set config = '{"mandantennummer":"2","beraternummer":"9"}'::jsonb where id = $1`,
							[configId],
						),
					true,
				);
			});

			it("changes when a wage-type mapping is added, changed or deleted", async () => {
				const { organizationId, owner } = await organization();
				let mappingId = "";
				await expectChange(
					organizationId,
					"payroll-export",
					async () => {
						mappingId = await wageMapping(organizationId, owner.userId);
					},
					true,
				);
				await expectChange(
					organizationId,
					"payroll-export",
					() =>
						sql(
							`update payroll_wage_type_mapping set datev_wage_type_code = '1100' where id = $1`,
							[mappingId],
						),
					true,
				);
				await expectChange(
					organizationId,
					"payroll-export",
					() => sql(`delete from payroll_wage_type_mapping where id = $1`, [mappingId]),
					true,
				);
				await expectChange(
					organizationId,
					"payroll-export",
					() =>
						sql(
							`insert into payroll_expense_wage_type_mapping (organization_id, payroll_line_kind, datev_wage_type_code)
							 values ($1, 'per_diem_statutory', '2000')`,
							[organizationId],
						),
					true,
				);
			});

			it("ignores another organization's payroll export settings", async () => {
				const { organizationId } = await organization();
				const other = await organization();
				await expectChange(
					organizationId,
					"payroll-export",
					() => wageMapping(other.organizationId, other.owner.userId),
					false,
				);
			});
		});
	});

	describe("confirming and unconfirming", () => {
		async function manualRow(organizationId: string, itemId: string) {
			const { rows } = await sql(
				`select id, completed_by_user_id, configuration_fingerprint
				 from implementation_checklist_manual_state where organization_id = $1 and item_id = $2`,
				[organizationId, itemId],
			);
			return rows[0] as
				| { id: string; completed_by_user_id: string; configuration_fingerprint: string | null }
				| undefined;
		}

		async function auditEntries(organizationId: string) {
			const { rows } = await sql(
				`select action, entity_type, entity_id, performed_by, metadata
				 from audit_log where organization_id = $1 order by timestamp, action`,
				[organizationId],
			);
			return rows as {
				action: string;
				entity_type: string;
				entity_id: string;
				performed_by: string;
				metadata: string | null;
			}[];
		}

		it("stores the covered configuration's fingerprint and writes an audit entry", async () => {
			const { organizationId, owner } = await organization();
			await team(organizationId, "Kitchen");

			await confirmImplementationChecklistItem(db, {
				organizationId,
				itemId: "organization-structure",
				actorUserId: owner.userId,
				confirmedAt: new Date("2026-10-30T09:00:00Z"),
			});

			const row = await manualRow(organizationId, "organization-structure");
			expect(row).toMatchObject({
				completed_by_user_id: owner.userId,
				configuration_fingerprint: await fingerprint(organizationId, "organization-structure"),
			});
			const entries = await auditEntries(organizationId);
			expect(entries).toHaveLength(1);
			expect(entries[0]).toMatchObject({
				action: "implementation_checklist.item_confirmed",
				entity_type: "implementation_checklist_item",
				entity_id: row?.id,
				performed_by: owner.userId,
			});
			expect(JSON.parse(entries[0]?.metadata ?? "{}")).toMatchObject({
				itemId: "organization-structure",
				covers: "organization-structure",
				reconfirmed: false,
			});
		});

		it("goes stale after a covered change, stops counting, and counts again once confirmed again", async () => {
			const { organizationId, owner } = await organization();
			const mappingId = await wageMapping(organizationId, owner.userId);
			const confirm = () =>
				confirmImplementationChecklistItem(db, {
					organizationId,
					itemId: "payroll-readiness",
					actorUserId: owner.userId,
					confirmedAt: new Date("2026-10-30T09:00:00Z"),
				});
			await confirm();

			let loaded = await loadManualConfirmations(db, organizationId);
			expect(loaded.manualCompleteIds.has("payroll-readiness")).toBe(true);
			expect(loaded.manualConfirmations.get("payroll-readiness")).toEqual({
				confirmedAt: "2026-10-30T09:00:00.000Z",
				freshness: "current",
			});

			await sql(`delete from payroll_wage_type_mapping where id = $1`, [mappingId]);
			loaded = await loadManualConfirmations(db, organizationId);
			expect(loaded.manualConfirmations.get("payroll-readiness")?.freshness).toBe("stale");

			await confirm();
			loaded = await loadManualConfirmations(db, organizationId);
			expect(loaded.manualConfirmations.get("payroll-readiness")?.freshness).toBe("current");
			const entries = await auditEntries(organizationId);
			expect(entries.map((entry) => entry.action)).toEqual([
				"implementation_checklist.item_confirmed",
				"implementation_checklist.item_confirmed",
			]);
			expect(JSON.parse(entries[1]?.metadata ?? "{}")).toMatchObject({ reconfirmed: true });
		});

		it("never goes stale from another organization's changes", async () => {
			const { organizationId, owner } = await organization();
			const other = await organization();
			await confirmImplementationChecklistItem(db, {
				organizationId,
				itemId: "approval-rules",
				actorUserId: owner.userId,
				confirmedAt: new Date("2026-10-30T09:00:00Z"),
			});
			await changePolicy(other.organizationId, other.owner.userId);
			await absenceCategory(other.organizationId);

			const loaded = await loadManualConfirmations(db, organizationId);
			expect(loaded.manualConfirmations.get("approval-rules")?.freshness).toBe("current");
		});

		it("labels a confirmation without a fingerprint as before change tracking", async () => {
			const { organizationId, owner } = await organization();
			await sql(
				`insert into implementation_checklist_manual_state
				 (organization_id, item_id, status, completed_at, completed_by_user_id, updated_at)
				 values ($1, 'organization-structure', 'complete', '2026-01-05 08:00:00', $2, now())`,
				[organizationId, owner.userId],
			);
			await team(organizationId, "Kitchen");

			const loaded = await loadManualConfirmations(db, organizationId);
			expect(loaded.manualCompleteIds.has("organization-structure")).toBe(true);
			expect(loaded.manualConfirmations.get("organization-structure")).toEqual({
				confirmedAt: "2026-01-05T08:00:00.000Z",
				freshness: "before-change-tracking",
			});
		});

		it("removes the confirmation with an audit entry, and writes nothing when there is none", async () => {
			const { organizationId, owner } = await organization();
			expect(
				await unconfirmImplementationChecklistItem(db, {
					organizationId,
					itemId: "approval-rules",
					actorUserId: owner.userId,
				}),
			).toEqual({ removed: false });
			expect(await auditEntries(organizationId)).toEqual([]);

			await confirmImplementationChecklistItem(db, {
				organizationId,
				itemId: "approval-rules",
				actorUserId: owner.userId,
				confirmedAt: new Date("2026-10-30T09:00:00Z"),
			});
			const row = await manualRow(organizationId, "approval-rules");
			expect(
				await unconfirmImplementationChecklistItem(db, {
					organizationId,
					itemId: "approval-rules",
					actorUserId: owner.userId,
				}),
			).toEqual({ removed: true });

			expect(await manualRow(organizationId, "approval-rules")).toBeUndefined();
			const entries = await auditEntries(organizationId);
			expect(entries.map((entry) => entry.action)).toEqual([
				"implementation_checklist.item_confirmed",
				"implementation_checklist.item_unconfirmed",
			]);
			expect(entries[1]).toMatchObject({ entity_id: row?.id, performed_by: owner.userId });
		});

		it("only removes the caller organization's confirmation", async () => {
			const first = await organization();
			const second = await organization();
			for (const { organizationId, owner } of [first, second]) {
				await confirmImplementationChecklistItem(db, {
					organizationId,
					itemId: "approval-rules",
					actorUserId: owner.userId,
					confirmedAt: new Date("2026-10-30T09:00:00Z"),
				});
			}
			await unconfirmImplementationChecklistItem(db, {
				organizationId: first.organizationId,
				itemId: "approval-rules",
				actorUserId: first.owner.userId,
			});
			expect(await manualRow(first.organizationId, "approval-rules")).toBeUndefined();
			expect(await manualRow(second.organizationId, "approval-rules")).toBeDefined();
		});
	});
});
