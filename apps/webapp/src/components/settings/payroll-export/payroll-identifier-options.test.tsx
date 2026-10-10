/* @vitest-environment jsdom */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const { saveDatevConfigActionMock, savePersonioConfigActionMock } = vi.hoisted(() => ({
	saveDatevConfigActionMock: vi.fn(),
	savePersonioConfigActionMock: vi.fn(),
}));

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, fallback?: string, params?: Record<string, string>) =>
			(fallback ?? _key).replace(/\{(\w+)\}/g, (_match, name: string) => params?.[name] ?? ""),
	}),
}));

vi.mock("@/app/[locale]/(app)/settings/payroll-export/actions", () => ({
	saveDatevConfigAction: saveDatevConfigActionMock,
	savePersonioConfigAction: savePersonioConfigActionMock,
	savePersonioCredentialsAction: vi.fn(),
	deletePersonioCredentialsAction: vi.fn(),
	testPersonioConnectionAction: vi.fn(),
}));

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("next/image", () => ({ default: () => null }));

import { DatevConfigForm } from "./datev-config-form";
import { identifierFromSelectValue, identifierSelectValue } from "./payroll-identifier-options";
import { PersonioConfigForm } from "./personio-config-form";

const FIELDS = [
	{ id: "field-1", name: "Payroll ID" },
	{ id: "field-2", name: "Badge" },
];
const dates = {
	isActive: true,
	createdAt: new Date("2026-01-01T00:00:00.000Z"),
	updatedAt: new Date("2026-01-01T00:00:00.000Z"),
};

beforeAll(() => {
	globalThis.ResizeObserver ??= class {
		observe() {}
		unobserve() {}
		disconnect() {}
	};
});

describe("identifier select values (#821)", () => {
	it("carries a custom field in the choice and reads it back", () => {
		expect(identifierSelectValue("customField", "field-1")).toBe("customField:field-1");
		expect(identifierFromSelectValue("customField:field-1")).toEqual({
			choice: "customField",
			customFieldId: "field-1",
		});
		expect(identifierSelectValue("employeeNumber", "field-1")).toBe("employeeNumber");
		expect(identifierFromSelectValue("email")).toEqual({
			choice: "email",
			customFieldId: undefined,
		});
	});
});

describe("payroll configuration forms with a custom field identifier (#821)", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		saveDatevConfigActionMock.mockResolvedValue({ success: true });
		savePersonioConfigActionMock.mockResolvedValue({ success: true });
	});

	it("shows and saves the DATEV personnel number custom field", async () => {
		const config = {
			mandantennummer: "12345",
			beraternummer: "1234567",
			personnelNumberType: "customField" as const,
			personnelNumberCustomFieldId: "field-2",
			includeZeroHours: false,
		};
		render(
			<DatevConfigForm
				organizationId="org_123"
				identifierFields={FIELDS}
				initialConfig={{ id: "cfg", formatId: "datev_lohn", config, ...dates }}
			/>,
		);

		expect(screen.getByRole("combobox", { name: "Personnel Number Type" }).textContent).toBe(
			"Custom field: Badge",
		);
		fireEvent.click(screen.getByRole("button", { name: "Save Configuration" }));

		await waitFor(() =>
			expect(saveDatevConfigActionMock).toHaveBeenCalledWith({ organizationId: "org_123", config }),
		);
	});

	it("keeps a saved field that is no longer offered visible as unavailable", () => {
		render(
			<PersonioConfigForm
				organizationId="org_123"
				identifierFields={FIELDS}
				initialConfig={{
					id: "cfg",
					formatId: "personio",
					hasCredentials: true,
					config: {
						employeeMatchStrategy: "customField",
						employeeMatchCustomFieldId: "field-archived",
						includeZeroHours: false,
						batchSize: 100,
						apiTimeoutMs: 30000,
					},
					...dates,
				}}
			/>,
		);

		expect(screen.getByRole("combobox", { name: "Employee Matching" }).textContent).toBe(
			"Custom field (unavailable)",
		);
	});
});
