// @vitest-environment jsdom

import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ReceiptExceptionField } from "./receipt-exception-field";

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({ t: (_key: string, fallback: string) => fallback }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const actions = vi.hoisted(() => ({ saveReceiptExceptionAction: vi.fn() }));
vi.mock("@/app/[locale]/(app)/travel-expenses/receipt-exception-actions", () => actions);

const reportId = "6a040000-0000-4000-8000-000000000001";
const itemId = "6a040000-0000-4000-8000-000000000002";

function mount(props: Partial<React.ComponentProps<typeof ReceiptExceptionField>> = {}) {
	const onContextChange = vi.fn();
	const onSaved = vi.fn();
	render(
		<ReceiptExceptionField
			reportId={reportId}
			itemId={itemId}
			exception={{ reason: null, version: 0 }}
			receiptCount={0}
			allowed
			onContextChange={onContextChange}
			onSaved={onSaved}
			{...props}
		/>,
	);
	return { onContextChange, onSaved };
}

describe("ReceiptExceptionField (#604)", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		actions.saveReceiptExceptionAction.mockReset();
	});
	afterEach(() => vi.useRealTimers());

	it("requires an explanation before an exception is saved, then saves it on its own version", async () => {
		actions.saveReceiptExceptionAction.mockResolvedValue({
			success: true,
			data: { status: "saved", receiptException: { reason: "Printer broken", version: 1 } },
		});
		const { onContextChange, onSaved } = mount();

		fireEvent.click(screen.getByRole("checkbox", { name: /request an exception/i }));
		await act(() => vi.advanceTimersByTimeAsync(1000));
		expect(actions.saveReceiptExceptionAction).not.toHaveBeenCalled();
		// Not an error yet: the explanation field was only just offered.
		expect(screen.queryByText("Explain why the receipt is missing.")).toBeNull();
		expect(screen.getByText("Unsaved changes")).toBeTruthy();
		fireEvent.blur(screen.getByRole("textbox", { name: /why is the receipt missing/i }));
		expect(screen.getByText("Explain why the receipt is missing.")).toBeTruthy();
		expect(onContextChange).toHaveBeenLastCalledWith({
			allowed: true,
			requested: true,
			reason: null,
		});

		fireEvent.change(screen.getByRole("textbox", { name: /why is the receipt missing/i }), {
			target: { value: "Printer broken" },
		});
		await act(() => vi.advanceTimersByTimeAsync(1000));
		expect(actions.saveReceiptExceptionAction).toHaveBeenCalledWith({
			reportId,
			itemId,
			expectedVersion: 0,
			requested: true,
			reason: "Printer broken",
		});
		expect(onSaved).toHaveBeenCalled();
	});

	it("offers no exception while the organization does not allow them", () => {
		mount({ allowed: false });
		expect(screen.queryByRole("checkbox")).toBeNull();
		expect(screen.queryByText("No receipt?")).toBeNull();
	});

	it("asks to remove an explanation saved before exceptions were disabled", async () => {
		actions.saveReceiptExceptionAction.mockResolvedValue({
			success: true,
			data: { status: "saved", receiptException: { reason: null, version: 3 } },
		});
		mount({ allowed: false, exception: { reason: "Lost", version: 2 } });
		expect(screen.getByText(/no longer allows missing-receipt exceptions/)).toBeTruthy();

		fireEvent.click(screen.getByRole("button", { name: "Remove explanation" }));
		await act(() => vi.advanceTimersByTimeAsync(1000));
		expect(actions.saveReceiptExceptionAction).toHaveBeenCalledWith(
			expect.objectContaining({ expectedVersion: 2, requested: false }),
		);
	});

	it("is not used once a receipt is attached", () => {
		mount({ receiptCount: 1, exception: { reason: "Lost", version: 1 } });
		expect(screen.queryByRole("checkbox")).toBeNull();
		expect(screen.getByText(/A receipt is attached/)).toBeTruthy();
	});
});
