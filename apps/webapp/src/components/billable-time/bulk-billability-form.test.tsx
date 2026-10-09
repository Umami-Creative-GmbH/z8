/* @vitest-environment jsdom */

import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { BulkBillabilitySummary } from "@/lib/billable-time/bulk-billability";
import { BulkBillabilityForm } from "./bulk-billability-form";

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, fallback: string, params?: Record<string, unknown>) =>
			params
				? fallback.replace(/\{(\w+)\}/g, (match, name: string) => String(params[name] ?? match))
				: fallback,
	}),
}));

vi.mock("@/hooks/use-display-context", () => ({
	useDisplayContext: () => ({ locale: "en-US", timezone: "UTC", hour12: false }),
}));

vi.mock("@/components/ui/date-picker", () => ({
	DatePicker: ({
		value,
		onChange,
		id,
	}: {
		value?: string;
		onChange: (value: string) => void;
		id?: string;
	}) => (
		<input aria-label={id} value={value ?? ""} onChange={(event) => onChange(event.target.value)} />
	),
}));

function summary(overrides: Partial<BulkBillabilitySummary> = {}): BulkBillabilitySummary {
	return {
		billable: true,
		change: { count: 2, minutes: 330 },
		alreadyInTarget: { count: 1, minutes: 120 },
		skipped: { invoiced: { count: 0, minutes: 0 }, held_back: { count: 1, minutes: 60 } },
		...overrides,
	};
}

const fingerprint = "a".repeat(64);
const freshFingerprint = "b".repeat(64);

function row(name: RegExp) {
	return within(screen.getByRole("row", { name }));
}

describe("BulkBillabilityForm", () => {
	it("previews the counts and applies exactly that preview", async () => {
		const user = userEvent.setup();
		const onPreview = vi
			.fn()
			.mockResolvedValue({ success: true, data: { summary: summary(), fingerprint } });
		const onApply = vi.fn().mockResolvedValue({
			success: true,
			data: { status: "applied", summary: summary(), failed: { count: 0, minutes: 0 } },
		});
		const onApplied = vi.fn();
		render(
			<BulkBillabilityForm
				initialRange={{ fromDay: "2026-07-01", toDay: "2026-07-31" }}
				onPreview={onPreview}
				onApply={onApply}
				onApplied={onApplied}
			/>,
		);

		await user.click(screen.getByRole("button", { name: "Preview" }));
		expect(onPreview).toHaveBeenCalledWith({
			fromDay: "2026-07-01",
			toDay: "2026-07-31",
			billable: true,
		});
		expect(row(/Will be marked billable/).getByText("2")).toBeTruthy();
		expect(row(/Will be marked billable/).getByText("5.5 h")).toBeTruthy();
		expect(row(/Already billable/).getByText("1")).toBeTruthy();
		expect(row(/Held back/).getByText("1 h")).toBeTruthy();

		await user.click(screen.getByRole("button", { name: "Apply" }));
		expect(onApply).toHaveBeenCalledWith({
			fromDay: "2026-07-01",
			toDay: "2026-07-31",
			billable: true,
			fingerprint,
		});
		expect(row(/Marked billable/).getByText("2")).toBeTruthy();
		expect(screen.queryByRole("button", { name: "Apply" })).toBeNull();
		expect(onApplied).toHaveBeenCalledTimes(1);
	});

	it("shows a fresh preview when the work changed since the preview", async () => {
		const user = userEvent.setup();
		const onPreview = vi
			.fn()
			.mockResolvedValue({ success: true, data: { summary: summary(), fingerprint } });
		const onApply = vi
			.fn()
			.mockResolvedValueOnce({
				success: true,
				data: {
					status: "stale",
					preview: {
						summary: summary({ change: { count: 1, minutes: 90 } }),
						fingerprint: freshFingerprint,
					},
				},
			})
			.mockResolvedValueOnce({
				success: true,
				data: {
					status: "applied",
					summary: summary({ change: { count: 1, minutes: 90 } }),
					failed: { count: 0, minutes: 0 },
				},
			});
		render(
			<BulkBillabilityForm
				initialRange={{ fromDay: "2026-07-01", toDay: "2026-07-31" }}
				onPreview={onPreview}
				onApply={onApply}
			/>,
		);

		await user.click(screen.getByRole("button", { name: "Preview" }));
		await user.click(screen.getByRole("button", { name: "Apply" }));
		expect(screen.getByRole("alert").textContent).toContain("changed since the preview");
		expect(row(/Will be marked billable/).getByText("1.5 h")).toBeTruthy();

		await user.click(screen.getByRole("button", { name: "Apply" }));
		expect(onApply).toHaveBeenLastCalledWith(
			expect.objectContaining({ fingerprint: freshFingerprint }),
		);
	});

	it("drops the preview when the choice changes", async () => {
		const user = userEvent.setup();
		const onPreview = vi
			.fn()
			.mockResolvedValue({ success: true, data: { summary: summary(), fingerprint } });
		render(
			<BulkBillabilityForm
				initialRange={{ fromDay: "2026-07-01", toDay: "2026-07-31" }}
				onPreview={onPreview}
				onApply={vi.fn()}
			/>,
		);

		await user.click(screen.getByRole("button", { name: "Preview" }));
		expect(screen.getByRole("button", { name: "Apply" })).toBeTruthy();
		await user.click(screen.getByRole("radio", { name: "Non-billable" }));
		expect(screen.queryByRole("button", { name: "Apply" })).toBeNull();
	});

	it("shows why a preview was refused", async () => {
		const user = userEvent.setup();
		render(
			<BulkBillabilityForm
				initialRange={{ fromDay: "2026-07-01", toDay: "2026-07-31" }}
				onPreview={vi
					.fn()
					.mockResolvedValue({ success: false, error: "Billable Time is switched off" })}
				onApply={vi.fn()}
			/>,
		);
		await user.click(screen.getByRole("button", { name: "Preview" }));
		expect(screen.getByRole("alert").textContent).toContain("Billable Time is switched off");
	});
});
