/* @vitest-environment jsdom */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
	createAuditPackActionMock,
	getAuditPackDownloadUrlActionMock,
	getAuditPackRequestsActionMock,
} = vi.hoisted(() => ({
	createAuditPackActionMock: vi.fn(),
	getAuditPackDownloadUrlActionMock: vi.fn(),
	getAuditPackRequestsActionMock: vi.fn(),
}));

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (
			_key: string,
			defaultValue?: string,
			params?: Record<string, string | number>,
		) =>
			(defaultValue ?? _key).replace(/\{(\w+)\}/g, (match, name: string) =>
				params && name in params ? String(params[name]) : match,
			),
	}),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/app/[locale]/(app)/settings/audit-export/actions", () => ({
	createAuditPackAction: createAuditPackActionMock,
	getAuditPackDownloadUrlAction: getAuditPackDownloadUrlActionMock,
	getAuditPackRequestsAction: getAuditPackRequestsActionMock,
}));
vi.mock("@/lib/queue/use-job-status", () => ({
	useJobStatus: () => ({ status: null }),
}));
vi.mock("@/hooks/use-display-context", () => ({
	useDisplayContext: () => ({
		locale: "en-US",
		timezone: "UTC",
		timeFormat: "24h",
	}),
}));
vi.mock("@/components/ui/date-picker", () => ({
	DatePicker: ({ value }: { value: string }) => (
		<input readOnly value={value} />
	),
}));

import { AuditPackGeneratorCard } from "./audit-pack-generator-card";

const completedRequest = {
	id: "request-1",
	status: "completed",
	startDate: "2026-06-01T00:00:00.000Z",
	endDate: "2026-06-30T23:59:59.999Z",
	errorCode: null,
	errorMessage: null,
	createdAt: "2026-07-01T10:00:00.000Z",
	completedAt: "2026-07-01T10:01:00.000Z",
	artifact: { entryCount: 3 },
};

describe("AuditPackGeneratorCard", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		getAuditPackRequestsActionMock.mockResolvedValue({
			success: true,
			data: [completedRequest],
		});
	});

	it("clears request loading and reports a rejected request load", async () => {
		const error = new Error("Network failed");
		getAuditPackRequestsActionMock.mockRejectedValue(error);
		vi.spyOn(console, "error").mockImplementation(() => undefined);

		render(
			<AuditPackGeneratorCard
				organizationId="org-1"
				organizationTimezone="Europe/Berlin"
			/>,
		);

		await waitFor(() =>
			expect(toast.error).toHaveBeenCalledWith("An unexpected error occurred"),
		);
		expect(screen.queryByText("Loading requests...")).toBeNull();
		expect(console.error).toHaveBeenCalledWith(
			"Load audit pack requests error:",
			error,
		);
	});

	it("opens a completed pack without retaining opener access and clears download loading", async () => {
		getAuditPackDownloadUrlActionMock.mockResolvedValue({
			success: true,
			data: { url: "https://storage.example.test/audit-pack" },
		});
		const openedWindow = { opener: window };
		const openSpy = vi
			.spyOn(window, "open")
			.mockReturnValue(openedWindow as unknown as Window);

		render(
			<AuditPackGeneratorCard
				organizationId="org-1"
				organizationTimezone="Europe/Berlin"
			/>,
		);
		const downloadButton = await screen.findByRole("button", {
			name: "Download",
		});
		fireEvent.click(downloadButton);

		await waitFor(() =>
			expect(toast.success).toHaveBeenCalledWith("Download started"),
		);
		expect(getAuditPackDownloadUrlActionMock).toHaveBeenCalledWith(
			"request-1",
			"org-1",
		);
		expect(openSpy).toHaveBeenCalledWith(
			"https://storage.example.test/audit-pack",
			"_blank",
		);
		expect(openedWindow.opener).toBeNull();
		expect(downloadButton).toHaveProperty("disabled", false);
	});

	it("discards request loads from the previous organization", async () => {
		let resolveOrgOne: ((value: unknown) => void) | undefined;
		getAuditPackRequestsActionMock
			.mockImplementationOnce(
				() =>
					new Promise((resolve) => {
						resolveOrgOne = resolve;
					}),
			)
			.mockResolvedValueOnce({
				success: true,
				data: [
					{
						...completedRequest,
						id: "request-org-2",
						artifact: { entryCount: 8 },
					},
				],
			});
		const { rerender } = render(
			<AuditPackGeneratorCard
				organizationId="org-1"
				organizationTimezone="Europe/Berlin"
			/>,
		);

		rerender(
			<AuditPackGeneratorCard
				organizationId="org-2"
				organizationTimezone="America/New_York"
			/>,
		);
		await screen.findByText("8");
		resolveOrgOne?.({ success: true, data: [completedRequest] });

		await waitFor(() =>
			expect(getAuditPackRequestsActionMock).toHaveBeenCalledWith("org-2", 10),
		);
		expect(screen.queryByText("3")).toBeNull();
	});

	it("displays request timestamps in the organization timezone", async () => {
		render(
			<AuditPackGeneratorCard
				organizationId="org-1"
				organizationTimezone="Pacific/Kiritimati"
			/>,
		);

		expect(await screen.findByText(/Jul 2, 2026/)).toBeTruthy();
	});

	it.each([
		[
			"discloses limited lineage assurance for some employees",
			{ employeeCount: 3, wholeHistory: 1, none: 2, limitations: [] },
			"Limited lineage assurance for 2 of 3 employees. See append-assurance.json in the pack.",
		],
		[
			"discloses continuity from an approved anchor without claiming verified history",
			{ employeeCount: 3, wholeHistory: 2, postAnchor: 1, none: 0, limitations: [] },
			"Continuity from an approved anchor for 1 of 3 employees; history before the anchor is not verified. See append-assurance.json in the pack.",
		],
		[
			"states verified lineage only when every employee has whole-history assurance",
			{ employeeCount: 2, wholeHistory: 2, none: 0, limitations: [] },
			"Lineage verified from stored evidence for 2 employees. Its limitations are listed in append-assurance.json.",
		],
		["marks packs generated before the disclosure", null, "Lineage assurance not recorded"],
	])("%s", async (_name, appendAssurance, text) => {
		getAuditPackRequestsActionMock.mockResolvedValue({
			success: true,
			data: [{ ...completedRequest, artifact: { entryCount: 3, appendAssurance } }],
		});

		render(
			<AuditPackGeneratorCard
				organizationId="org-1"
				organizationTimezone="Europe/Berlin"
			/>,
		);

		expect(await screen.findByText(text)).toBeTruthy();
	});
});
