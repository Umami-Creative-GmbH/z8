/* @vitest-environment jsdom */

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { OrganizationLogo } from "./organization-logo";

describe("OrganizationLogo", () => {
	it("renders a plain image for an uploaded organization logo", () => {
		render(
			<OrganizationLogo logo="https://cdn.example.com/org-logos/org-1/logo.webp" name="Acme" />,
		);

		const image = screen.getByRole("img", { name: "Acme" });

		expect(image.tagName).toBe("IMG");
		expect(image.getAttribute("src")).toBe("https://cdn.example.com/org-logos/org-1/logo.webp");
	});

	it("renders the building fallback when no logo is available", () => {
		render(<OrganizationLogo logo={null} name="Acme" />);

		expect(screen.getByTestId("organization-logo-fallback")).toBeTruthy();
		expect(screen.queryByRole("img", { name: "Acme" })).toBeNull();
	});
});
