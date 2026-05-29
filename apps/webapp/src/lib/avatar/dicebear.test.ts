import { Avatar } from "@dicebear/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { generateAvatarDataUri } from "./dicebear";

vi.mock("@dicebear/core", () => ({
	Avatar: vi.fn(function Avatar() {
		return {
			toDataUri: () => "data:image/svg+xml;base64,test",
		};
	}),
}));

vi.mock("@dicebear/styles/lorelei.json", () => ({ default: { name: "lorelei" } }));

describe("generateAvatarDataUri", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("sets DiceBear sex to male for male users", () => {
		generateAvatarDataUri({ seed: "user-1", gender: "male" });

		expect(Avatar).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({ sex: ["male"] }),
		);
	});

	it("sets DiceBear sex to female for female users", () => {
		generateAvatarDataUri({ seed: "user-2", gender: "female" });

		expect(Avatar).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({ sex: ["female"] }),
		);
	});

	it("uses DiceBear v10 option names for avatar shape and background", () => {
		generateAvatarDataUri({ seed: "user-5" });

		expect(Avatar).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({
				backgroundColorFill: "solid",
				borderRadius: 50,
			}),
		);
	});

	it("keeps seeded random variants for other or missing gender", () => {
		generateAvatarDataUri({ seed: "user-3", gender: "other" });
		generateAvatarDataUri({ seed: "user-4" });

		expect(vi.mocked(Avatar).mock.calls[0]?.[1]).not.toHaveProperty("sex");
		expect(vi.mocked(Avatar).mock.calls[1]?.[1]).not.toHaveProperty("sex");
	});
});
