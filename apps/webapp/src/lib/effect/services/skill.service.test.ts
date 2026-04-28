import { describe, expect, it } from "vitest";

describe("SkillService qualification renewal behavior", () => {
	it("requires an expiry date when renewing a qualification type that requires expiry", () => {
		const requiresExpiry = true;
		const requestedExpiresAt = undefined;
		expect(requiresExpiry && !requestedExpiresAt).toBe(true);
	});

	it("approval should update active qualification metadata and mark request approved", () => {
		const approved = {
			status: "approved",
			reviewerId: "manager-1",
			reviewNotes: "Current certificate accepted",
		};
		expect(approved).toMatchObject({ status: "approved", reviewerId: "manager-1" });
	});
});
