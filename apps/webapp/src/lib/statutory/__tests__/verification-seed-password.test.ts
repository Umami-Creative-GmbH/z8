import { describe, expect, it } from "vitest";
import { verificationSeedPassword } from "./verification-seed-password";

describe("verification seed password", () => {
	it("generates a password and prints it when STATUTORY_SEED_PASSWORD is not set", () => {
		const chosen = verificationSeedPassword(undefined, () => "generated-secret");

		expect(chosen.password).toBe("generated-secret");
		expect(chosen.notice).toBe("Password for every login: generated-secret");
	});

	it("never prints a password taken from STATUTORY_SEED_PASSWORD", () => {
		const chosen = verificationSeedPassword("my-own-secret", () => "generated-secret");

		expect(chosen.password).toBe("my-own-secret");
		expect(chosen.notice).not.toContain("my-own-secret");
		expect(chosen.notice).toBe("Every login uses the password from STATUTORY_SEED_PASSWORD.");
	});

	it("treats an empty STATUTORY_SEED_PASSWORD as unset", () => {
		const chosen = verificationSeedPassword("", () => "generated-secret");

		expect(chosen.password).toBe("generated-secret");
		expect(chosen.notice).toContain("generated-secret");
	});
});
