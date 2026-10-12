import { describe, expect, it } from "vitest";
import { buttonVariants } from "./button-variants";

describe("buttonVariants", () => {
	it("returns button classes for variant and size selections", () => {
		expect(buttonVariants({ variant: "outline", size: "sm" })).toContain("border");
		expect(buttonVariants({ variant: "outline", size: "sm" })).toContain("h-8");
	});

	it("gives every size a hit area of at least 44 by 44 px on touch screens (#846)", () => {
		for (const size of ["default", "sm", "lg", "icon"] as const) {
			const classes = buttonVariants({ size }).split(" ");
			expect(classes).toContain("relative");
			expect(classes).toContain("pointer-coarse:after:absolute");
			expect(classes).toContain("pointer-coarse:after:inset-[min(0px,calc((100%_-_2.75rem)/2))]");
		}
	});
});
