import { createAvatar } from "@dicebear/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { generateAvatarDataUri } from "./dicebear";

vi.mock("@dicebear/core", () => ({
	createAvatar: vi.fn(() => ({
		toDataUri: () => "data:image/svg+xml;base64,test",
	})),
}));

vi.mock("@dicebear/collection", () => ({
	lorelei: {},
}));

describe("generateAvatarDataUri", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("sets DiceBear sex to male for male users", () => {
		generateAvatarDataUri({ seed: "user-1", gender: "male" });

		expect(createAvatar).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({ sex: ["male"] }),
		);
	});

	it("sets DiceBear sex to female for female users", () => {
		generateAvatarDataUri({ seed: "user-2", gender: "female" });

		expect(createAvatar).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({ sex: ["female"] }),
		);
	});

	it("keeps seeded random variants for other or missing gender", () => {
		generateAvatarDataUri({ seed: "user-3", gender: "other" });
		generateAvatarDataUri({ seed: "user-4" });

		expect(vi.mocked(createAvatar).mock.calls[0]?.[1]).not.toHaveProperty("sex");
		expect(vi.mocked(createAvatar).mock.calls[1]?.[1]).not.toHaveProperty("sex");
	});
});
