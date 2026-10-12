/* @vitest-environment jsdom */

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Checkbox } from "./checkbox";

describe("Checkbox", () => {
	it("keeps its 16 px box but takes 44 by 44 px taps on touch screens (#846)", () => {
		render(<Checkbox aria-label="Select request" />);

		const checkbox = screen.getByRole("checkbox", { name: "Select request" });
		const classes = checkbox.className.split(" ");
		expect(classes).toContain("size-4");
		expect(classes).toContain("pointer-coarse:after:absolute");
		expect(classes).toContain("pointer-coarse:after:inset-[min(0px,calc((100%_-_2.75rem)/2))]");
	});
});
