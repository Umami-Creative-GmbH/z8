/* @vitest-environment jsdom */

import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { NoOrganizationError } from "./no-organization-error";

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({ t: (_key: string, fallback: string) => fallback }),
}));
vi.mock("@/navigation", () => ({
	useRouter: () => ({ refresh: vi.fn() }),
}));
vi.mock("@/components/organization/create-organization-dialog", () => ({
	CreateOrganizationDialog: () => null,
}));

it("identifies dashboard recovery with one main task heading and retains the create action", () => {
	render(<NoOrganizationError />);
	expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
		"No Organization Found",
	);
	expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
	expect(
		screen.getByRole("button", { name: "Create Organization" }),
	).toBeTruthy();
	expect(screen.getByText("Waiting for an invitation?")).toBeTruthy();
});
