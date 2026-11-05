/* @vitest-environment jsdom */
import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { EMPTY_ORGANIZATION_PROFILE } from "@/lib/organization/profile";

const mocks = vi.hoisted(() => ({ prepare: vi.fn(), exportPdf: vi.fn() }));
vi.mock("@/app/[locale]/(app)/settings/avv/actions", () => ({
	prepareAvvDownload: mocks.prepare,
}));
vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({ t: (_key: string, fallback: string) => fallback }),
}));
vi.mock("@/lib/avv/avv-pdf-generator", async (original) => ({
	...(await original<object>()),
	exportAvvToPDF: mocks.exportPdf,
}));

import { AvvDownloadButton } from "./avv-download-button";

const profile = {
	...EMPTY_ORGANIZATION_PROFILE,
	legalCompanyName: "Current Legal Ltd",
	addressLine1: "New Street 2",
	city: "Hong Kong",
	country: "HK",
};
let downloadedFilename: string | null;
beforeEach(() => {
	vi.clearAllMocks();
	downloadedFilename = null;
	vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(
		function () {
			downloadedFilename = this.download;
		},
	);
	vi.stubGlobal("URL", {
		createObjectURL: () => "blob:pdf",
		revokeObjectURL: vi.fn(),
	});
	mocks.prepare.mockResolvedValue({
		success: true,
		data: { ready: true, profile },
	});
	mocks.exportPdf.mockResolvedValue(new Uint8Array([37, 80, 68, 70]));
});
afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

it("downloads a newly prepared PDF with current legal details on every click", async () => {
	render(<AvvDownloadButton organizationId="org-1" missingFields={[]} />);
	fireEvent.click(screen.getByRole("button"));
	await waitFor(() =>
		expect(downloadedFilename).toMatch(/^avv-current-legal-ltd-/),
	);
	expect(mocks.exportPdf).toHaveBeenLastCalledWith(profile);
	mocks.prepare.mockResolvedValue({
		success: true,
		data: {
			ready: true,
			profile: {
				...profile,
				legalCompanyName: "Changed Legal Ltd",
				addressLine1: "Newest Street 3",
			},
		},
	});
	fireEvent.click(screen.getByRole("button"));
	await waitFor(() =>
		expect(downloadedFilename).toMatch(/^avv-changed-legal-ltd-/),
	);
	expect(mocks.exportPdf).toHaveBeenLastCalledWith(
		expect.objectContaining({ addressLine1: "Newest Street 3" }),
	);
});

it("shows newly missing fields from the server and does not generate an incomplete PDF from a stale page", async () => {
	mocks.prepare.mockResolvedValue({
		success: true,
		data: { ready: false, missingFields: ["addressLine1"] },
	});
	render(<AvvDownloadButton organizationId="org-1" missingFields={[]} />);
	fireEvent.click(screen.getByRole("button"));
	await waitFor(() =>
		expect(screen.getByRole("status").textContent).toContain("Address line 1"),
	);
	expect(downloadedFilename).toBeNull();
	expect(mocks.exportPdf).not.toHaveBeenCalled();
});

it.each(["denied", "rejected"])(
	"shows an accessible preparation error when the request is %s",
	async (failure) => {
		if (failure === "denied")
			mocks.prepare.mockResolvedValue({
				success: false,
				code: "AuthorizationError",
			});
		else mocks.prepare.mockRejectedValue(new Error("Network unavailable"));
		render(<AvvDownloadButton organizationId="org-1" missingFields={[]} />);
		fireEvent.click(screen.getByRole("button"));
		await waitFor(() =>
			expect(screen.getByRole("alert").textContent).toContain(
				"Unable to prepare the AVV",
			),
		);
		expect(downloadedFilename).toBeNull();
		expect(screen.getByRole("button").hasAttribute("disabled")).toBe(false);
	},
);

it("prevents duplicate clicks while preparing and generating the document", async () => {
	let finish: (value: unknown) => void = () => {};
	mocks.prepare.mockReturnValue(
		new Promise((resolve) => {
			finish = resolve;
		}),
	);
	render(<AvvDownloadButton organizationId="org-1" missingFields={[]} />);
	fireEvent.click(screen.getByRole("button"));
	expect(
		screen
			.getByRole("button", { name: "Generating PDF…" })
			.hasAttribute("disabled"),
	).toBe(true);
	await act(async () =>
		finish({ success: true, data: { ready: true, profile } }),
	);
	expect(downloadedFilename).toMatch(/^avv-current-legal-ltd-/);
});
