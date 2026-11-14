/* @vitest-environment jsdom */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getNoEmployeeReason } from "./no-employee-reason-action";
import { NoEmployeeError } from "./no-employee-error";

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, fallback?: string, values?: Record<string, unknown>) =>
			(fallback ?? _key).replace(/\{(\w+)\}/g, (match, name: string) =>
				values?.[name] === undefined ? match : String(values[name]),
			),
	}),
}));
vi.mock("@/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/components/organization/create-organization-dialog", () => ({
	CreateOrganizationDialog: () => null,
}));
vi.mock("./no-employee-reason-action", () => ({ getNoEmployeeReason: vi.fn() }));

afterEach(cleanup);

describe("NoEmployeeError (#1672)", () => {
	it("tells a former employee who is a member again that a rehire is needed", async () => {
		vi.mocked(getNoEmployeeReason).mockResolvedValue("former_employee");

		render(<NoEmployeeError feature="view the calendar" />);

		expect(await screen.findByText("Your employment here has ended")).toBeTruthy();
		expect(
			screen.getByText(
				"You are a member of this organization again, but your earlier employment ended. An administrator needs to rehire you before you can view the calendar.",
			),
		).toBeTruthy();
		expect(screen.queryByRole("button", { name: "Create Organization" })).toBeNull();
		expect(screen.getByRole("button", { name: "Contact Administrator" })).toBeTruthy();
	});

	it("keeps the profile-required message for anyone else", async () => {
		vi.mocked(getNoEmployeeReason).mockResolvedValue(null);

		render(<NoEmployeeError feature="view the calendar" />);

		expect(screen.getByText("Employee Profile Required")).toBeTruthy();
		await vi.waitFor(() => expect(getNoEmployeeReason).toHaveBeenCalled());
		expect(screen.getByText("Employee Profile Required")).toBeTruthy();
		expect(screen.getByRole("button", { name: "Create Organization" })).toBeTruthy();
	});

	it("keeps the profile-required message when the reason cannot be read", async () => {
		vi.mocked(getNoEmployeeReason).mockRejectedValue(new Error("offline"));

		render(<NoEmployeeError />);

		await vi.waitFor(() => expect(getNoEmployeeReason).toHaveBeenCalled());
		expect(screen.getByText("Employee Profile Required")).toBeTruthy();
	});
});
