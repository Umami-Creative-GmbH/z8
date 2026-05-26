import { describe, expect, it } from "vitest";
import { buttonVariants } from "./button-variants";

describe("buttonVariants", () => {
	it("returns button classes for variant and size selections", () => {
		expect(buttonVariants({ variant: "outline", size: "sm" })).toContain("border");
		expect(buttonVariants({ variant: "outline", size: "sm" })).toContain("h-8");
	});
});
