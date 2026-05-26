import { describe, expect, it } from "vitest";
import { badgeVariants } from "./badge-variants";

describe("badgeVariants", () => {
	it("returns badge classes for variant selections", () => {
		expect(badgeVariants({ variant: "secondary" })).toContain("bg-secondary");
		expect(badgeVariants({ variant: "secondary" })).toContain("text-secondary-foreground");
	});
});
