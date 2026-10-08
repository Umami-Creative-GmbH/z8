/* @vitest-environment jsdom */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CurrencySettlement } from "@/lib/travel-expenses/settlement";

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, fallback: string, params?: Record<string, unknown>) =>
			fallback.replace(/\{(\w+)\}/g, (_match, name: string) => String(params?.[name] ?? "")),
	}),
}));
vi.mock("next-intl", () => ({ useLocale: () => "en-US" }));

import { BalanceText, SettlementStateBadge } from "./settlement-status";

afterEach(cleanup);

function line(state: CurrencySettlement["state"], balance: string): CurrencySettlement {
	return {
		currency: "EUR",
		entitlement: "89.90",
		reimbursed: "0.00",
		recovered: "0.00",
		balance,
		state,
	};
}

describe("settlement wording (#751)", () => {
	it.each([
		["outstanding", "Awaiting reimbursement"],
		["settled", "Reimbursed"],
		["overpaid", "Overpaid"],
		["mixed", "Needs review"],
	] as const)("labels a %s account %s", (state, label) => {
		const { container } = render(<SettlementStateBadge state={state} />);
		expect(container.textContent).toBe(label);
	});

	it("says Reimbursed for a balance that is fully paid", () => {
		const { container } = render(<BalanceText line={line("settled", "0.00")} />);
		expect(container.textContent).toBe("Reimbursed");
	});

	it("keeps the amounts of an outstanding or overpaid balance", () => {
		render(
			<>
				<p>
					<BalanceText line={line("outstanding", "39.90")} />
				</p>
				<p>
					<BalanceText line={line("overpaid", "-50.00")} />
				</p>
			</>,
		);
		expect(screen.getByText("€39.90 outstanding")).toBeTruthy();
		expect(screen.getByText("€50.00 overpaid")).toBeTruthy();
	});

	it("never says Settled", () => {
		const { container } = render(
			<>
				{(["outstanding", "settled", "overpaid", "mixed"] as const).map((state) => (
					<SettlementStateBadge key={state} state={state} />
				))}
				<BalanceText line={line("settled", "0.00")} />
			</>,
		);
		expect(container.textContent).not.toMatch(/settled/i);
	});
});
