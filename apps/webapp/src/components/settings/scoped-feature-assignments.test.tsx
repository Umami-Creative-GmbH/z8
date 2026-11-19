/* @vitest-environment jsdom */

import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ScopedFeatureAssignments } from "./scoped-feature-assignments";

const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));

vi.mock("sonner", () => ({ toast: toastMock }));

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, fallback?: string, params?: Record<string, string>) =>
			(fallback ?? _key).replace(/\{(\w+)\}/g, (_match, name: string) => params?.[name] ?? ""),
	}),
}));

vi.mock("@/components/employee-select", () => ({
	EmployeeSingleSelect: () => null,
}));

vi.mock("@/components/former-employees/former-employee-ui", () => ({
	FormerEmployeeBadge: () => <span>Former employee</span>,
}));

vi.mock("@/components/settings/access-grants/grant-editor", () => ({
	toSelectableEmployee: (employee: { id: string; name: string }) => employee,
}));

type Mode = "on" | "off";

const assignments = [
	{ id: "org", assignmentType: "organization" as const, teamId: null, employeeId: null, value: "off" as Mode },
	{ id: "team-row", assignmentType: "team" as const, teamId: "team-1", employeeId: null, value: "on" as Mode },
	{ id: "employee-row", assignmentType: "employee" as const, teamId: null, employeeId: "emp-1", value: "off" as Mode },
	{ id: "former-row", assignmentType: "employee" as const, teamId: null, employeeId: "emp-2", value: "on" as Mode },
];

function renderAssignments(overrides: {
	onRemove?: (id: string) => Promise<boolean>;
	onSave?: (...args: unknown[]) => Promise<boolean>;
} = {}) {
	const onRemove = vi.fn(overrides.onRemove ?? (async () => true));
	const onSave = vi.fn(overrides.onSave ?? (async () => true));
	render(
		<ScopedFeatureAssignments<Mode>
			assignments={assignments}
			teams={[{ id: "team-1", name: "Warehouse" }]}
			employees={[
				{ id: "emp-1", name: "Ada Lovelace" },
				{ id: "emp-2", name: "Grace Hopper", isFormer: true, formerSince: "2026-01-31" },
			]}
			options={[
				{ value: "on", label: "On" },
				{ value: "off", label: "Off" },
			]}
			valueLabel="Vehicle use"
			organizationLabel="Whole organization"
			description="Who records vehicle use"
			onSave={onSave}
			onRemove={onRemove}
		/>,
	);
	return { onRemove, onSave };
}

describe("ScopedFeatureAssignments removal", () => {
	beforeEach(() => {
		toastMock.success.mockReset();
		toastMock.error.mockReset();
	});

	it.each([
		["Warehouse", "team-row", { type: "team", teamId: "team-1" }, "on"],
		["Ada Lovelace", "employee-row", { type: "employee", employeeId: "emp-1" }, "off"],
	])("offers to undo removing the override for %s with the same value", async (name, id, target, value) => {
		const user = userEvent.setup();
		const { onRemove, onSave } = renderAssignments();

		await user.click(screen.getByRole("button", { name: `Remove ${name}` }));

		await waitFor(() => expect(toastMock.success).toHaveBeenCalledTimes(1));
		expect(onRemove).toHaveBeenCalledWith(id);
		const [message, options] = toastMock.success.mock.calls[0];
		expect(message).toBe(`Override removed for ${name}`);
		expect(options.action.label).toBe("Undo");

		await act(async () => options.action.onClick());
		expect(onSave).toHaveBeenCalledWith(target, value);
	});

	it("offers no undo when the removal fails", async () => {
		const user = userEvent.setup();
		renderAssignments({ onRemove: async () => false });

		await user.click(screen.getByRole("button", { name: "Remove Warehouse" }));

		await waitFor(() => expect(screen.getByRole("button", { name: "Remove Warehouse" }).hasAttribute("disabled")).toBe(false));
		expect(toastMock.success).not.toHaveBeenCalled();
	});

	it("confirms removing the organization default or a former employee without an undo", async () => {
		const user = userEvent.setup();
		renderAssignments();

		await user.click(screen.getByRole("button", { name: "Remove Whole organization" }));
		await waitFor(() => expect(screen.getByRole("button", { name: "Remove Grace Hopper" }).hasAttribute("disabled")).toBe(false));
		await user.click(screen.getByRole("button", { name: "Remove Grace Hopper" }));
		await waitFor(() => expect(screen.getByRole("button", { name: "Remove Warehouse" }).hasAttribute("disabled")).toBe(false));

		await waitFor(() => expect(toastMock.success).toHaveBeenCalledTimes(2));
		expect(toastMock.success.mock.calls).toEqual([
			["Organization default removed"],
			["Override removed for Grace Hopper"],
		]);
	});

	it("removes only once while a removal is pending, and applies an Undo clicked during another change once it ends", async () => {
		const user = userEvent.setup();
		let finishRemoval: (removed: boolean) => void = () => {};
		const { onRemove, onSave } = renderAssignments({
			onRemove: () =>
				new Promise<boolean>((resolve) => {
					finishRemoval = resolve;
				}),
		});
		const remove = screen.getByRole("button", { name: "Remove Warehouse" });

		await user.click(remove);
		await user.click(remove);
		expect(onRemove).toHaveBeenCalledTimes(1);
		expect(remove.hasAttribute("disabled")).toBe(true);

		await act(async () => finishRemoval(true));
		await waitFor(() => expect(toastMock.success).toHaveBeenCalledTimes(1));
		const undo = toastMock.success.mock.calls[0][1].action.onClick;

		// A second change starts; an Undo clicked meanwhile waits for it.
		await user.click(screen.getByRole("button", { name: "Remove Ada Lovelace" }));
		await act(async () => undo());
		expect(onSave).not.toHaveBeenCalled();

		await act(async () => finishRemoval(false));
		await waitFor(() =>
			expect(onSave).toHaveBeenCalledWith({ type: "team", teamId: "team-1" }, "on"),
		);
		expect(onSave).toHaveBeenCalledTimes(1);
	});
});
