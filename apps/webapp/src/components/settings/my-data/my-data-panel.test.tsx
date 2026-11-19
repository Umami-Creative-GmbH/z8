/* @vitest-environment jsdom */
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MyDataPanel } from "./my-data-panel";

const mocks = vi.hoisted(() => ({
	request: vi.fn(),
	download: vi.fn(),
	refresh: vi.fn(),
	error: vi.fn(),
	success: vi.fn(),
}));
vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({ t: (_key: string, fallback: string) => fallback }),
}));
vi.mock("next/navigation", () => ({
	useRouter: () => ({ refresh: mocks.refresh }),
}));
vi.mock("sonner", () => ({
	toast: { error: mocks.error, success: mocks.success },
}));
vi.mock("@/hooks/use-display-context", () => ({
	useDisplayContext: () => ({
		locale: "en",
		timezone: "UTC",
		timeFormat: "24h",
	}),
}));
vi.mock("@/app/[locale]/(app)/settings/my-data/actions", () => ({
	requestMyPersonalDataExport: mocks.request,
	getPersonalDataExportDownloadUrl: mocks.download,
}));

describe("personal data export transport failures", () => {
	beforeEach(() => vi.clearAllMocks());
	afterEach(cleanup);
	it("describes retained equipment and requests it through the existing export action", async () => {
		mocks.request.mockResolvedValue({
			success: true,
			data: { exportId: "equipment-export" },
		});
		render(<MyDataPanel exports={[]} />);
		expect(
			screen.getByText(/Includes retained equipment assignments/),
		).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Request export" }));
		await waitFor(() => expect(mocks.refresh).toHaveBeenCalled());
		expect(mocks.request).toHaveBeenCalledWith();
		expect(mocks.success).toHaveBeenCalled();
	});
	it("says when no export has been requested yet", () => {
		render(<MyDataPanel exports={[]} />);
		expect(screen.getByText(/You have not requested an export yet/)).toBeTruthy();
	});
	it("explains why a new export cannot be requested while one is being prepared", () => {
		render(
			<MyDataPanel
				exports={[
					{
						id: "export-1",
						kind: "employee",
						status: "processing",
						createdAt: "2026-10-01T08:00:00Z",
						completedAt: null,
						expiresAt: "2026-10-08T08:05:00Z",
						sizeBytes: null,
					},
				]}
			/>,
		);
		const button = screen.getByRole("button", { name: "Request export" });
		expect(button.hasAttribute("disabled")).toBe(true);
		expect(button.getAttribute("aria-describedby")).toBe("my-data-export-in-progress");
		expect(screen.getByText(/already being prepared/)).toBeTruthy();
	});
	it("reports a rejected export request and enables retry", async () => {
		mocks.request.mockRejectedValue(new Error("offline"));
		render(<MyDataPanel exports={[]} />);
		const button = screen.getByRole("button", { name: "Request export" });
		fireEvent.click(button);
		await waitFor(() =>
			expect(mocks.error).toHaveBeenCalledWith(
				"Your export could not be started. Please try again.",
			),
		);
		expect(button.hasAttribute("disabled")).toBe(false);
		expect(mocks.refresh).not.toHaveBeenCalled();
	});
	it("reports a rejected download and enables retry", async () => {
		mocks.download.mockRejectedValue(new Error("offline"));
		render(
			<MyDataPanel
				exports={[
					{
						id: "export-1",
						kind: "employee",
						status: "completed",
						createdAt: "2026-10-01T08:00:00Z",
						completedAt: "2026-10-01T08:05:00Z",
						expiresAt: "2026-10-08T08:05:00Z",
						sizeBytes: 2048,
					},
				]}
			/>,
		);
		const button = screen.getByRole("button", { name: "Download" });
		fireEvent.click(button);
		await waitFor(() =>
			expect(mocks.error).toHaveBeenCalledWith(
				"The download could not be started. Please try again.",
			),
		);
		expect(button.hasAttribute("disabled")).toBe(false);
	});
});
