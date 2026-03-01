/* @vitest-environment jsdom */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";

const {
	saveWorkdayConfigActionMock,
	saveWorkdayCredentialsActionMock,
	deleteWorkdayCredentialsActionMock,
	testWorkdayConnectionActionMock,
} = vi.hoisted(() => ({
	saveWorkdayConfigActionMock: vi.fn(),
	saveWorkdayCredentialsActionMock: vi.fn(),
	deleteWorkdayCredentialsActionMock: vi.fn(),
	testWorkdayConnectionActionMock: vi.fn(),
}));

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, defaultValue?: string) => defaultValue ?? _key,
	}),
}));

vi.mock("@/app/[locale]/(app)/settings/payroll-export/actions", () => ({
	saveWorkdayConfigAction: saveWorkdayConfigActionMock,
	saveWorkdayCredentialsAction: saveWorkdayCredentialsActionMock,
	deleteWorkdayCredentialsAction: deleteWorkdayCredentialsActionMock,
	testWorkdayConnectionAction: testWorkdayConnectionActionMock,
}));

vi.mock("sonner", () => ({
	toast: {
		success: vi.fn(),
		error: vi.fn(),
	},
}));

import { WorkdayConfigForm } from "./workday-config-form";

beforeAll(() => {
	if (!globalThis.ResizeObserver) {
		globalThis.ResizeObserver = class ResizeObserver {
			observe() {}
			unobserve() {}
			disconnect() {}
		};
	}
});

describe("WorkdayConfigForm", () => {
	it("renders key controls and triggers Test Connection action", async () => {
		testWorkdayConnectionActionMock.mockResolvedValue({
			success: true,
			data: {
				success: true,
			},
		});

		render(
			<WorkdayConfigForm
				organizationId="org_123"
				initialConfig={{
					id: "cfg_123",
					formatId: "workday_api",
					isActive: true,
					createdAt: new Date("2026-01-01T00:00:00.000Z"),
					updatedAt: new Date("2026-01-01T00:00:00.000Z"),
					hasCredentials: true,
					config: {
						instanceUrl: "https://wd5-impl-services1.workday.com",
						tenantId: "tenant_name",
						employeeMatchStrategy: "employeeNumber",
						includeZeroHours: false,
						batchSize: 100,
						apiTimeoutMs: 30000,
					},
				}}
			/>,
		);

		expect(screen.getByLabelText("Instance URL")).toBeTruthy();
		expect(screen.getByLabelText("Tenant ID")).toBeTruthy();
		expect(screen.getByRole("button", { name: "Save Settings" })).toBeTruthy();

		const testConnectionButton = screen.getByRole("button", { name: "Test Connection" });
		expect(testConnectionButton.hasAttribute("disabled")).toBe(false);

		fireEvent.click(testConnectionButton);

		await waitFor(() => {
			expect(testWorkdayConnectionActionMock).toHaveBeenCalledTimes(1);
		});

		expect(testWorkdayConnectionActionMock).toHaveBeenCalledWith({
			organizationId: "org_123",
			config: {
				instanceUrl: "https://wd5-impl-services1.workday.com",
				tenantId: "tenant_name",
				employeeMatchStrategy: "employeeNumber",
				includeZeroHours: false,
				batchSize: 100,
				apiTimeoutMs: 30000,
			},
		});
	});
});
