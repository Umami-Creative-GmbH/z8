// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	act,
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
import { queryKeys } from "@/lib/query/keys";
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

it("lets an already started advisory read finish when its panel unmounts", async () => {
	const pending = Promise.withResolvers<Response>();
	let aborts = 0;
	const fetchMock = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
		init?.signal?.addEventListener("abort", () => {
			aborts++;
			pending.reject(new DOMException("Aborted", "AbortError"));
		});
		return pending.promise;
	});
	vi.stubGlobal("fetch", fetchMock);
	const queryClient = client();
	const view = render(
		<QueryClientProvider client={queryClient}>
			<DrivingAuthorizationAdvisory />
		</QueryClientProvider>,
	);
	try {
		await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
		view.unmount();
		expect(aborts).toBe(0);
		const result = { success: true, data: null };
		await act(async () => pending.resolve(Response.json(result)));
		await waitFor(() =>
			expect(queryClient.getQueryData(queryKeys.drivingLicence.statusFor("org-a", "user-a", undefined))).toEqual(result),
		);
		expect(fetchMock).toHaveBeenCalledTimes(1);
	} finally {
		pending.resolve(Response.json({ success: true, data: null }));
		queryClient.clear();
	}
});

it("starts no advisory read before mount or without both identity guards", async () => {
	const fetchMock = vi.fn().mockResolvedValue(Response.json({ success: true, data: null }));
	vi.stubGlobal("fetch", fetchMock);
	const queryClient = client();
	const panel = (shown: boolean) => (
		<QueryClientProvider client={queryClient}>
			{shown ? <DrivingAuthorizationAdvisory /> : null}
		</QueryClientProvider>
	);
	const view = render(panel(false));
	try {
		await act(async () => {});
		expect(fetchMock).not.toHaveBeenCalled();
		remote.identity = { organizationId: "", userId: "user-a" };
		view.rerender(panel(true));
		await act(async () => {});
		expect(fetchMock).not.toHaveBeenCalled();
		remote.identity = { organizationId: "org-a", userId: "" };
		view.rerender(panel(true));
		await act(async () => {});
		expect(fetchMock).not.toHaveBeenCalled();
		remote.identity = { organizationId: "org-a", userId: "user-a" };
		view.rerender(panel(true));
		await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
	} finally {
		view.unmount();
		queryClient.clear();
	}
});

it.each(["organization/user", "employee"])("keeps a finishing read under its own key after %s changes", async (scope) => {
	const pending = Promise.withResolvers<Response>();
	const oldResult = { success: true, data: { employeeId: "a", status: "active", authorizedClasses: ["B"], classes: [] } };
	const newResult = { success: true, data: { employeeId: "b", status: "not_enrolled", authorizedClasses: [], classes: [] } };
	let calls = 0;
	let employeeId = scope === "employee" ? "driver-a" : undefined;
	vi.stubGlobal("fetch", vi.fn(() => ++calls === 1 ? pending.promise : Promise.resolve(Response.json(newResult))));
	const queryClient = client();
	const panel = () => <QueryClientProvider client={queryClient}><DrivingAuthorizationAdvisory employeeId={employeeId} /></QueryClientProvider>;
	const view = render(panel());
	try {
		await waitFor(() => expect(calls).toBe(1));
		if (scope === "employee") employeeId = "driver-b";
		else remote.identity = { organizationId: "org-b", userId: "user-b" };
		view.rerender(panel());
		expect(await screen.findByText("Not an intended driver — no driving authorization")).toBeTruthy();
		await act(async () => pending.resolve(Response.json(oldResult)));
		await waitFor(() => expect(queryClient.getQueryData(queryKeys.drivingLicence.statusFor("org-a", "user-a", scope === "employee" ? "driver-a" : undefined))).toEqual(oldResult));
		expect(queryClient.getQueryData(queryKeys.drivingLicence.statusFor(remote.identity.organizationId, remote.identity.userId, employeeId))).toEqual(newResult);
		expect(screen.queryByText("Driving authorization active")).toBeNull();
		expect(calls).toBe(2);
	} finally {
		pending.resolve(Response.json(oldResult));
		view.unmount();
		queryClient.clear();
	}
});

it("does not let a replaced refetch overwrite a newer advisory result", async () => {
	const oldRead = Promise.withResolvers<Response>();
	const newRead = Promise.withResolvers<Response>();
	const active = { success: true, data: { employeeId: "a", status: "active", authorizedClasses: ["B"], classes: [] } };
	const latest = { success: true, data: { employeeId: "a", status: "not_enrolled", authorizedClasses: [], classes: [] } };
	let calls = 0;
	vi.stubGlobal("fetch", vi.fn(() => ++calls === 1 ? Promise.resolve(Response.json(active)) : calls === 2 ? oldRead.promise : newRead.promise));
	const queryClient = client();
	const view = render(<QueryClientProvider client={queryClient}><DrivingAuthorizationAdvisory /></QueryClientProvider>);
	try {
		expect(await screen.findByText("Driving authorization active")).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Refresh driving status" }));
		await waitFor(() => expect(calls).toBe(2));
		await act(async () => {
			const replacement = queryClient.refetchQueries({ queryKey: queryKeys.drivingLicence.statusFor("org-a", "user-a", undefined), exact: true }, { cancelRefetch: true });
			expect(calls).toBe(3);
			newRead.resolve(Response.json(latest));
			await replacement;
		});
		expect(await screen.findByText("Not an intended driver — no driving authorization")).toBeTruthy();
		await act(async () => oldRead.resolve(Response.json(active)));
		expect(queryClient.getQueryData(queryKeys.drivingLicence.statusFor("org-a", "user-a", undefined))).toEqual(latest);
		expect(screen.queryByText("Driving authorization active")).toBeNull();
		expect(calls).toBe(3);
	} finally {
		oldRead.resolve(Response.json(active));
		newRead.resolve(Response.json(latest));
		view.unmount();
		queryClient.clear();
	}
});
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
	// #1420: nothing shows until the server says the advisory applies to this member.
	await waitFor(() => expect(remote.status).toHaveBeenCalled());
	expect(
		screen.queryByRole("complementary", { name: "Driving authorization" }),
	).toBeNull();
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
it("shows no clock advisory while the feature is off or the member is not an intended driver (#1420)", async () => {
	remote.status.mockResolvedValue({ success: true, data: null });
	render(
		<QueryClientProvider client={client()}>
			<ClockInOutWidget activeWorkPeriod={null} employeeName="Office worker" timeFormat="24h" />
		</QueryClientProvider>,
	);
	await waitFor(() => expect(remote.status).toHaveBeenCalledWith({}));
	await waitFor(() =>
		expect(screen.queryByRole("complementary", { name: "Driving authorization" })).toBeNull(),
	);
	expect(screen.queryByText("Not an intended driver — no driving authorization")).toBeNull();
	expect(screen.queryByText("Loading driving authorization…")).toBeNull();
	expect(screen.getByRole("button", { name: "Clock In" })).toBeTruthy();
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
		await screen.findByText("Not an intended driver — no driving authorization"),
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
