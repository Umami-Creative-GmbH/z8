/* @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EmployeeKioskCard } from "./employee-kiosk-card";

const actions = vi.hoisted(() => ({
	getEmployeeKioskStateAction: vi.fn(),
	issueEmployeeKioskPinAction: vi.fn(),
	resetEmployeeKioskPinAction: vi.fn(),
	unlockEmployeeKioskPinAction: vi.fn(),
	addKioskOnlyEmployeeEmailAction: vi.fn(),
	issueEmployeeKioskBadgeAction: vi.fn(),
	replaceEmployeeKioskBadgeAction: vi.fn(),
	revokeEmployeeKioskBadgeAction: vi.fn(),
	removeEmployeeKioskFobAction: vi.fn(),
}));
const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn() }));

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, defaultValue?: string, values?: Record<string, string>) =>
			(defaultValue ?? _key).replace(/\{(\w+)\}/g, (_, name: string) => values?.[name] ?? ""),
	}),
	useTolgee: () => ({ getLanguage: () => "en" }),
}));
vi.mock("sonner", () => ({ toast: toastMock }));
vi.mock("@/app/[locale]/(app)/settings/employees/kiosk-actions", () => actions);

const employeeId = "e1508000-0000-4000-8000-000000000005";
const fobId = "e1508000-0000-4000-8000-0000000000f1";
const activeFob = {
	active: {
		fobId,
		// 00:30 in Berlin on 2 November: the organization's day, not UTC's 1 November.
		registeredAt: "2026-11-01T23:30:00Z",
		lastFour: "E5F6",
		kioskName: "Store kiosk",
	},
	lastEnded: null,
	fobReaderInUse: false,
	timezone: "Europe/Berlin",
};
const noFob = { active: null, lastEnded: null, fobReaderInUse: true, timezone: "Europe/Berlin" };
const state = (fob: unknown) => ({
	success: true,
	data: {
		canManagePin: true,
		hasPin: true,
		lockedUntil: null,
		kioskOnly: false,
		canAddEmail: false,
		badge: null,
		fob,
	},
});

function renderCard() {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
	});
	return render(
		<QueryClientProvider client={client}>
			<EmployeeKioskCard employeeId={employeeId} />
		</QueryClientProvider>,
	);
}

describe("Kiosk fob on the employee page (#1508)", () => {
	beforeEach(() => vi.clearAllMocks());
	afterEach(cleanup);

	it("shows the registration date in the organization's zone, the kiosk and the last 4 hex digits", async () => {
		actions.getEmployeeKioskStateAction.mockResolvedValue(state(activeFob));
		renderCard();

		expect(
			await screen.findByText("Fob ending in E5F6, registered on Nov 2, 2026 at Store kiosk."),
		).toBeTruthy();
	});

	it("says when the registering kiosk no longer exists", async () => {
		actions.getEmployeeKioskStateAction.mockResolvedValue(
			state({ ...activeFob, active: { ...activeFob.active, kioskName: null } }),
		);
		renderCard();

		expect(
			await screen.findByText(
				"Fob ending in E5F6, registered on Nov 2, 2026 at a kiosk that no longer exists.",
			),
		).toBeTruthy();
	});

	it("removes the fob after confirming, naming the fob shown", async () => {
		actions.getEmployeeKioskStateAction.mockResolvedValue(state(activeFob));
		actions.removeEmployeeKioskFobAction.mockResolvedValue({
			success: true,
			data: { removed: true },
		});
		renderCard();

		fireEvent.click(await screen.findByRole("button", { name: "Remove fob" }));
		expect(
			screen.getByText(
				"The fob stops working at kiosks at once and can be registered again. The employee's kiosk PIN and kiosk badge keep working.",
			),
		).toBeTruthy();
		expect(actions.removeEmployeeKioskFobAction).not.toHaveBeenCalled();
		fireEvent.click(screen.getByRole("button", { name: "Remove the fob" }));

		await waitFor(() =>
			expect(actions.removeEmployeeKioskFobAction).toHaveBeenCalledWith(employeeId, fobId),
		);
		await waitFor(() => expect(toastMock.success).toHaveBeenCalledWith("Kiosk fob removed"));
		await waitFor(() => expect(actions.getEmployeeKioskStateAction).toHaveBeenCalledTimes(2));
	});

	it("tells the manager when the fob changed meanwhile and shows what is true now", async () => {
		actions.getEmployeeKioskStateAction.mockResolvedValue(state(activeFob));
		actions.removeEmployeeKioskFobAction.mockResolvedValue({
			success: false,
			error: "changed",
			code: "fob_changed",
		});
		renderCard();

		fireEvent.click(await screen.findByRole("button", { name: "Remove fob" }));
		fireEvent.click(screen.getByRole("button", { name: "Remove the fob" }));

		await waitFor(() =>
			expect(toastMock.error).toHaveBeenCalledWith(
				"This kiosk fob changed in the meantime. Check its status and try again.",
			),
		);
		await waitFor(() => expect(actions.getEmployeeKioskStateAction).toHaveBeenCalledTimes(2));
	});

	it("explains how a fob is registered when there is none, with no remove button", async () => {
		actions.getEmployeeKioskStateAction.mockResolvedValue(state(noFob));
		renderCard();

		expect(
			await screen.findByText(
				"No kiosk fob. Employees register their own at a kiosk with an NFC fob reader, using their kiosk PIN.",
			),
		).toBeTruthy();
		expect(screen.queryByRole("button", { name: "Remove fob" })).toBeNull();
	});

	it("is hidden without a fob, a last one or any kiosk reading fobs", async () => {
		actions.getEmployeeKioskStateAction.mockResolvedValue(
			state({ ...noFob, fobReaderInUse: false }),
		);
		renderCard();

		await screen.findByText("Kiosk access");
		expect(screen.queryByText("Kiosk fob")).toBeNull();
	});

	it("says how the last fob ended", async () => {
		actions.getEmployeeKioskStateAction.mockResolvedValue(
			state({
				...noFob,
				// The last fob is shown even once no kiosk reads fobs any more.
				fobReaderInUse: false,
				lastEnded: { at: "2026-11-01T23:30:00Z", reason: "removed", departureLastWorkingDay: null },
			}),
		);
		renderCard();
		expect(await screen.findByText("The last one was removed on Nov 2, 2026.")).toBeTruthy();

		cleanup();
		actions.getEmployeeKioskStateAction.mockResolvedValue(
			state({
				...noFob,
				lastEnded: {
					at: "2026-10-31T23:00:00Z",
					reason: "departure",
					departureLastWorkingDay: "2026-10-31",
				},
			}),
		);
		renderCard();
		expect(
			await screen.findByText("The last one ended with the employee's departure on Oct 31, 2026."),
		).toBeTruthy();
	});

	it("is hidden from viewers who may not manage the employee's kiosk access", async () => {
		actions.getEmployeeKioskStateAction.mockResolvedValue(state(null));
		renderCard();

		await screen.findByText("Kiosk access");
		expect(screen.queryByText("Kiosk fob")).toBeNull();
	});
});
