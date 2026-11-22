/* @vitest-environment jsdom */

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/components/join-organization-form", () => ({
	JoinOrganizationForm: ({ code }: { code?: string }) => (
		<div data-testid="join-organization-form" data-code={code ?? ""} />
	),
}));

import JoinIndexPage from "./page";

describe("JoinIndexPage", () => {
	it("renders the manual invite-code entry form without a prefilled code", () => {
		render(<JoinIndexPage />);

		const form = screen.getByTestId("join-organization-form");
		expect(form.getAttribute("data-code")).toBe("");
	});
});
