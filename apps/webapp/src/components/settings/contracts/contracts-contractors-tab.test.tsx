/* @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ContractorCompensationOverviewRow } from "@/lib/contractor-compensation/store";
import { ContractsContractorsTab } from "./contracts-contractors-tab";

const actions = vi.hoisted(() => ({ list: vi.fn() }));
vi.mock("@/app/[locale]/(app)/settings/contracts/contractor-compensation-actions", () => ({
	getContractorCompensation: vi.fn(),
	setContractorTerms: vi.fn(),
	endContractorTerms: vi.fn(),
	updateContractorDetails: vi.fn(),
	listContractorCompensation: actions.list,
}));
vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, fallback: string, params?: Record<string, unknown>) =>
			fallback.replace(/\{(\w+)\}/g, (match, name: string) => String(params?.[name] ?? match)),
	}),
}));
vi.mock("@/hooks/use-display-context", () => ({
	useDisplayContext: () => ({ locale: "en-US", timezone: "UTC", hour12: false }),
}));

function row(
	overrides: Partial<ContractorCompensationOverviewRow>,
): ContractorCompensationOverviewRow {
	return {
		employeeId: "95000000-0000-4000-8000-000000000001",
		name: "Ada",
		isActive: true,
		engagementKind: "contractor",
		termsToday: null,
		details: null,
		...overrides,
	};
}

const clients: QueryClient[] = [];
function renderTab() {
	const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	clients.push(client);
	return render(
		<QueryClientProvider client={client}>
			<ContractsContractorsTab />
		</QueryClientProvider>,
	);
}

beforeEach(() => {
	vi.resetAllMocks();
});
afterEach(() => {
	cleanup();
	for (const client of clients) client.clear();
	clients.length = 0;
});

describe("contracts contractors tab", () => {
	it("badges each person by their engagement today, not by having contractor terms", async () => {
		actions.list.mockResolvedValue({
			success: true,
			data: [
				row({ employeeId: "95000000-0000-4000-8000-000000000001", name: "Ada" }),
				row({
					employeeId: "95000000-0000-4000-8000-000000000002",
					name: "Ben",
					engagementKind: "employee",
				}),
				row({
					employeeId: "95000000-0000-4000-8000-000000000003",
					name: "Cleo",
					engagementKind: null,
				}),
			],
		});
		renderTab();

		const cellOf = async (name: string) =>
			within((await screen.findByText(name)).closest("td") as HTMLElement);
		expect((await cellOf("Ada")).getByText("External Contractor")).toBeTruthy();
		expect((await cellOf("Ada")).queryByText("Former External Contractor")).toBeNull();
		expect((await cellOf("Ben")).getByText("Former External Contractor")).toBeTruthy();
		expect((await cellOf("Ben")).queryByText("External Contractor")).toBeNull();
		expect((await cellOf("Cleo")).getByText("Former External Contractor")).toBeTruthy();
		expect(screen.getAllByText("No rate in effect")).toHaveLength(3);
	});
});
