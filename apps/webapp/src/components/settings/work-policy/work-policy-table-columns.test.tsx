/* @vitest-environment jsdom */

import type { CellContext } from "@tanstack/react-table";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { TFnType } from "@tolgee/react";
import type { ReactNode } from "react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { WorkPolicyWithDetails } from "@/app/[locale]/(app)/settings/work-policies/actions";
import { getWorkPolicyTableColumns } from "./work-policy-table-columns";

beforeAll(() => {
	global.ResizeObserver = class ResizeObserver {
		observe() {}
		unobserve() {}
		disconnect() {}
	};
	Element.prototype.hasPointerCapture = vi.fn(() => false);
	Element.prototype.setPointerCapture = vi.fn();
	Element.prototype.releasePointerCapture = vi.fn();
	Element.prototype.scrollIntoView = vi.fn();
});

const policy = {
	id: "policy-1",
	organizationId: "org-1",
	name: "Retail 38h",
	description: null,
	isDefault: false,
	isActive: true,
	scheduleEnabled: false,
	regulationEnabled: false,
	presenceEnabled: false,
	createdAt: new Date("2026-01-01T00:00:00.000Z"),
	updatedAt: new Date("2026-01-01T00:00:00.000Z"),
	schedule: null,
	regulation: null,
	presence: null,
} as unknown as WorkPolicyWithDetails;

function renderActions({
	canManagePolicies = true,
	isDuplicatePending = false,
	isSetDefaultPending = false,
}: {
	canManagePolicies?: boolean;
	isDuplicatePending?: boolean;
	isSetDefaultPending?: boolean;
}) {
	const columns = getWorkPolicyTableColumns({
		t: ((_key: string, fallback: string) => fallback) as TFnType,
		canManagePolicies,
		onEdit: vi.fn(),
		onDuplicate: vi.fn(),
		onSetDefault: vi.fn(),
		onDelete: vi.fn(),
		isDuplicatePending,
		isSetDefaultPending,
	});
	const actionsColumn = columns.find((column) => column.id === "actions");

	if (!actionsColumn) {
		return null;
	}

	const cell = actionsColumn.cell as (
		context: CellContext<WorkPolicyWithDetails, unknown>,
	) => ReactNode;
	return render(cell({ row: { original: policy } } as CellContext<WorkPolicyWithDetails, unknown>));
}

describe("getWorkPolicyTableColumns", () => {
	it("only includes policy actions for managers", () => {
		const columns = getWorkPolicyTableColumns({
			t: ((_key: string, fallback: string) => fallback) as TFnType,
			canManagePolicies: false,
			onEdit: vi.fn(),
			onDuplicate: vi.fn(),
			onSetDefault: vi.fn(),
			onDelete: vi.fn(),
			isDuplicatePending: false,
			isSetDefaultPending: false,
		});

		expect(columns.some((column) => column.id === "actions")).toBe(false);
	});

	it("disables pending duplicate and set-default actions", async () => {
		const user = userEvent.setup();
		renderActions({ isDuplicatePending: true, isSetDefaultPending: true });

		await user.click(screen.getByRole("button", { name: "Open menu" }));

		expect(screen.getByRole("menuitem", { name: "Duplicate" }).getAttribute("aria-disabled")).toBe(
			"true",
		);
		expect(
			screen.getByRole("menuitem", { name: "Set as Default" }).getAttribute("aria-disabled"),
		).toBe("true");
	});
});
