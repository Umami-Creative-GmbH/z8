/* @vitest-environment jsdom */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { refreshMock, setSettingsMock, toastErrorMock, toastSuccessMock, updateTimezoneMock } =
	vi.hoisted(() => ({
		refreshMock: vi.fn(),
		setSettingsMock: vi.fn(),
		toastErrorMock: vi.fn(),
		toastSuccessMock: vi.fn(),
		updateTimezoneMock: vi.fn(),
	}));

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, defaultValue?: string) => defaultValue ?? _key,
	}),
}));

vi.mock("sonner", () => ({
	toast: { error: toastErrorMock, success: toastSuccessMock },
}));

vi.mock("@/navigation", () => ({
	useRouter: () => ({ refresh: refreshMock }),
}));

vi.mock("@/stores/organization-settings-store", () => ({
	useOrganizationSettings: (
		selector: (state: { setSettings: typeof setSettingsMock }) => unknown,
	) => selector({ setSettings: setSettingsMock }),
}));

vi.mock("@/app/[locale]/(app)/settings/organizations/actions", () => ({
	updateOrganizationTimezone: updateTimezoneMock,
}));

vi.mock("@/components/settings/timezone-picker", () => ({
	TimezonePicker: ({
		value,
		onChange,
		disabled,
	}: {
		value: string;
		onChange: (value: string) => void;
		disabled?: boolean;
	}) => (
		<input
			aria-label="Organization timezone"
			disabled={disabled}
			value={value}
			onChange={(event) => onChange(event.currentTarget.value)}
		/>
	),
}));

import { OrganizationTimezoneCard } from "./organization-timezone-card";

function renderCard() {
	render(
		<OrganizationTimezoneCard
			organizationId="org-1"
			timezone="Europe/Berlin"
			currentMemberRole="owner"
		/>,
	);
	fireEvent.change(screen.getByLabelText("Organization timezone"), {
		target: { value: "America/New_York" },
	});
}

describe("OrganizationTimezoneCard", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("reports a committed save as saved and says balances are being recalculated", async () => {
		updateTimezoneMock.mockResolvedValue({ success: true, data: undefined });

		renderCard();

		await waitFor(() => {
			expect(toastSuccessMock).toHaveBeenCalledWith("Organization timezone updated to {timezone}", {
				description:
					"Work balances are being recalculated for the new timezone and stay hidden until they are ready.",
			});
		});
		expect(updateTimezoneMock).toHaveBeenCalledWith("org-1", "America/New_York");
		expect(toastErrorMock).not.toHaveBeenCalled();
		expect(refreshMock).toHaveBeenCalledOnce();
	});

	it("reverts the optimistic zone when the save fails", async () => {
		updateTimezoneMock.mockResolvedValue({ success: false, error: "Only owners can change it" });

		renderCard();

		await waitFor(() => {
			expect(toastErrorMock).toHaveBeenCalledWith("Only owners can change it");
		});
		expect(screen.getByLabelText("Organization timezone")).toHaveProperty("value", "Europe/Berlin");
		expect(setSettingsMock).toHaveBeenLastCalledWith({ timezone: "Europe/Berlin" });
		expect(toastSuccessMock).not.toHaveBeenCalled();
	});
});
