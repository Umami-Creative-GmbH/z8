/* @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OwnKioskFobCard } from "./own-kiosk-fob-card";

const actions = vi.hoisted(() => ({
	getOwnKioskFobStatusAction: vi.fn(),
	removeOwnKioskFobAction: vi.fn(),
}));
const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, defaultValue?: string, values?: Record<string, string>) =>
			(defaultValue ?? _key).replace(/\{(\w+)\}/g, (_, name: string) => values?.[name] ?? ""),
	}),
	useTolgee: () => ({ getLanguage: () => "en" }),
}));
vi.mock("sonner", () => ({ toast: toastMock }));
vi.mock("@/app/[locale]/(app)/settings/security/kiosk-fob-actions", () => actions);

const fobId = "e1508000-0000-4000-8000-0000000000f1";
const ownFob = {
	fob: {
		fobId,
		registeredAt: "2026-11-01T23:30:00Z",
		lastFour: "E5F6",
		kioskName: "Store kiosk",
	},
	fobReaderInUse: true,
	timezone: "Europe/Berlin",
};

function renderCard() {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
	});
	return render(
		<QueryClientProvider client={client}>
			<OwnKioskFobCard />
		</QueryClientProvider>,
	);
}

describe("OwnKioskFobCard (#1508)", () => {
	beforeEach(() => vi.clearAllMocks());
	afterEach(cleanup);

	it("renders nothing for a user without an employee profile here", async () => {
		actions.getOwnKioskFobStatusAction.mockResolvedValue({ success: true, data: null });
		const { container } = renderCard();

		await waitFor(() => expect(actions.getOwnKioskFobStatusAction).toHaveBeenCalled());
		expect(container.textContent).toBe("");
	});

	it("renders nothing without a fob where no kiosk reads fobs", async () => {
		actions.getOwnKioskFobStatusAction.mockResolvedValue({
			success: true,
			data: { fob: null, fobReaderInUse: false, timezone: "Europe/Berlin" },
		});
		const { container } = renderCard();

		await waitFor(() => expect(actions.getOwnKioskFobStatusAction).toHaveBeenCalled());
		expect(container.textContent).toBe("");
	});

	it("explains how to register a fob at a kiosk when there is none", async () => {
		actions.getOwnKioskFobStatusAction.mockResolvedValue({
			success: true,
			data: { fob: null, fobReaderInUse: true, timezone: "Europe/Berlin" },
		});
		renderCard();

		expect(await screen.findByText("Kiosk fob")).toBeTruthy();
		expect(
			screen.getByText(
				"No fob registered. To register one, tap it on a kiosk's fob reader and confirm with your kiosk PIN.",
			),
		).toBeTruthy();
		expect(screen.queryByRole("button", { name: "Remove fob" })).toBeNull();
	});

	it("shows the own fob and removes it after confirming", async () => {
		actions.getOwnKioskFobStatusAction.mockResolvedValue({ success: true, data: ownFob });
		actions.removeOwnKioskFobAction.mockResolvedValue({ success: true, data: { removed: true } });
		renderCard();

		expect(
			await screen.findByText("Fob ending in E5F6, registered on Nov 2, 2026 at Store kiosk."),
		).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Remove fob" }));
		expect(
			screen.getByText(
				"If you lost it, remove it: it stops working at kiosks at once. Your kiosk PIN keeps working.",
			),
		).toBeTruthy();
		expect(actions.removeOwnKioskFobAction).not.toHaveBeenCalled();
		fireEvent.click(screen.getByRole("button", { name: "Remove the fob" }));

		await waitFor(() => expect(actions.removeOwnKioskFobAction).toHaveBeenCalledWith(fobId));
		await waitFor(() => expect(toastMock.success).toHaveBeenCalledWith("Kiosk fob removed"));
		await waitFor(() => expect(actions.getOwnKioskFobStatusAction).toHaveBeenCalledTimes(2));
	});

	it("reports a refused removal", async () => {
		actions.getOwnKioskFobStatusAction.mockResolvedValue({ success: true, data: ownFob });
		actions.removeOwnKioskFobAction.mockResolvedValue({
			success: false,
			error: "none",
			code: "no_fob",
		});
		renderCard();

		fireEvent.click(await screen.findByRole("button", { name: "Remove fob" }));
		fireEvent.click(screen.getByRole("button", { name: "Remove the fob" }));

		await waitFor(() =>
			expect(toastMock.error).toHaveBeenCalledWith("There is no kiosk fob to remove."),
		);
	});
});
