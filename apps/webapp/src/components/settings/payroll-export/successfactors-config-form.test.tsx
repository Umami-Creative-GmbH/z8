/* @vitest-environment jsdom */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
	saveSuccessFactorsConfigActionMock,
	testSuccessFactorsConnectionActionMock,
} = vi.hoisted(() => ({
	saveSuccessFactorsConfigActionMock: vi.fn(),
	testSuccessFactorsConnectionActionMock: vi.fn(),
}));

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, fallback?: string) => fallback ?? _key,
	}),
}));

vi.mock("@/app/[locale]/(app)/settings/payroll-export/actions", () => ({
	saveSuccessFactorsConfigAction: saveSuccessFactorsConfigActionMock,
	testSuccessFactorsConnectionAction: testSuccessFactorsConnectionActionMock,
}));

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import { SuccessFactorsConfigForm } from "./successfactors-config-form";

describe("SuccessFactorsConfigForm", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		saveSuccessFactorsConfigActionMock.mockResolvedValue({ success: true });
	});

	it("preserves the organization-scoped SuccessFactors payload", async () => {
		render(
			<SuccessFactorsConfigForm
				organizationId="org_123"
				initialConfig={null}
			/>,
		);

		fireEvent.change(screen.getByLabelText("Instance URL"), {
			target: { value: "https://api.successfactors.example" },
		});
		fireEvent.change(screen.getByLabelText("Company ID"), {
			target: { value: "company-1" },
		});
		const settingsForm = screen
			.getByRole("button", { name: "Save Configuration" })
			.closest("form");
		expect(settingsForm).not.toBeNull();
		if (!settingsForm) throw new Error("Expected SuccessFactors settings form");
		fireEvent.submit(settingsForm);

		await waitFor(() => {
			expect(saveSuccessFactorsConfigActionMock).toHaveBeenCalledWith({
				organizationId: "org_123",
				config: {
					employeeMatchStrategy: "userId",
					instanceUrl: "https://api.successfactors.example",
					companyId: "company-1",
					includeZeroHours: false,
					batchSize: 100,
					apiTimeoutMs: 60000,
				},
			});
		});
	});
});
