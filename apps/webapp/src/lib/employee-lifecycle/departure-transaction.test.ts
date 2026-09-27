import { describe, expect, it } from "vitest";
import type { WorkTransactionDatabase } from "@/lib/time-tracking/work-transaction";
import {
	adoptionGate,
	employeeCoordinationGuard,
	holdGuard,
	organizationConfigurationGuard,
	userConfigurationAccessGuard,
} from "@/lib/time-tracking/work-transaction/ranks";
import { fakeWorkTransaction } from "@/lib/time-tracking/work-transaction/testing";
import { departureWorkPlan } from "./departure-transaction";

const target = { organizationId: "org-492", employeeId: "employee-492" };
const userId = "user-492";

// The fake opens the transaction itself, so the plan's opener is never called.
const database: WorkTransactionDatabase = {
	transaction: () => Promise.reject(new Error("the fake opens the transaction")),
};

/** A transaction client that routes the departing employee's user and locks rows. */
function stubClient(options: { organizationFound?: boolean } = {}) {
	const lockedRows: string[] = [];
	const client = {
		select: () => ({
			from: () => ({ where: async () => [{ userId }] }),
		}),
		execute: async () => {
			lockedRows.push("organization");
			return { rows: options.organizationFound === false ? [] : [{ id: target.organizationId }] };
		},
	};
	return { client, lockedRows };
}

describe("departure work plan", () => {
	it("takes the adoption gate first, then the user's exclusive guard and the employee key", async () => {
		const { client } = stubClient();
		const fake = fakeWorkTransaction({ client });

		await fake.run(departureWorkPlan(database, target), async () => undefined);

		expect(fake.guards.map(({ rank, key, mode }) => ({ rank, key, mode }))).toEqual([
			adoptionGate(target.organizationId, "shared"),
			userConfigurationAccessGuard(userId, "exclusive"),
			employeeCoordinationGuard(target.employeeId),
		]);
	});

	it("locks the organization row after the guards", async () => {
		const { client, lockedRows } = stubClient();
		const fake = fakeWorkTransaction({ client });

		await fake.run(departureWorkPlan(database, target), async () => undefined);
		expect(lockedRows).toEqual(["organization"]);

		const missing = fakeWorkTransaction({
			client: stubClient({ organizationFound: false }).client,
		});
		await expect(
			missing.run(departureWorkPlan(database, target), async () => undefined),
		).rejects.toThrow("organization_not_found");
	});

	it("lets the operation write only the departing employee", async () => {
		const fake = fakeWorkTransaction({ client: stubClient().client });

		await fake.run(departureWorkPlan(database, target), async (scope) => {
			expect(() => scope.assertEmployee(target.organizationId, target.employeeId)).not.toThrow();
			expect(() => scope.assertEmployee(target.organizationId, "another-employee")).toThrow();
			expect(() => scope.assertEmployee("another-org", target.employeeId)).toThrow();
		});
	});

	it("refuses a guard taken late in the departure clock-out savepoint", async () => {
		const fake = fakeWorkTransaction({ client: stubClient().client, admission: "append" });

		await expect(
			fake.run(departureWorkPlan(database, target), (scope) =>
				scope.savepoint(async (savepoint) => {
					expect(savepoint.admission).toBe("append");
					// The departure never takes the organization configuration guard.
					await holdGuard(savepoint.db, organizationConfigurationGuard(target.organizationId));
				}),
			),
		).rejects.toThrow(/protocol violation/);
	});
});
