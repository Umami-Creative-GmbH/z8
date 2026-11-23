/* @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
	getDeputyCandidates,
	getDeputyDecisionCapability,
} from "@/app/[locale]/(app)/absences/deputy-actions";
import { DeputyPicker } from "./deputy-picker";

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, fallback?: string, params?: Record<string, string>) =>
			(fallback ?? _key).replace(/\{(\w+)\}/g, (_match, name: string) => params?.[name] ?? `{${name}}`),
	}),
}));

vi.mock("next-intl", () => ({ useLocale: () => "en" }));

vi.mock("@/lib/auth-client", () => ({
	useSession: () => ({ data: { session: { activeOrganizationId: "org-1" } } }),
}));

vi.mock("@/app/[locale]/(app)/absences/deputy-actions", () => ({
	getDeputyCandidates: vi.fn(),
	getDeputyDecisionCapability: vi.fn(),
}));

beforeAll(() => {
	globalThis.ResizeObserver = class ResizeObserver {
		observe() {}
		unobserve() {}
		disconnect() {}
	};
});

const BEN = "e1011000-0000-4000-8000-000000000005";
const CARLA = "e1011000-0000-4000-8000-000000000006";

function Harness({ required = false }: { required?: boolean }) {
	const [value, setValue] = useState("");
	return (
		<QueryClientProvider
			client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
		>
			<DeputyPicker
				value={value}
				onChange={setValue}
				startDate="2026-06-01"
				endDate="2026-06-10"
				required={required}
			/>
		</QueryClientProvider>
	);
}

beforeEach(() => {
	vi.mocked(getDeputyCandidates).mockResolvedValue({
		success: true,
		data: [
			{
				id: BEN,
				name: "Ben Example",
				image: null,
				awayPeriods: [{ startDate: "2026-06-03", endDate: "2026-06-05" }],
			},
			{ id: CARLA, name: "Carla Example", image: null, awayPeriods: [] },
		],
	});
	vi.mocked(getDeputyDecisionCapability).mockImplementation(async ({ deputyEmployeeId }) => ({
		success: true,
		data: { canDecideApprovals: deputyEmployeeId === CARLA },
	}));
});

async function openDeputyPicker() {
	const trigger = screen.getByRole("combobox", { name: "Deputy" });
	await waitFor(() => expect(trigger.hasAttribute("disabled")).toBe(false));
	fireEvent.click(trigger);
	return trigger;
}

describe("DeputyPicker", () => {
	it("marks colleagues who are away during the requested dates", async () => {
		render(<Harness />);
		await openDeputyPicker();

		const ben = await screen.findByRole("option", { name: /Ben Example/ });
		expect(ben.textContent).toMatch(/Away .*Jun 3.*5/);
		expect(screen.getByRole("option", { name: /Carla Example/ })).toBeTruthy();
		expect(getDeputyCandidates).toHaveBeenCalledWith({
			startDate: "2026-06-01",
			endDate: "2026-06-10",
		});
	});

	it("warns about an overlapping deputy and notes a contact only, but keeps the choice", async () => {
		render(<Harness />);
		const trigger = await openDeputyPicker();
		fireEvent.click(await screen.findByRole("option", { name: /Ben Example/ }));

		expect(
			await screen.findByText("Ben Example is away during these dates. You can still choose them."),
		).toBeTruthy();
		expect(
			await screen.findByText(
				"Ben Example will be shown as a contact only and cannot decide approvals.",
			),
		).toBeTruthy();
		expect(trigger.textContent).toContain("Ben Example");
	});

	it("shows neither note for an available deputy who can decide approvals", async () => {
		render(<Harness />);
		await openDeputyPicker();
		fireEvent.click(await screen.findByRole("option", { name: /Carla Example/ }));

		await waitFor(() =>
			expect(getDeputyDecisionCapability).toHaveBeenCalledWith({ deputyEmployeeId: CARLA }),
		);
		expect(screen.queryByText(/is away during these dates/)).toBeNull();
		expect(screen.queryByText(/contact only/)).toBeNull();
	});

	it("offers no deputy only when the absence type does not require one", async () => {
		const { unmount } = render(<Harness />);
		await openDeputyPicker();
		expect(await screen.findByRole("option", { name: "No deputy" })).toBeTruthy();
		unmount();

		render(<Harness required />);
		await openDeputyPicker();
		await screen.findByRole("option", { name: /Carla Example/ });
		expect(screen.queryByRole("option", { name: "No deputy" })).toBeNull();
	});
});
