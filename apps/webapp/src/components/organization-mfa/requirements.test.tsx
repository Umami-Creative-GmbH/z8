// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({ t: (_key: string, fallback: string) => fallback }),
}));

import { MfaRequirements } from "./requirements";

it("names the selected organization without confusing its enforced state with another organization's grace window", () => {
	render(
		<MfaRequirements
			organizationId="enforced"
			callbackUrl="/en/calendar"
			requirements={[
				{
					organizationId: "grace",
					organizationName: "Grace team",
					deadline: "2026-11-20T00:00:00Z",
					deadlineLabel: "20 November 2026",
					enforced: false,
				},
				{
					organizationId: "enforced",
					organizationName: "Protected team",
					deadline: null,
					deadlineLabel: null,
					enforced: true,
				},
			]}
		/>,
	);
	const selected = screen.getByRole("link", { name: "Protected team" });
	expect(selected.getAttribute("aria-current")).toBe("true");
	expect(selected.closest("li")?.textContent).toContain(
		"Verification required now",
	);
	expect(
		screen.getByRole("link", { name: "Grace team" }).closest("li")?.textContent,
	).toContain("20 November 2026");
	const url = new URL(
		screen.getByRole<HTMLAnchorElement>("link", { name: "Grace team" }).href,
		"http://localhost/en/mfa",
	);
	expect(url.searchParams.get("organizationId")).toBe("grace");
	expect(url.searchParams.get("callbackUrl")).toBe("/en/calendar");
});

it("keeps absent requirements neutral rather than claiming a verified session", () => {
	render(<MfaRequirements organizationId={null} requirements={[]} />);
	expect(
		screen.getByText(
			"No organization requirements are listed for this account.",
		),
	).toBeTruthy();
	expect(screen.queryByText("Verified")).toBeNull();
});
