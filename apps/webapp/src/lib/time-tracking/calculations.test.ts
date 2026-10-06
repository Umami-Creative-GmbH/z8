import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	runEmployeePolicyLookup: vi.fn(),
}));

vi.mock("@/lib/effect/work-policy-runtime", () => ({
	runEmployeePolicyLookup: mocks.runEmployeePolicyLookup,
}));

import { getEmployeePolicy } from "./calculations";

describe("getEmployeePolicy", () => {
	beforeEach(() => {
		mocks.runEmployeePolicyLookup.mockReset();
	});

	it("passes organization scope to the focused work-policy runtime", async () => {
		mocks.runEmployeePolicyLookup.mockResolvedValue(null);

		await getEmployeePolicy("employee-1", "organization-1");

		expect(mocks.runEmployeePolicyLookup).toHaveBeenCalledWith(
			"employee-1",
			"organization-1",
		);
	});

	it("keeps the existing null result when policy resolution fails", async () => {
		mocks.runEmployeePolicyLookup.mockRejectedValue(
			new Error("database unavailable"),
		);

		await expect(
			getEmployeePolicy("employee-1", "organization-1"),
		).resolves.toBeNull();
	});
});
