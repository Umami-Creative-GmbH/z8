/* @vitest-environment jsdom */
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { UseTusFileUploadOptions } from "@/hooks/use-tus-file-upload";

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, fallback: string, params?: Record<string, unknown>) =>
			fallback.replace(/\{(\w+)\}/g, (match, name) =>
				String(params?.[name] ?? match),
			),
	}),
}));
vi.mock("next-intl", () => ({ useLocale: () => "en-US" }));
vi.mock("@/hooks/use-travel-expense-file-upload", () => ({
	useTravelExpenseFileUpload: (options: UseTusFileUploadOptions<unknown>) => ({
		addFile: (file: File) => {
			void options
				.process({ tusFileKey: "tus-upload", fileName: file.name })
				.then((receipt) => options.onSuccess?.(receipt))
				.catch((error: Error) => options.onError?.(error));
		},
		progress: 0,
		isUploading: false,
		isProcessing: false,
		reset: vi.fn(),
	}),
}));

import { SubmittedReportReceipts } from "./submitted-report-receipts";

const reportId = "report-1";
const itemId = "item-1";
const fetchMock = vi.fn();
function mount(
	overrides: Partial<React.ComponentProps<typeof SubmittedReportReceipts>> = {},
) {
	const onChanged = vi.fn();
	render(
		<SubmittedReportReceipts
			reportId={reportId}
			itemId={itemId}
			itemType="receipt"
			submissionCycle={2}
			canAddReceipt
			receipts={[]}
			onChanged={onChanged}
			{...overrides}
		/>,
	);
	return { onChanged };
}
afterEach(() => {
	cleanup();
	vi.clearAllMocks();
	vi.unstubAllGlobals();
});
describe("adding a missing receipt during review (#1255)", () => {
	it("attaches the selected file to the viewed submission and reloads it", async () => {
		vi.stubGlobal("fetch", fetchMock);
		fetchMock.mockResolvedValue({
			ok: true,
			json: async () => ({ receipt: { id: "receipt-1" } }),
		});
		const { onChanged } = mount();
		expect(screen.getByRole("button", { name: "Add receipt" })).toBeTruthy();
		fireEvent.change(screen.getByLabelText("Choose receipt"), {
			target: {
				files: [
					new File(["receipt"], "hotel.pdf", { type: "application/pdf" }),
				],
			},
		});
		await waitFor(() => expect(onChanged).toHaveBeenCalledOnce());
		expect(fetchMock).toHaveBeenCalledWith(
			"/api/upload/travel-expense/report-receipt",
			{
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					reportId,
					itemId,
					submissionCycle: 2,
					tusFileKey: "tus-upload",
					fileName: "hotel.pdf",
				}),
			},
		);
	});
	it.each([
		{ canAddReceipt: false },
		{ itemType: "mileage" as const },
		{ itemType: "per_diem" as const },
		{ receipts: [{ receiptId: "existing", fileName: "original.pdf" }] },
	])(
		"does not offer upload when the expense is ineligible: %j",
		(overrides) => {
			mount(overrides);
			expect(screen.queryByRole("button", { name: "Add receipt" })).toBeNull();
			expect(screen.queryByLabelText("Choose receipt")).toBeNull();
		},
	);

	it("keeps a refused upload visible without reloading or exposing server details", async () => {
		vi.stubGlobal("fetch", fetchMock);
		fetchMock.mockResolvedValue({
			ok: false,
			status: 409,
			json: async () => ({ error: "internal evidence details" }),
		});
		const { onChanged } = mount();
		fireEvent.change(screen.getByLabelText("Choose receipt"), {
			target: {
				files: [
					new File(["receipt"], "hotel.pdf", { type: "application/pdf" }),
				],
			},
		});
		expect((await screen.findByRole("alert")).textContent).toBe(
			"A receipt was already supplied or the report changed. Reload the report before trying again.",
		);
		expect(onChanged).not.toHaveBeenCalled();
		expect(screen.getByRole("button", { name: "Add receipt" })).toBeTruthy();
	});

	it("rejects unsupported files before uploading", () => {
		vi.stubGlobal("fetch", fetchMock);
		mount();
		fireEvent.change(screen.getByLabelText("Choose receipt"), {
			target: {
				files: [new File(["text"], "notes.txt", { type: "text/plain" })],
			},
		});
		expect(screen.getByRole("alert").textContent).toContain(
			"Attach a PDF or an image",
		);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("marks supplemental evidence with the actual uploader and UTC time and offers no replacement", () => {
		mount({
			receipts: [
				{
					receiptId: "supplement",
					fileName: "hotel.pdf",
					addedAfterSubmission: true,
					uploadedByName: "Morgan Manager",
					uploadedAt: "2026-10-15T08:30:00Z",
				},
			],
		});
		expect(
			screen.getByText(
				"hotel.pdf: Added after submission by Morgan Manager on Oct 15, 2026, 8:30 AM UTC.",
			),
		).toBeTruthy();
		expect(screen.queryByRole("button")).toBeNull();
	});
	it("validates against the configured receipt limit", () => {
		vi.stubGlobal("fetch", fetchMock);
		mount({ maxReceiptBytes: 2 * 1024 * 1024 });
		fireEvent.change(screen.getByLabelText("Choose receipt"), {
			target: {
				files: [
					new File([new Uint8Array(3 * 1024 * 1024)], "hotel.pdf", {
						type: "application/pdf",
					}),
				],
			},
		});
		expect(screen.getByRole("alert").textContent).toBe(
			"The file is too large. Attach a file of at most 2 MB.",
		);
		expect(fetchMock).not.toHaveBeenCalled();
	});
	it("accepts files over the default limit when the configured limit permits them", async () => {
		vi.stubGlobal("fetch", fetchMock);
		fetchMock.mockResolvedValue({ ok: true });
		const { onChanged } = mount({ maxReceiptBytes: 20 * 1024 * 1024 });
		fireEvent.change(screen.getByLabelText("Choose receipt"), {
			target: {
				files: [
					new File([new Uint8Array(11 * 1024 * 1024)], "hotel.pdf", {
						type: "application/pdf",
					}),
				],
			},
		});
		await waitFor(() => expect(onChanged).toHaveBeenCalledOnce());
		expect(screen.queryByRole("alert")).toBeNull();
	});
	it.each([
		[400, "Attach a PDF or an image (JPEG, PNG, WebP, GIF, BMP or TIFF)."],
		[413, "The file is too large. Attach a file of at most 2 MB."],
	])("explains a server rejection with HTTP %s", async (status, message) => {
		vi.stubGlobal("fetch", fetchMock);
		fetchMock.mockResolvedValue({ ok: false, status });
		const { onChanged } = mount({ maxReceiptBytes: 2 * 1024 * 1024 });
		fireEvent.change(screen.getByLabelText("Choose receipt"), {
			target: {
				files: [
					new File(["receipt"], "hotel.pdf", { type: "application/pdf" }),
				],
			},
		});
		expect((await screen.findByRole("alert")).textContent).toBe(message);
		expect(onChanged).not.toHaveBeenCalled();
	});
});
