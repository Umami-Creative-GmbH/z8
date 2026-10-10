/* @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	getDeputyCandidates,
	getDeputyDecisionCapability,
} from "@/app/[locale]/(app)/absences/deputy-actions";
import { DeputyPicker } from "./deputy-picker";

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, fallback: string, params?: Record<string, string>) =>
			fallback.replace(/\{(\w+)\}/g, (_match, name: string) => params?.[name] ?? `{${name}}`),
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

vi.mock("@/components/ui/select", async () => {
	const React = await import("react");

	function collectOptions(children: ReactNode): ReactElement[] {
		return React.Children.toArray(children).flatMap((child) => {
			if (!React.isValidElement<{ children?: ReactNode; value?: string; label?: string }>(child))
				return [];
			if (child.props.value) {
				return [
					<option key={child.props.value} value={child.props.value}>
						{child.props.label ?? child.props.value}
					</option>,
				];
			}
			return collectOptions(child.props.children);
		});
	}

	return {
		Select: ({
			children,
			onValueChange,
			value,
		}: {
			children: ReactNode;
			onValueChange: (value: string) => void;
			value: string;
		}) => (
			<select
				aria-label="Deputy"
				onChange={(event) => onValueChange(event.target.value)}
				value={value}
			>
				<option value="">Select option</option>
				{collectOptions(children)}
			</select>
		),
		SelectContent: ({ children }: { children: ReactNode }) => <>{children}</>,
		SelectItem: ({ children }: { children: ReactNode }) => <>{children}</>,
		SelectTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
		SelectValue: () => null,
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

describe("DeputyPicker", () => {
	it("marks colleagues who are away during the requested dates", async () => {
		render(<Harness />);

		const ben = await screen.findByRole("option", { name: /^Ben Example · Away / });
		expect(ben.textContent).toMatch(/Jun 3.*5/);
		expect(screen.getByRole("option", { name: "Carla Example" })).toBeTruthy();
		expect(getDeputyCandidates).toHaveBeenCalledWith({
			startDate: "2026-06-01",
			endDate: "2026-06-10",
		});
	});

	it("warns about an overlapping deputy and notes a contact only, but keeps the choice", async () => {
		render(<Harness />);
		await screen.findByRole("option", { name: "Carla Example" });

		fireEvent.change(screen.getByLabelText("Deputy"), { target: { value: BEN } });

		expect(
			await screen.findByText("Ben Example is away during these dates. You can still choose them."),
		).toBeTruthy();
		expect(
			await screen.findByText(
				"Ben Example will be shown as a contact only and cannot decide approvals.",
			),
		).toBeTruthy();
		expect((screen.getByLabelText("Deputy") as HTMLSelectElement).value).toBe(BEN);
	});

	it("shows neither note for an available deputy who can decide approvals", async () => {
		render(<Harness />);
		await screen.findByRole("option", { name: "Carla Example" });

		fireEvent.change(screen.getByLabelText("Deputy"), { target: { value: CARLA } });

		await waitFor(() =>
			expect(getDeputyDecisionCapability).toHaveBeenCalledWith({ deputyEmployeeId: CARLA }),
		);
		expect(screen.queryByText(/is away during these dates/)).toBeNull();
		expect(screen.queryByText(/contact only/)).toBeNull();
	});

	it("offers no deputy only when the absence type does not require one", async () => {
		const { unmount } = render(<Harness />);
		expect(await screen.findByRole("option", { name: "No deputy" })).toBeTruthy();
		unmount();

		render(<Harness required />);
		await screen.findByRole("option", { name: "Carla Example" });
		expect(screen.queryByRole("option", { name: "No deputy" })).toBeNull();
	});
});
