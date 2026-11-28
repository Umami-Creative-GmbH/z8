/* @vitest-environment jsdom */

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
	BankAccountView,
	PersonalDetailsView,
} from "@/lib/organization/personal-details/types";
import { PersonalDetailsCard } from "./personal-details-card";

const {
	revealEmployeePersonalDetails,
	endEmployeePersonalDetails,
	changeEmployeeHealthInsurance,
	refresh,
} = vi.hoisted(() => ({
	revealEmployeePersonalDetails: vi.fn(),
	endEmployeePersonalDetails: vi.fn(),
	changeEmployeeHealthInsurance: vi.fn(),
	refresh: vi.fn(),
}));

vi.mock("@/app/[locale]/(app)/settings/employees/personal-details-actions", () => ({
	revealEmployeePersonalDetails,
	changeEmployeeBankAccount: vi.fn(),
	changeEmployeeHealthInsurance,
	endEmployeePersonalDetails,
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
		healthInsurance: { current: null, history: [] },
	};
}

const TK = {
	validFrom: "2026-01-01",
	value: {
		kind: "statutory" as const,
		insurerName: "Techniker Krankenkasse",
		betriebsnummer: "15027365",
	},
};

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
		endEmployeePersonalDetails.mockResolvedValueOnce({ success: true, data: { replaced: false } });
		render(<PersonalDetailsCard view={viewOf(ERIKA_IBAN, false)} />);

		fireEvent.click(screen.getByRole("button", { name: "End bank account" }));
		const form = screen.getByRole("form", { name: "End bank account" });
		fireEvent.change(form.querySelector("input[name=validFrom]") as HTMLInputElement, {
			target: { value: "2026-12-01" },
		});
		await act(async () => {
			fireEvent.submit(form);
		});

		expect(endEmployeePersonalDetails).toHaveBeenCalledWith({
			employeeId: viewOf(ERIKA_IBAN, false).employeeId,
			part: "bank_account",
			validFrom: "2026-12-01",
		});
		expect(refresh).toHaveBeenCalled();
		expect(screen.queryByRole("form", { name: "End bank account" })).toBeNull();
	});

	it("words a refused end and keeps the form open", async () => {
		endEmployeePersonalDetails.mockResolvedValueOnce({
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

	it("offers an end of an account that already ended, to correct the end to an earlier day", async () => {
		// Recorded from Jan 1, ended Mar 1; the decider learns it really ended Feb 1.
		endEmployeePersonalDetails.mockResolvedValueOnce({ success: true, data: { replaced: false } });
		const ended: PersonalDetailsView = {
			...viewOf(ERIKA_IBAN, false),
			on: "2026-04-15",
			bankAccount: {
				current: null,
				history: [
					{ validFrom: "2026-03-01", value: null },
					{ validFrom: "2026-01-01", value: account(ERIKA_IBAN, false) },
				],
			},
		};
		render(<PersonalDetailsCard view={ended} />);

		fireEvent.click(screen.getByRole("button", { name: "End bank account" }));
		const form = screen.getByRole("form", { name: "End bank account" });
		fireEvent.change(form.querySelector("input[name=validFrom]") as HTMLInputElement, {
			target: { value: "2026-02-01" },
		});
		await act(async () => {
			fireEvent.submit(form);
		});

		expect(endEmployeePersonalDetails).toHaveBeenCalledWith({
			employeeId: ended.employeeId,
			part: "bank_account",
			validFrom: "2026-02-01",
		});
	});

	it("offers no end when no bank account was ever on file, nor to those who may not change", () => {
		const { rerender } = render(
			<PersonalDetailsCard
				view={{
					...viewOf(ERIKA_IBAN, false),
					bankAccount: { current: null, history: [] },
				}}
			/>,
		);
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

	describe("health insurance", () => {
		it("shows the insurer in force with its Betriebsnummer, and none for an External Contractor", () => {
			const { rerender } = render(
				<PersonalDetailsCard
					view={{
						...viewOf(ERIKA_IBAN, false),
						healthInsurance: { current: TK, history: [TK] },
					}}
				/>,
			);
			expect(screen.getByRole("heading", { name: "Health insurance" })).toBeTruthy();
			expect(screen.getAllByText("Techniker Krankenkasse").length).toBeGreaterThan(0);
			expect(screen.getAllByText("15027365").length).toBeGreaterThan(0);

			rerender(
				<PersonalDetailsCard view={{ ...viewOf(ERIKA_IBAN, false), healthInsurance: null }} />,
			);
			expect(screen.queryByRole("heading", { name: "Health insurance" })).toBeNull();
			expect(screen.queryByRole("button", { name: "Change health insurance" })).toBeNull();
		});

		it("drops the health insurance once showing the IBAN finds an External Contractor, also after hiding it", async () => {
			const insured: PersonalDetailsView = {
				...viewOf(ERIKA_IBAN, false),
				healthInsurance: { current: TK, history: [TK] },
			};
			// Made an External Contractor since the page loaded: the reveal's view has no health insurance.
			revealEmployeePersonalDetails.mockResolvedValueOnce({
				success: true,
				data: { ...viewOf(ERIKA_IBAN, true), healthInsurance: null },
			});
			render(<PersonalDetailsCard view={insured} />);
			expect(screen.getByRole("heading", { name: "Health insurance" })).toBeTruthy();

			await act(async () => {
				fireEvent.click(screen.getByRole("button", { name: "Show IBAN" }));
			});
			const expectNoHealthInsurance = () => {
				expect(screen.queryByRole("heading", { name: "Health insurance" })).toBeNull();
				expect(screen.queryByText("Techniker Krankenkasse")).toBeNull();
				expect(screen.queryByRole("button", { name: "Change health insurance" })).toBeNull();
				expect(screen.queryByRole("button", { name: "End health insurance" })).toBeNull();
			};
			expectNoHealthInsurance();

			fireEvent.click(screen.getByRole("button", { name: "Hide IBAN" }));
			expect(screen.queryByText("DE89 3704 0044 0532 0130 00")).toBeNull();
			expect(screen.getAllByText("•••• 3000").length).toBeGreaterThan(0);
			expectNoHealthInsurance();
		});

		it("records a private insurer by its typed name and refreshes the page", async () => {
			changeEmployeeHealthInsurance.mockResolvedValueOnce({
				success: true,
				data: { replaced: false },
			});
			render(<PersonalDetailsCard view={viewOf(ERIKA_IBAN, false)} />);

			fireEvent.click(screen.getByRole("button", { name: "Change health insurance" }));
			const form = screen.getByRole("form", { name: "Change health insurance" });
			fireEvent.click(screen.getByRole("radio", { name: "Private" }));
			fireEvent.change(form.querySelector("input[name=insurerName]") as HTMLInputElement, {
				target: { value: "Allianz Private" },
			});
			fireEvent.change(form.querySelector("input[name=validFrom]") as HTMLInputElement, {
				target: { value: "2026-12-01" },
			});
			await act(async () => {
				fireEvent.submit(form);
			});

			expect(changeEmployeeHealthInsurance).toHaveBeenCalledWith({
				employeeId: viewOf(ERIKA_IBAN, false).employeeId,
				validFrom: "2026-12-01",
				kind: "private",
				betriebsnummer: null,
				insurerName: "Allianz Private",
			});
			expect(refresh).toHaveBeenCalled();
		});

		it("asks for a pick from the list for a statutory insurer, or a typed name when it is missing", async () => {
			changeEmployeeHealthInsurance.mockResolvedValueOnce({
				success: true,
				data: { replaced: false },
			});
			render(<PersonalDetailsCard view={viewOf(ERIKA_IBAN, false)} />);

			fireEvent.click(screen.getByRole("button", { name: "Change health insurance" }));
			const form = screen.getByRole("form", { name: "Change health insurance" });
			await act(async () => {
				fireEvent.submit(form);
			});
			expect(screen.getByText("Choose the insurer from the list.")).toBeTruthy();
			expect(changeEmployeeHealthInsurance).not.toHaveBeenCalled();

			fireEvent.click(screen.getByRole("checkbox", { name: "The insurer is not on the list" }));
			fireEvent.change(form.querySelector("input[name=insurerName]") as HTMLInputElement, {
				target: { value: "Neue BKK" },
			});
			await act(async () => {
				fireEvent.submit(form);
			});
			expect(changeEmployeeHealthInsurance).toHaveBeenCalledWith(
				expect.objectContaining({
					kind: "statutory",
					betriebsnummer: null,
					insurerName: "Neue BKK",
				}),
			);
		});

		it("ends the health insurance from the chosen day", async () => {
			endEmployeePersonalDetails.mockResolvedValueOnce({
				success: true,
				data: { replaced: false },
			});
			render(
				<PersonalDetailsCard
					view={{ ...viewOf(ERIKA_IBAN, false), healthInsurance: { current: TK, history: [TK] } }}
				/>,
			);

			fireEvent.click(screen.getByRole("button", { name: "End health insurance" }));
			const form = screen.getByRole("form", { name: "End health insurance" });
			fireEvent.change(form.querySelector("input[name=validFrom]") as HTMLInputElement, {
				target: { value: "2026-12-01" },
			});
			await act(async () => {
				fireEvent.submit(form);
			});

			expect(endEmployeePersonalDetails).toHaveBeenCalledWith({
				employeeId: viewOf(ERIKA_IBAN, false).employeeId,
				part: "health_insurance",
				validFrom: "2026-12-01",
			});
		});
	});
});
