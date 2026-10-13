/**
 * PostgreSQL contract for the one-time wage history merge note (#1176): read per organization
 * and employee, hidden for good once an org admin dismisses it.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
	createLifecycleDatabaseFixture,
	type LifecycleDatabaseFixture,
} from "@/lib/employee-lifecycle/testing/database.test.fixture";
import { dismissWageHistoryMergeNote, loadWageHistoryMergeNote } from "./wage-history-merge-note";

describe("wage history merge note", () => {
	let fixture: LifecycleDatabaseFixture;

	beforeAll(async () => {
		fixture = await createLifecycleDatabaseFixture();
		await fixture.pool.query(
			`insert into employee_wage_history_merge_note
			 (organization_id, employee_id, merged_on, adjusted_count)
			 values ($1, $2, '2026-10-14', 3)`,
			[fixture.organizationId, fixture.employeeId],
		);
	});

	afterAll(async () => {
		await fixture?.close();
	});

	it("reads the note of an affected employee in the organization", async () => {
		await expect(
			loadWageHistoryMergeNote(fixture.db, {
				organizationId: fixture.organizationId,
				employeeId: fixture.employeeId,
			}),
		).resolves.toEqual({ mergedOn: "2026-10-14", adjustedCount: 3 });
		await expect(
			loadWageHistoryMergeNote(fixture.db, {
				organizationId: fixture.organizationId,
				employeeId: fixture.ownerEmployeeId,
			}),
		).resolves.toBeNull();
	});

	it("never reads or dismisses the note through another organization", async () => {
		const otherOrganizationId = await fixture.createOrganization();
		const input = { organizationId: otherOrganizationId, employeeId: fixture.employeeId };

		await expect(loadWageHistoryMergeNote(fixture.db, input)).resolves.toBeNull();
		await dismissWageHistoryMergeNote(fixture.db, { ...input, actorUserId: fixture.ownerUserId });
		await expect(
			loadWageHistoryMergeNote(fixture.db, {
				organizationId: fixture.organizationId,
				employeeId: fixture.employeeId,
			}),
		).resolves.not.toBeNull();
	});

	it("hides the note for good once dismissed, keeping the first dismisser", async () => {
		const input = { organizationId: fixture.organizationId, employeeId: fixture.employeeId };
		const second = await fixture.seedEmployee({ role: "admin" });

		await dismissWageHistoryMergeNote(fixture.db, { ...input, actorUserId: fixture.ownerUserId });
		await dismissWageHistoryMergeNote(fixture.db, { ...input, actorUserId: second.userId });

		await expect(loadWageHistoryMergeNote(fixture.db, input)).resolves.toBeNull();
		const { rows } = await fixture.pool.query<{ dismissedBy: string }>(
			`select dismissed_by as "dismissedBy" from employee_wage_history_merge_note
			 where organization_id = $1 and employee_id = $2`,
			[input.organizationId, input.employeeId],
		);
		expect(rows).toEqual([{ dismissedBy: fixture.ownerUserId }]);
	});
});
