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
}));
const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn() }));
const ui = vi.hoisted(() => ({ language: "en" }));

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, defaultValue?: string, values?: Record<string, string>) =>
			(defaultValue ?? _key).replace(/\{(\w+)\}/g, (_, name: string) => values?.[name] ?? ""),
	}),
	useTolgee: () => ({ getLanguage: () => ui.language }),
}));
vi.mock("sonner", () => ({ toast: toastMock }));
vi.mock("@/app/[locale]/(app)/settings/employees/kiosk-actions", () => actions);

const employeeId = "d1364000-0000-4000-8000-000000000005";
const noBadge = {
	activeBadgeId: null as string | null,
	activeIssuedAt: null as string | null,
	lastRevokedAt: null as string | null,
	lastRevokedReason: null as string | null,
	departureLastWorkingDay: null as string | null,
	timezone: "Europe/Berlin",
	canIssue: true,
};
const badgeId = "e1364000-0000-4000-8000-000000000001";
const activeBadge = { ...noBadge, activeBadgeId: badgeId, activeIssuedAt: "2026-10-17T08:00:00Z" };
const state = (badge: typeof noBadge | null) => ({
	success: true,
	data: {
		canManagePin: true,
		hasPin: true,
		lockedUntil: null,
		kioskOnly: false,
		canAddEmail: false,
		badge,
	},
});
const issuedPdf = {
	success: true,
	data: { filename: "kiosk-badge-ada.pdf", pdf: Buffer.from("%PDF-1.3 badge").toString("base64") },
};

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

