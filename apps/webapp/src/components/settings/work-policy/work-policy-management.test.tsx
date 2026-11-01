/* @vitest-environment jsdom */

import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const searchParams = { current: new URLSearchParams() };

vi.mock("next/navigation", () => ({
	useSearchParams: () => searchParams.current,
}));

vi.mock("@tanstack/react-query", () => ({
	useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({ t: (_key: string, fallback: string) => fallback }),
}));

vi.mock("./work-policy-table", () => ({ WorkPolicyTable: () => <p>Policy table</p> }));
vi.mock("./work-policy-assignment-manager", () => ({
	WorkPolicyAssignmentManager: () => <p>Assignment manager</p>,
}));
vi.mock("./work-policy-assignment-dialog", () => ({ WorkPolicyAssignmentDialog: () => null }));
vi.mock("./work-policy-dialog", () => ({ WorkPolicyDialog: () => null }));
vi.mock("./work-policy-preset-import", () => ({ WorkPolicyPresetImport: () => null }));
vi.mock("./work-policy-compliance-view", () => ({ WorkPolicyComplianceView: () => null }));

import { WorkPolicyManagement } from "./work-policy-management";

describe("WorkPolicyManagement", () => {
	beforeEach(() => {
		searchParams.current = new URLSearchParams();
	});

	it("opens on the policies tab by default", () => {
		render(<WorkPolicyManagement accessTier="orgAdmin" organizationId="org-1" />);

		expect(screen.getByRole("tab", { name: "Policies" }).getAttribute("aria-selected")).toBe(
			"true",
		);
		expect(screen.getByText("Policy table")).toBeTruthy();
	});

	it("opens the assignments tab from a go-live fix link", () => {
		searchParams.current = new URLSearchParams("tab=work&view=assignments");

		render(<WorkPolicyManagement accessTier="orgAdmin" organizationId="org-1" />);

		expect(screen.getByRole("tab", { name: "Assignments" }).getAttribute("aria-selected")).toBe(
			"true",
		);
		expect(screen.getByText("Assignment manager")).toBeTruthy();
	});
});
