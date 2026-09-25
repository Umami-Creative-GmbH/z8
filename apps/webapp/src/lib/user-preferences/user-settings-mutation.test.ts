import { beforeEach, describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => ({
	calls: [] as string[],
	acquireExclusiveUserConfigurationAccessGuards: vi.fn(),
}));

vi.mock("@/lib/time-tracking/work-transaction", () => ({
	acquireExclusiveUserConfigurationAccessGuards:
		mockState.acquireExclusiveUserConfigurationAccessGuards,
}));

import { userSettings } from "@/db/schema";
import { writeUserSettings } from "./user-settings-mutation";

function fakeDatabase() {
	const values = vi.fn();
	const onConflictDoUpdate = vi.fn(async () => {
		mockState.calls.push("upsert");
	});
	const transaction = { insert: vi.fn(() => ({ values })) };
	values.mockReturnValue({ onConflictDoUpdate });
	const database = {
		transaction: vi.fn(async (callback: (tx: typeof transaction) => Promise<unknown>) =>
			callback(transaction),
		),
	};
	return { database, transaction, values, onConflictDoUpdate };
}

describe("writeUserSettings", () => {
	beforeEach(() => {
		mockState.calls.length = 0;
		mockState.acquireExclusiveUserConfigurationAccessGuards.mockReset();
		mockState.acquireExclusiveUserConfigurationAccessGuards.mockImplementation(async () => {
			mockState.calls.push("guard");
		});
	});

	it("takes the user's exclusive protection before upserting in the same transaction", async () => {
		const { database, transaction, values, onConflictDoUpdate } = fakeDatabase();

		await writeUserSettings(database as never, "user-1", { weekStartDay: "monday" });

		expect(database.transaction).toHaveBeenCalledTimes(1);
		expect(mockState.acquireExclusiveUserConfigurationAccessGuards).toHaveBeenCalledWith(
			transaction,
			["user-1"],
		);
		expect(mockState.calls).toEqual(["guard", "upsert"]);
		expect(transaction.insert).toHaveBeenCalledWith(userSettings);
		expect(values).toHaveBeenCalledWith({ userId: "user-1", weekStartDay: "monday" });
		expect(onConflictDoUpdate).toHaveBeenCalledWith({
			target: userSettings.userId,
			set: { weekStartDay: "monday" },
		});
	});

	it("writes nothing when protection cannot be acquired", async () => {
		const { database, transaction } = fakeDatabase();
		mockState.acquireExclusiveUserConfigurationAccessGuards.mockRejectedValue(
			new Error("canceling statement due to statement timeout"),
		);

		await expect(writeUserSettings(database as never, "user-1", { locale: "de" })).rejects.toThrow(
			"statement timeout",
		);
		expect(transaction.insert).not.toHaveBeenCalled();
	});
});
