// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
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
	useTolgee: () => ({ getLanguage: () => "en" }),
}));
const remote = vi.hoisted(() => ({ status: "ended" }));
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
			status: remote.status,
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
const { DrivingLicenceCheckPanel } = await import("./check-panel");
afterEach(() => {
	cleanup();
	remote.status = "ended";
});
function renderPanel(canVerify: boolean) {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	render(
		<QueryClientProvider client={client}>
			<DrivingLicenceCheckPanel employeeId="former" name="Anna Driver" canVerify={canVerify} />
		</QueryClientProvider>,
	);
}
it("opens a former employee's ended evidence without offering a new check or reinstatement", async () => {
	renderPanel(false);
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

it("offers no check for an employee who is not an intended driver (#1429)", async () => {
	remote.status = "not_enrolled";
	renderPanel(true);
	expect(
		await screen.findByText(
			"Anna Driver is not an intended driver. A check is needed only for intended drivers.",
		),
	).toBeTruthy();
	expect(screen.queryByRole("heading", { name: /Inspect Anna Driver/ })).toBeNull();
});
