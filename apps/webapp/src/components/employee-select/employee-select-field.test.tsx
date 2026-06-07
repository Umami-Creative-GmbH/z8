// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EmployeeMultiSelect } from "./employee-select-field";
import type { SelectableEmployee } from "./types";

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, fallback: string, params?: Record<string, string | number>) => {
			let translated = fallback;
			for (const [key, value] of Object.entries(params ?? {})) {
				translated = translated.replace(`{${key}}`, String(value));
			}
			return translated;
		},
	}),
}));

function makeEmployee(id: string, name: string): SelectableEmployee {
	return {
		id,
		userId: id,
		firstName: null,
		lastName: null,
		pronouns: null,
		position: null,
		role: "employee",
		isActive: true,
		teamId: null,
		user: {
			id,
			name,
			email: `${id}@example.com`,
			image: null,
		},
		team: null,
	};
}

function ControlledEmployeeMultiSelect() {
	const [value, setValue] = useState<string[]>([]);

	return (
		<div>
			<EmployeeMultiSelect
				label="Employees"
				value={value}
				onChange={setValue}
				employees={[
					makeEmployee("employee-a", "Ada Lovelace"),
					makeEmployee("employee-b", "Grace Hopper"),
				]}
			/>
			<output aria-label="selected employee ids">{value.join(",")}</output>
		</div>
	);
}

describe("EmployeeMultiSelect", () => {
	beforeEach(() => {
		globalThis.ResizeObserver = class ResizeObserver {
			observe() {}
			unobserve() {}
			disconnect() {}
		};
	});

	it("applies every pending employee selected before confirm", async () => {
		const user = userEvent.setup();
		const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

		render(
			<QueryClientProvider client={queryClient}>
				<ControlledEmployeeMultiSelect />
			</QueryClientProvider>,
		);

		await user.click(screen.getByRole("combobox"));
		await user.click(screen.getByRole("option", { name: /Ada Lovelace/i }));
		await user.click(screen.getByRole("option", { name: /Grace Hopper/i }));
		await user.click(screen.getByRole("button", { name: "Confirm (2)" }));

		await waitFor(() =>
			expect(screen.getByLabelText("selected employee ids").textContent).toBe(
				"employee-a,employee-b",
			),
		);
	});
});
