// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

const boundary = vi.hoisted(() => ({ context: vi.fn(), read: vi.fn() }));
vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({ t: (_key: string, fallback: string) => fallback }),
}));
vi.mock("@/lib/auth-client", () => ({
	useSession: () => ({
		isPending: false,
		data: { user: { id: "vehicle-reader" }, session: { activeOrganizationId: "vehicle-org" } },
	}),
}));
vi.mock("@/lib/fetch", () => ({
	fetchApi: boundary.context,
	ApiError: class ApiError extends Error {
		isUnauthorized() {
			return false;
		}
	},
}));
vi.mock("@/navigation", () => ({ useRouter: () => ({ replace: vi.fn() }) }));
vi.mock("@/hooks/use-display-context", () => ({
	useDisplayContext: () => ({ locale: "en-US", timezone: "UTC", timeFormat: "24h" }),
}));
vi.mock("@/components/providers/view-refresh-provider", () => ({ useViewRefresh: () => {} }));
vi.mock("@/app/[locale]/(app)/reports/vehicles/actions", () => ({
	getVehicleDistanceReport: boundary.read,
}));

import { OrganizationContextProvider } from "@/components/providers/organization-context-provider";
import { VehicleDistanceReportContainer } from "@/components/reports/vehicles/vehicle-distance-report-container";
import { useOrganization } from "@/hooks/use-organization";

function PublicContextWitness() {
	const scope = useOrganization();
	return (
		<output aria-label="Context transport state">
			{scope.error ?? (scope.isLoading ? "pending" : "admitted")}
		</output>
	);
}
afterEach(cleanup);
it("offers local Retry after the real organization context query fails before an initial vehicle snapshot", async () => {
	boundary.context.mockRejectedValueOnce(new Error("Vehicle scope transport unavailable"));
	const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
	render(
		<QueryClientProvider client={client}>
			<OrganizationContextProvider initialContext={null}>
				<PublicContextWitness />
				<VehicleDistanceReportContainer />
			</OrganizationContextProvider>
		</QueryClientProvider>,
	);
	await waitFor(() => expect(boundary.context).toHaveBeenCalledTimes(1));
	expect(await screen.findByText("Vehicle scope transport unavailable")).toBeTruthy();
	expect(boundary.read).not.toHaveBeenCalled();
	const retry = screen.getByRole("button", { name: "Retry" });
	boundary.context.mockResolvedValueOnce({
		user: { id: "vehicle-reader" },
		session: { activeOrganizationId: "vehicle-org" },
		employee: { employeeId: "vehicle-employee", organizationId: "vehicle-org", role: "employee" },
		organizationSettings: { organizationId: "vehicle-org", timezone: "Europe/Berlin" },
	});
	fireEvent.click(retry);
	expect(await screen.findByRole("button", { name: "Generate report" })).toBeTruthy();
	expect(boundary.context).toHaveBeenCalledTimes(2);
	client.clear();
});
