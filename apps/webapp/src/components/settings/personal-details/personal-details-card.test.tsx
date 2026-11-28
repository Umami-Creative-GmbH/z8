/* @vitest-environment jsdom */

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
	BankAccountView,
	PersonalDetailsView,
} from "@/lib/organization/personal-details/types";
import { PersonalDetailsCard } from "./personal-details-card";

const { revealEmployeePersonalDetails, endEmployeeBankAccount, refresh } = vi.hoisted(() => ({
	revealEmployeePersonalDetails: vi.fn(),
	endEmployeeBankAccount: vi.fn(),
	refresh: vi.fn(),
}));

vi.mock("@/app/[locale]/(app)/settings/employees/personal-details-actions", () => ({
	revealEmployeePersonalDetails,
	changeEmployeeBankAccount: vi.fn(),
	endEmployeeBankAccount,
}));

vi.mock("next/navigation", () => ({
	useRouter: () => ({ refresh }),
}));

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({ t: (_key: string, fallback: string) => fallback }),
	useTolgee: () => ({ getLanguage: () => "en" }),
}));

const ERIKA_IBAN = "DE89370400440532013000";
const MAX_IBAN = "AT611904300234573201";

function account(iban: string, revealed: boolean): BankAccountView {
	return {
		accountHolder: "Erika Mustermann",
		iban: revealed ? iban : null,
		ibanLastFour: iban.slice(-4),
		bic: null,
	};
}

function viewOf(iban: string, revealed: boolean): PersonalDetailsView {
	const entry = { validFrom: "2026-11-01", value: account(iban, revealed) };
	return {
		employeeId: "0b9f7c1e-5d0a-4f3e-9b8c-2a1d3e4f5a6b",
		on: "2026-11-28",
		viewer: { own: false, mayChange: true, revealed },
		bankAccount: { current: entry, history: [entry] },
	};
}

afterEach(cleanup);

describe("PersonalDetailsCard", () => {
	it("drops a revealed IBAN once the page delivers newer personal details, asking for a fresh reveal", async () => {
		revealEmployeePersonalDetails.mockResolvedValueOnce({
			success: true,
			data: viewOf(ERIKA_IBAN, true),
		});
		const { rerender } = render(<PersonalDetailsCard view={viewOf(ERIKA_IBAN, false)} />);

		await act(async () => {
			fireEvent.click(screen.getByRole("button", { name: "Show IBAN" }));
		});
		expect(screen.getAllByText("DE89 3704 0044 0532 0130 00").length).toBeGreaterThan(0);

		// Another decider corrected the bank account the same day; the refresh brings it.
		rerender(<PersonalDetailsCard view={viewOf(MAX_IBAN, false)} />);

		expect(screen.queryByText("DE89 3704 0044 0532 0130 00")).toBeNull();
		expect(screen.getAllByText("•••• 3201").length).toBeGreaterThan(0);
		expect(screen.getByRole("button", { name: "Show IBAN" })).toBeTruthy();
	});

	it("ends the bank account from the chosen day and refreshes the page", async () => {
		endEmployeeBankAccount.mockResolvedValueOnce({ success: true, data: { replaced: false } });
		render(<PersonalDetailsCard view={viewOf(ERIKA_IBAN, false)} />);

		fireEvent.click(screen.getByRole("button", { name: "End bank account" }));
		const form = screen.getByRole("form", { name: "End bank account" });
		fireEvent.change(form.querySelector("input[name=validFrom]") as HTMLInputElement, {
			target: { value: "2026-12-01" },
		});
		await act(async () => {
			fireEvent.submit(form);
		});

		expect(endEmployeeBankAccount).toHaveBeenCalledWith({
			employeeId: viewOf(ERIKA_IBAN, false).employeeId,
			validFrom: "2026-12-01",
		});
		expect(refresh).toHaveBeenCalled();
		expect(screen.queryByRole("form", { name: "End bank account" })).toBeNull();
	});

	it("words a refused end and keeps the form open", async () => {
		endEmployeeBankAccount.mockResolvedValueOnce({
			success: false,
			code: "ValidationError",
			refusal: "nothing_to_end",
			error: "Nothing is in force to end",
		});
		render(<PersonalDetailsCard view={viewOf(ERIKA_IBAN, false)} />);

		fireEvent.click(screen.getByRole("button", { name: "End bank account" }));
		await act(async () => {
			fireEvent.submit(screen.getByRole("form", { name: "End bank account" }));
		});

		expect(screen.getByRole("alert").textContent).toBe(
			"Nothing is on file from that date, so there is nothing to end.",
		);
	});

	it("offers no end when nothing is on file today or later, nor to those who may not change", () => {
		const ended: PersonalDetailsView = {
			...viewOf(ERIKA_IBAN, false),
			bankAccount: {
				current: null,
				history: [
					{ validFrom: "2026-11-15", value: null },
					{ validFrom: "2026-01-01", value: account(ERIKA_IBAN, false) },
				],
			},
		};
		const { rerender } = render(<PersonalDetailsCard view={ended} />);
		expect(screen.queryByRole("button", { name: "End bank account" })).toBeNull();

		rerender(
			<PersonalDetailsCard
				view={{
					...viewOf(ERIKA_IBAN, true),
					viewer: { own: true, mayChange: false, revealed: true },
				}}
			/>,
		);
		expect(screen.queryByRole("button", { name: "End bank account" })).toBeNull();
	});
});
