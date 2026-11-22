/* @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { UserOrganization } from "@/lib/auth-helpers";

const mocks = vi.hoisted(() => ({
	pathname: "/billing/suspended",
	push: vi.fn(),
	refresh: vi.fn(),
	signOut: vi.fn(),
	clearManualRecoveries: vi.fn(),
	resetOrgSettings: vi.fn(),
	saveLastOrganization: vi.fn(),
	toastError: vi.fn(),
	toastWarning: vi.fn(),
	fetch: vi.fn(),
}));

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, fallback: string) => fallback,
	}),
}));

vi.mock("@/navigation", () => ({
	Link: ({ href, children, ...props }: ComponentProps<"a">) => (
		<a href={href} {...props}>
			{children}
		</a>
	),
	usePathname: () => mocks.pathname,
	useRouter: () => ({ push: mocks.push, refresh: mocks.refresh }),
}));

vi.mock("@/lib/store-app/sign-out", () => ({
	signOut: mocks.signOut,
}));

vi.mock("@/components/time-tracking/manual-command-recovery", () => ({
	clearManualRecoveries: mocks.clearManualRecoveries,
}));

vi.mock("@/stores/organization-settings-store", () => ({
	useOrganizationSettings: (selector: (state: { reset: () => void }) => unknown) =>
		selector({ reset: mocks.resetOrgSettings }),
}));

vi.mock("@/lib/org-persistence", () => ({
	saveLastOrganization: mocks.saveLastOrganization,
}));

vi.mock("sonner", () => ({
	toast: {
		error: mocks.toastError,
		warning: mocks.toastWarning,
	},
}));

vi.mock("@/components/organization/create-organization-dialog", () => ({
	CreateOrganizationDialog: () => null,
}));

vi.mock("@/components/organization/organization-logo", () => ({
	OrganizationLogo: ({ name }: { name: string }) => <span data-testid="org-logo">{name[0]}</span>,
}));

import { BillingRecoveryHeader } from "./billing-recovery-header";

const organizations: UserOrganization[] = [
	{
		id: "org-1",
		name: "Suspended Corp",
		slug: "suspended-corp",
		logo: null,
		memberRole: "admin",
		hasEmployeeRecord: true,
		shiftsEnabled: false,
		projectsEnabled: false,
		surchargesEnabled: false,
		demoDataEnabled: false,
		worksCouncilEnabled: false,
		billableTimeEnabled: false,
		personnelFilesEnabled: false,
		equipmentEnabled: false,
	},
	{
		id: "org-2",
		name: "Active Corp",
		slug: "active-corp",
		logo: null,
		memberRole: "member",
		hasEmployeeRecord: true,
		shiftsEnabled: false,
		projectsEnabled: false,
		surchargesEnabled: false,
		demoDataEnabled: false,
		worksCouncilEnabled: false,
		billableTimeEnabled: false,
		personnelFilesEnabled: false,
		equipmentEnabled: false,
	},
];

beforeEach(() => {
	vi.clearAllMocks();
	mocks.pathname = "/billing/suspended";
	mocks.signOut.mockImplementation(
		async (options?: { fetchOptions?: { onSuccess?: () => void } }) => {
			options?.fetchOptions?.onSuccess?.();
		},
	);
	vi.stubGlobal("fetch", mocks.fetch);
});

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
});

describe("BillingRecoveryHeader", () => {
	it("renders organization switcher, sign-out, and Billing & Subscription link for org admins on /billing/suspended", () => {
		render(
			<BillingRecoveryHeader
				organizations={organizations}
				currentOrganization={organizations[0]}
				canAccessBilling
			/>,
		);

		expect(
			screen.getByRole("button", { name: "Switch Organization: Suspended Corp" }),
		).toBeTruthy();
		expect(screen.getByRole("link", { name: "Billing & Subscription" }).getAttribute("href")).toBe(
			"/settings/billing",
		);
		expect(screen.getByRole("button", { name: "Log out" })).toBeTruthy();
	});

	it("links back to the suspension notice for org admins on /settings/billing", () => {
		mocks.pathname = "/en/settings/billing";
		render(
			<BillingRecoveryHeader
				organizations={organizations}
				currentOrganization={organizations[0]}
				canAccessBilling
			/>,
		);

		expect(screen.getByRole("link", { name: "Suspension notice" }).getAttribute("href")).toBe(
			"/billing/suspended",
		);
		expect(screen.queryByRole("link", { name: "Billing & Subscription" })).toBeNull();
	});

	it("omits billing navigation links for non-admin members while retaining org switcher and sign-out", () => {
		render(
			<BillingRecoveryHeader
				organizations={organizations}
				currentOrganization={organizations[0]}
				canAccessBilling={false}
			/>,
		);

		expect(
			screen.getByRole("button", { name: "Switch Organization: Suspended Corp" }),
		).toBeTruthy();
		expect(screen.getByRole("button", { name: "Log out" })).toBeTruthy();
		expect(screen.queryByRole("link")).toBeNull();
	});

	it("signs out through the shared sign-out flow and clears manual recoveries", async () => {
		render(
			<BillingRecoveryHeader
				organizations={organizations}
				currentOrganization={organizations[0]}
				canAccessBilling={false}
			/>,
		);

		fireEvent.click(screen.getByRole("button", { name: "Log out" }));

		await waitFor(() => expect(mocks.signOut).toHaveBeenCalledOnce());
		expect(mocks.clearManualRecoveries).toHaveBeenCalledOnce();
		await waitFor(() => expect(mocks.push).toHaveBeenCalledWith("/sign-in"));
	});
});
