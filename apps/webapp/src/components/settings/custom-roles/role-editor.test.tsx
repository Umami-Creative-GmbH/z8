/* @vitest-environment jsdom */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { CustomRoleWithPermissions } from "@/lib/effect/services/custom-role.service";
import { RoleEditor } from "./role-editor";

const actions = vi.hoisted(() => ({
	createCustomRole: vi.fn(),
	updateCustomRole: vi.fn(async () => ({ success: true })),
	setRolePermissions: vi.fn(async () => ({ success: true })),
}));
vi.mock("@/app/[locale]/(app)/settings/roles/actions", () => actions);
vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({ t: (_key: string, fallback: string) => fallback }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const role: CustomRoleWithPermissions = {
	id: "role-1",
	organizationId: "org-1",
	name: "Accounting",
	description: null,
	color: "#6366f1",
	isActive: true,
	baseTier: "employee",
	createdAt: new Date("2026-10-01T00:00:00.000Z"),
	createdBy: "user-1",
	updatedAt: new Date("2026-10-01T00:00:00.000Z"),
	updatedBy: null,
	permissions: [
		{ action: "read", subject: "Report" },
		{ action: "read", subject: "TravelExpenseFinance" },
	],
	assignedCount: 1,
};

describe("RoleEditor", () => {
	it("drops stored permissions the registry no longer offers when saving (#748)", async () => {
		const onSaved = vi.fn();
		render(<RoleEditor role={role} onSaved={onSaved} onCancel={vi.fn()} />);

		fireEvent.click(screen.getByRole("button", { name: /save/i }));

		await waitFor(() => expect(onSaved).toHaveBeenCalled());
		expect(actions.setRolePermissions).toHaveBeenCalledWith("role-1", [
			{ action: "read", subject: "Report" },
		]);
	});
});
