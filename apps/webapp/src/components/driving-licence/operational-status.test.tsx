// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const remote = vi.hoisted(() => ({
	status: vi.fn(),
	employeeList: vi.fn(),
	clockIn: vi.fn(),
	identity: { organizationId: "org-a", userId: "user-a" },
}));
vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({ t: (_key: string, fallback: string) => fallback }),
}));
vi.mock("@/lib/auth-client", () => ({
	useSession: () => ({
		data: {
			user: { id: remote.identity.userId },
			session: { activeOrganizationId: remote.identity.organizationId },
		},
	}),
}));
beforeEach(() =>
	vi.stubGlobal(
		"fetch",
		vi.fn(async (input: string) => {
			const url = new URL(input, "http://localhost");
			if (url.pathname.endsWith("operational-employees"))
				return Response.json(
					await remote.employeeList({
						search: url.searchParams.get("search") ?? "",
					}),
				);
			const employeeId = url.searchParams.get("employeeId");
			return Response.json(
				await remote.status(employeeId ? { employeeId } : {}),
			);
		}),
	),
);
vi.mock("@/components/time-tracking/use-clock-in-out-widget", () => ({
	useClockInOutWidget: () => ({
		t: (_key: string, fallback: string) => fallback,
		isClockedIn: false,
		isMutating: false,
		isClockingOut: false,
		captureMode: "server",
		connectionRequired: false,
		canClockIn: true,
		alerts: [],
		approvedExceptions: [],
		handleClockIn: remote.clockIn,
		uiState: {
			showNotesInput: false,
			workLocationType: "office",
			exceptionDialogOpen: false,
		},
		vehicleUse: { mode: "off", asks: false, context: null },
	}),
}));
vi.mock("@/components/compliance/exception-request-dialog", () => ({
	ExceptionRequestDialog: () => null,
}));
vi.mock("@/components/time-tracking/session-reminder-panel", () => ({
	SessionReminderPanel: () => null,
}));
vi.mock("@/components/time-tracking/clock-vehicle-use", async () =>
	(
		await import("../time-tracking/clock-vehicle-use.test-stub")
	).vehicleUseOffModule(),
);

import { ClockInOutWidget } from "../time-tracking/clock-in-out-widget";
import {
	DrivingAuthorizationAdvisory,
	OperationalDrivingStatusPanel,
} from "./operational-status";

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
	vi.unstubAllGlobals();
	remote.identity = { organizationId: "org-a", userId: "user-a" };
});
function client() {
	return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}
it("keeps the real clock button usable while status is pending, suspended or failed", async () => {
	let resolveStatus: (value: unknown) => void = () => {};
	remote.status.mockImplementationOnce(
		() =>
			new Promise((resolve) => {
				resolveStatus = resolve;
			}),
	);
	const queryClient = client();
	render(
		<QueryClientProvider client={queryClient}>
			<ClockInOutWidget
				activeWorkPeriod={null}
				employeeName="Driver"
				timeFormat="24h"
			/>
		</QueryClientProvider>,
	);
	expect(
		await screen.findByText("Loading driving authorization…"),
	).toBeTruthy();
	fireEvent.click(screen.getByRole("button", { name: "Clock In" }));
	expect(remote.clockIn).toHaveBeenCalledTimes(1);
	resolveStatus({
		success: true,
		data: {
			employeeId: "driver",
			status: "suspended",
			authorizedClasses: [],
			classes: [{ code: "B", status: "suspended", restrictions: "Code 01" }],
		},
	});
	expect(
		await screen.findByText("Driving authorization suspended"),
	).toBeTruthy();
	expect(screen.getByText("Code 01")).toBeTruthy();
	expect(
		screen.getByRole("button", { name: "Clock In" }).hasAttribute("disabled"),
	).toBe(false);
	remote.status.mockRejectedValueOnce(new Error("Offline"));
	fireEvent.click(
		screen.getByRole("button", { name: "Refresh driving status" }),
	);
	expect(
		await screen.findByText("Driving authorization status is unavailable."),
	).toBeTruthy();
	fireEvent.click(screen.getByRole("button", { name: "Clock In" }));
	expect(remote.clockIn).toHaveBeenCalledTimes(2);
});
it("does not reuse another organization or user's cached status", async () => {
	remote.status
		.mockResolvedValueOnce({
			success: true,
			data: {
				employeeId: "a",
				status: "active",
				authorizedClasses: ["B"],
				classes: [],
			},
		})
		.mockResolvedValueOnce({
			success: true,
			data: {
				employeeId: "b",
				status: "not_enrolled",
				authorizedClasses: [],
				classes: [],
			},
		});
	const queryClient = client();
	const view = render(
		<QueryClientProvider client={queryClient}>
			<DrivingAuthorizationAdvisory />
		</QueryClientProvider>,
	);
	expect(await screen.findByText("Driving authorization active")).toBeTruthy();
	remote.identity = { organizationId: "org-b", userId: "user-b" };
	view.rerender(
		<QueryClientProvider client={queryClient}>
			<DrivingAuthorizationAdvisory />
		</QueryClientProvider>,
	);
	expect(
		await screen.findByText("Not enrolled — no driving authorization"),
	).toBeTruthy();
	expect(screen.queryByText("Driving authorization active")).toBeNull();
});
it("lets a planner open only the minimal employee status without inspection controls", async () => {
	remote.employeeList.mockResolvedValue({
		success: true,
		data: [{ employeeId: "driver", name: "Driver One" }],
	});
	remote.status.mockResolvedValue({
		success: true,
		data: {
			employeeId: "driver",
			status: "not_yet_checked",
			authorizedClasses: [],
			classes: [],
		},
	});
	render(
		<QueryClientProvider client={client()}>
			<OperationalDrivingStatusPanel />
		</QueryClientProvider>,
	);
	fireEvent.click(await screen.findByRole("button", { name: "Driver One" }));
	expect(
		await screen.findByText("Not yet checked — no driving authorization"),
	).toBeTruthy();
	expect(
		screen.queryByRole("button", { name: /PDF|Inspect|Declaration/ }),
	).toBeNull();
	await waitFor(() =>
		expect(remote.status).toHaveBeenCalledWith({ employeeId: "driver" }),
	);
});
