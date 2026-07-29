/* @vitest-environment jsdom */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
	deletePersonioCredentialsActionMock,
	savePersonioConfigActionMock,
	savePersonioCredentialsActionMock,
	testPersonioConnectionActionMock,
} = vi.hoisted(() => ({
	deletePersonioCredentialsActionMock: vi.fn(),
	savePersonioConfigActionMock: vi.fn(),
	savePersonioCredentialsActionMock: vi.fn(),
	testPersonioConnectionActionMock: vi.fn(),
}));

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, fallback?: string) => fallback ?? _key,
	}),
}));

vi.mock("@/app/[locale]/(app)/settings/payroll-export/actions", () => ({
	deletePersonioCredentialsAction: deletePersonioCredentialsActionMock,
	savePersonioConfigAction: savePersonioConfigActionMock,
	savePersonioCredentialsAction: savePersonioCredentialsActionMock,
	testPersonioConnectionAction: testPersonioConnectionActionMock,
}));

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import { PersonioConfigForm } from "./personio-config-form";

describe("PersonioConfigForm", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		savePersonioConfigActionMock.mockResolvedValue({ success: true });
		savePersonioCredentialsActionMock.mockResolvedValue({ success: true });
	});

	it("keeps credentials organization-scoped and clears them after saving", async () => {
		render(
			<PersonioConfigForm organizationId="org_123" initialConfig={null} />,
		);

		fireEvent.change(screen.getByLabelText("Client ID"), {
			target: { value: "client-1" },
		});
		fireEvent.change(screen.getByLabelText("API Secret"), {
			target: { value: "secret-1" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Save Credentials" }));

		await waitFor(() => {
			expect(savePersonioCredentialsActionMock).toHaveBeenCalledWith({
				organizationId: "org_123",
				clientId: "client-1",
				clientSecret: "secret-1",
			});
		});
		expect(screen.queryByDisplayValue("client-1")).toBeNull();
		expect(screen.queryByDisplayValue("secret-1")).toBeNull();
	});

	it("preserves the complete Personio configuration payload", async () => {
		render(
			<PersonioConfigForm organizationId="org_123" initialConfig={null} />,
		);

		const settingsForm = screen
			.getByRole("button", { name: "Save Settings" })
			.closest("form");
		expect(settingsForm).not.toBeNull();
		if (!settingsForm) throw new Error("Expected Personio settings form");
		fireEvent.submit(settingsForm);

		await waitFor(() => {
			expect(savePersonioConfigActionMock).toHaveBeenCalledWith({
				organizationId: "org_123",
				config: {
					employeeMatchStrategy: "employeeNumber",
					includeZeroHours: false,
					batchSize: 100,
					apiTimeoutMs: 30000,
				},
			});
		});
	});
});
