/* @vitest-environment jsdom */

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ContractorStatementExport } from "./contractor-statement-export";

const mocks = vi.hoisted(() => ({
	exportStatement: vi.fn(),
	error: vi.fn(),
	success: vi.fn(),
	download: vi.fn(),
}));
vi.mock("@/lib/contractor-statements/actions", () => ({
	exportContractorStatement: mocks.exportStatement,
}));
vi.mock("sonner", () => ({ toast: { error: mocks.error, success: mocks.success } }));
vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, fallback: string, params?: Record<string, unknown>) =>
			fallback.replace(/\{(\w+)\}/g, (match, name: string) => String(params?.[name] ?? match)),
	}),
}));
vi.mock("@/components/ui/date-picker", () => ({
	DatePicker: ({
		value,
		onChange,
		"aria-label": label,
	}: {
		value?: string;
		onChange: (value: string) => void;
		"aria-label"?: string;
	}) => (
		<input
			aria-label={label}
			value={value ?? ""}
			onChange={(event) => onChange(event.target.value)}
		/>
	),
}));
vi.mock("./download-file", () => ({ downloadBase64File: mocks.download }));

const employeeId = "95000000-0000-4000-8000-000000000001";

beforeEach(() => {
	vi.resetAllMocks();
});
afterEach(() => {
	cleanup();
});

describe("ContractorStatementExport", () => {
	it("downloads the month so far as a PDF for an org admin", async () => {
		mocks.exportStatement.mockResolvedValue({
			success: true,
			data: { filename: "statement.pdf", contentType: "application/pdf", base64: "JVBERg==" },
		});
		render(
			<ContractorStatementExport employeeId={employeeId} audience="admin" today="2026-11-23" />,
		);

		expect(screen.getByText("Time & fee statement")).toBeTruthy();
		expect(screen.getByText(/to check their invoice/)).toBeTruthy();
		await userEvent.click(screen.getByRole("radio", { name: "PDF" }));
		await userEvent.click(screen.getByRole("button", { name: /Download statement/ }));

		await waitFor(() =>
			expect(mocks.exportStatement).toHaveBeenCalledWith({
				employeeId,
				fromDay: "2026-11-01",
				toDay: "2026-11-23",
				format: "pdf",
			}),
		);
		expect(mocks.download).toHaveBeenCalledWith({
			filename: "statement.pdf",
			contentType: "application/pdf",
			base64: "JVBERg==",
		});
		expect(mocks.success).toHaveBeenCalledWith("Statement downloaded");
	});

	it("offers a contractor their own statement and words a refusal", async () => {
		mocks.exportStatement.mockResolvedValue({
			success: false,
			error: "server text",
			code: "ValidationError",
			refusal: "not_contractor",
		});
		render(
			<ContractorStatementExport employeeId={employeeId} audience="self" today="2026-11-23" />,
		);

		expect(screen.getByText(/prepare or check your invoice/)).toBeTruthy();
		await userEvent.click(screen.getByRole("button", { name: /Download statement/ }));

		await waitFor(() =>
			expect(mocks.error).toHaveBeenCalledWith(
				"This person had no External Contractor engagement in this period.",
			),
		);
		expect(mocks.exportStatement).toHaveBeenCalledWith(expect.objectContaining({ format: "csv" }));
		expect(mocks.download).not.toHaveBeenCalled();
	});

	it("does not ask for a period whose last day is before its first", async () => {
		render(
			<ContractorStatementExport employeeId={employeeId} audience="self" today="2026-11-23" />,
		);

		const to = screen.getByLabelText("To");
		await userEvent.clear(to);
		await userEvent.type(to, "2026-10-01");
		await userEvent.click(screen.getByRole("button", { name: /Download statement/ }));

		expect(await screen.findByText("The last day cannot be before the first day")).toBeTruthy();
		expect(mocks.exportStatement).not.toHaveBeenCalled();
	});
});