describe("Kiosk badge on the employee page (#1364)", () => {
	const createObjectURL = vi.fn(() => "blob:badge-pdf");
	const revokeObjectURL = vi.fn();

	beforeEach(() => {
		vi.clearAllMocks();
		ui.language = "en";
		Object.assign(URL, { createObjectURL, revokeObjectURL });
	});
	afterEach(cleanup);

	it("issues a badge and offers its PDF only until the issuer is done", async () => {
		actions.getEmployeeKioskStateAction.mockResolvedValue(state(noBadge));
		actions.issueEmployeeKioskBadgeAction.mockResolvedValue(issuedPdf);
		renderCard();

		expect(await screen.findByText("No kiosk badge yet.")).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Issue badge" }));

		const download = await screen.findByRole("link", { name: "Download PDF" });
		expect(actions.issueEmployeeKioskBadgeAction).toHaveBeenCalledWith(employeeId);
		expect(download.getAttribute("href")).toBe("blob:badge-pdf");
		expect(download.getAttribute("download")).toBe("kiosk-badge-ada.pdf");
		expect(screen.getByRole("link", { name: "Open to print" }).getAttribute("href")).toBe(
			"blob:badge-pdf",
		);
		expect(
			screen.getByText(
				"Save the PDF now: Z8 cannot show this badge again. You can reprint a saved copy. If the file or the badge is lost, replace the badge.",
			),
		).toBeTruthy();
		const blob = (createObjectURL.mock.calls[0] as unknown as [Blob])[0];
		expect(blob.type).toBe("application/pdf");
		expect(await blob.text()).toBe("%PDF-1.3 badge");
		await waitFor(() => expect(actions.getEmployeeKioskStateAction).toHaveBeenCalledTimes(2));

		fireEvent.click(screen.getByRole("button", { name: "Done" }));

		expect(screen.queryByRole("link", { name: "Download PDF" })).toBeNull();
		expect(revokeObjectURL).toHaveBeenCalledWith("blob:badge-pdf");
	});

	it("replaces a badge only after confirming that every old copy stops working", async () => {
		actions.getEmployeeKioskStateAction.mockResolvedValue(state(activeBadge));
		actions.replaceEmployeeKioskBadgeAction.mockResolvedValue(issuedPdf);
		renderCard();

		fireEvent.click(await screen.findByRole("button", { name: "Replace badge" }));
		expect(
			screen.getByText(
				"Replacing creates a new badge. Every copy of the current badge stops working at once.",
			),
		).toBeTruthy();
		expect(actions.replaceEmployeeKioskBadgeAction).not.toHaveBeenCalled();
		fireEvent.click(screen.getByRole("button", { name: "Replace the badge" }));

		expect(await screen.findByRole("link", { name: "Download PDF" })).toBeTruthy();
		expect(actions.replaceEmployeeKioskBadgeAction).toHaveBeenCalledWith(employeeId, badgeId);
	});

	it("revokes a badge after confirmation and keeps the PIN", async () => {
		actions.getEmployeeKioskStateAction.mockResolvedValue(state(activeBadge));
		actions.revokeEmployeeKioskBadgeAction.mockResolvedValue({
			success: true,
			data: { revoked: true },
		});
		renderCard();

		fireEvent.click(await screen.findByRole("button", { name: "Revoke badge" }));
		expect(
			screen.getByText(
				"Every copy of this badge stops working for good. The employee's kiosk PIN keeps working.",
			),
		).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Revoke the badge" }));

		await waitFor(() =>
			expect(actions.revokeEmployeeKioskBadgeAction).toHaveBeenCalledWith(employeeId, badgeId),
		);
		await waitFor(() => expect(toastMock.success).toHaveBeenCalledWith("Kiosk badge revoked"));
		expect(screen.queryByRole("link", { name: "Download PDF" })).toBeNull();
	});

	it("explains a revoked badge and offers a new one", async () => {
		actions.getEmployeeKioskStateAction.mockResolvedValue(
			state({ ...noBadge, lastRevokedAt: "2026-10-16T08:00:00Z", lastRevokedReason: "revoked" }),
		);
		renderCard();

		expect(
			await screen.findByText(/No active kiosk badge\. The last one was revoked on/),
		).toBeTruthy();
		expect(screen.getByRole("button", { name: "Issue badge" })).toBeTruthy();
		expect(screen.queryByRole("button", { name: "Revoke badge" })).toBeNull();
	});

	it("explains that a departure ended the badge and offers no new one until the employee is active again (#1365)", async () => {
		const ended = {
			...noBadge,
			lastRevokedAt: "2026-09-30T22:00:00Z",
			lastRevokedReason: "employee_departure",
			canIssue: false,
		};
		actions.getEmployeeKioskStateAction.mockResolvedValue(state(ended));
		renderCard();

		expect(
			await screen.findByText(
				/The last one ended with the employee's departure on .+\. Old copies never work again, not even after a rehire\./,
			),
		).toBeTruthy();
		expect(
			screen.getByText(
				"A new badge can be issued only while the employee is active. After a rehire, issue a new badge.",
			),
		).toBeTruthy();
		expect(screen.queryByRole("button", { name: "Issue badge" })).toBeNull();
		cleanup();

		// Rehired: the old badge stays ended, a new one can be issued.
		actions.getEmployeeKioskStateAction.mockResolvedValue(state({ ...ended, canIssue: true }));
		renderCard();
		expect(await screen.findByRole("button", { name: "Issue badge" })).toBeTruthy();
		expect(screen.getByText(/Old copies never work again, not even after a rehire\./)).toBeTruthy();
	});

	it.each([
		["en", "Sep 30, 2026"],
		["de", "30.09.2026"],
	])("dates a departure by the last working day in the %s UI language, not the cutoff after it", async (language, day) => {
		ui.language = language;
		actions.getEmployeeKioskStateAction.mockResolvedValue(
			state({
				...noBadge,
				// The cutoff is midnight after 30 September in Berlin.
				lastRevokedAt: "2026-09-30T22:00:00Z",
				lastRevokedReason: "employee_departure",
				departureLastWorkingDay: "2026-09-30",
				canIssue: false,
			}),
		);
		renderCard();

		expect(
			await screen.findByText(new RegExp(`employee's departure on ${day}\\.`)),
		).toBeTruthy();
	});

	it("dates other badge events in the organization's zone, not the viewer's", async () => {
		actions.getEmployeeKioskStateAction.mockResolvedValue(
			state({
				...noBadge,
				// 23:30 on 15 October in UTC, already 16 October in Berlin.
				lastRevokedAt: "2026-10-15T23:30:00Z",
				lastRevokedReason: "revoked",
			}),
		);
		renderCard();

		expect(await screen.findByText(/The last one was revoked on Oct 16, 2026\./)).toBeTruthy();
	});

	it("refuses to change a badge someone else changed meanwhile and shows its current state", async () => {
		actions.getEmployeeKioskStateAction.mockResolvedValue(state(activeBadge));
		actions.revokeEmployeeKioskBadgeAction.mockResolvedValue({
			success: false,
			error: "changed",
			code: "badge_changed",
		});
		renderCard();

		fireEvent.click(await screen.findByRole("button", { name: "Revoke badge" }));
		fireEvent.click(screen.getByRole("button", { name: "Revoke the badge" }));

		await waitFor(() =>
			expect(toastMock.error).toHaveBeenCalledWith(
				"Someone else changed this kiosk badge in the meantime. Check its status and try again.",
			),
		);
		await waitFor(() => expect(actions.getEmployeeKioskStateAction).toHaveBeenCalledTimes(2));
		expect(toastMock.success).not.toHaveBeenCalled();
	});

	it("offers only revocation for an active badge of an employee who cannot receive a new one", async () => {
		actions.getEmployeeKioskStateAction.mockResolvedValue(
			state({ ...activeBadge, canIssue: false }),
		);
		renderCard();

		expect(await screen.findByRole("button", { name: "Revoke badge" })).toBeTruthy();
		expect(screen.queryByRole("button", { name: "Replace badge" })).toBeNull();
	});

	it("shows a refusal without a PDF", async () => {
		actions.getEmployeeKioskStateAction.mockResolvedValue(state(noBadge));
		actions.issueEmployeeKioskBadgeAction.mockResolvedValue({
			success: false,
			error: "inactive",
			code: "employee_inactive",
		});
		renderCard();

		fireEvent.click(await screen.findByRole("button", { name: "Issue badge" }));

		await waitFor(() =>
			expect(toastMock.error).toHaveBeenCalledWith(
				"Only active employees can receive a kiosk badge.",
			),
		);
		expect(screen.queryByRole("link", { name: "Download PDF" })).toBeNull();
		expect(createObjectURL).not.toHaveBeenCalled();
	});

	it("shows no badge section to a viewer the state gives no badge to", async () => {
		actions.getEmployeeKioskStateAction.mockResolvedValue(state(null));
		renderCard();

		expect(await screen.findByText("Kiosk PIN")).toBeTruthy();
		expect(screen.queryByText("Kiosk badge")).toBeNull();
	});
});
