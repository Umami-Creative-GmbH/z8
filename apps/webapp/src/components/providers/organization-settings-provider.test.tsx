/* @vitest-environment jsdom */

import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useOrganizationSettings } from "@/stores/organization-settings-store";
import { OrganizationSettingsProvider } from "./organization-settings-provider";

const mocks = vi.hoisted(() => ({
	useOrganization: vi.fn(),
}));

vi.mock("@/hooks/use-organization", () => ({
	useOrganization: mocks.useOrganization,
}));

const observedSettings: string[] = [];

function SettingsProbe() {
	const settings = useOrganizationSettings();
	observedSettings.push(
		`${settings.organizationId ?? ""}:${settings.timezone}:${String(settings.isHydrated)}`,
	);
	return (
		<div data-testid="settings">
			{settings.organizationId}:{settings.timezone}:{String(settings.isHydrated)}
		</div>
	);
}

describe("OrganizationSettingsProvider", () => {
	afterEach(() => {
		act(() => useOrganizationSettings.getState().reset());
		vi.clearAllMocks();
		observedSettings.length = 0;
	});

	it("hydrates server-provided settings without fetching auth context", async () => {
		render(
			<OrganizationSettingsProvider
				initialSettings={{
					organizationId: "org-1",
					shiftsEnabled: true,
					projectsEnabled: true,
					surchargesEnabled: false,
					demoDataEnabled: false,
					worksCouncilEnabled: true,
					timezone: "Europe/Berlin",
					deletedAt: null,
				}}
			>
				<SettingsProbe />
			</OrganizationSettingsProvider>,
		);

		expect(screen.getByTestId("settings").textContent).toBe("org-1:Europe/Berlin:true");
		expect(observedSettings[0]).toBe("org-1:Europe/Berlin:true");
		expect(mocks.useOrganization).not.toHaveBeenCalled();
	});
});
