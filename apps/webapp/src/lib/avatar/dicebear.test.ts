import { describe, expect, it } from "vitest";
import { generateAvatarDataUri } from "./dicebear";

describe("generateAvatarDataUri", () => {
	it.each(["male", "female", "other", undefined] as const)(
		"generates a DiceBear Lorelei avatar for gender %s",
		(gender) => {
			const avatar = generateAvatarDataUri({ seed: "user-1", gender });

			expect(avatar).toMatch(/^data:image\/svg\+xml/);
		},
	);

	it("generates deterministic avatars for the same seed", () => {
		const first = generateAvatarDataUri({ seed: "user-5", gender: "male" });
		const second = generateAvatarDataUri({ seed: "user-5", gender: "male" });

		expect(second).toBe(first);
	});
});
