// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/lib/auth-client", () => ({
	useSession: () => ({
		data: {
			user: { id: "verifier" },
			session: { activeOrganizationId: "org" },
		},
	}),
}));
vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, fallback: string, values: Record<string, unknown> = {}) =>
			fallback.replace(/\{(\w+)\}/g, (_, key) => String(values[key] ?? key)),
	}),
}));
vi.mock("@/lib/organization/driving-licence/check-actions", () => ({
	getDrivingLicenceCheckWorklistAction: async () => ({
		success: true,
		data: [
			{
				employeeId: "former",
				name: "Anna Driver",
				canVerify: false,
				status: "ended",
			},
		],
	}),
	getDrivingLicenceEmployeeRecordAction: async () => ({
		success: true,
		data: {
			enrolled: true,
			status: "ended",
			authorizedClasses: [],
			classes: [],
			checks: [],
			events: [],
			timezone: "Europe/Berlin",
		},
	}),
	completeDrivingLicenceCheckAction: vi.fn(),
}));
vi.mock("@/lib/organization/driving-licence/history-actions", () => ({
	getDrivingLicenceHistoryAction: async () => ({ success: false }),
	supplementDrivingLicenceCheckAction: vi.fn(),
}));
vi.mock("@/lib/organization/driving-licence/impediment-actions", () => ({
	getDrivingImpedimentStateAction: vi.fn(),
	reinstateDrivingAuthorizationAction: vi.fn(),
}));
const { DrivingLicenceVerifierWorklist } = await import("./check-worklist");
afterEach(cleanup);
it("opens a former employee's ended evidence without offering a new check or reinstatement", async () => {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	const user = userEvent.setup();
	render(
		<QueryClientProvider client={client}>
			<DrivingLicenceVerifierWorklist />
		</QueryClientProvider>,
	);
	await user.click(
		await screen.findByRole("button", {
			name: "View ended record for Anna Driver",
		}),
	);
	expect(
		await screen.findByRole("heading", { name: "Original check evidence" }),
	).toBeTruthy();
	expect(
		screen.getByRole("heading", { name: "Driving authorization ended" }),
	).toBeTruthy();
	expect(
		screen.queryByRole("heading", { name: /Inspect Anna Driver/ }),
	).toBeNull();
	expect(screen.queryByRole("button", { name: /Reinstate/ })).toBeNull();
});
