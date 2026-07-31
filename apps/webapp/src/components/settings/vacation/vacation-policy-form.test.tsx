/* @vitest-environment jsdom */

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createVacationPolicy } from "@/app/[locale]/(app)/settings/vacation/actions";
import { VacationPolicyForm } from "./vacation-policy-form";

const refresh = vi.fn();
vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({ t: (_key: string, fallback: string) => fallback }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("@/app/[locale]/(app)/settings/vacation/actions", () => ({
	createVacationPolicy: vi.fn(),
	updateVacationPolicy: vi.fn(),
}));

beforeAll(() => {
	global.ResizeObserver = class ResizeObserver {
		observe() {}
		unobserve() {}
		disconnect() {}
	};
});

describe("VacationPolicyForm", () => {
	beforeEach(() => vi.clearAllMocks());

	it("re-enables create and keeps the panel open when creation rejects", async () => {
		const user = userEvent.setup();
		const onOpenChange = vi.fn();
		vi.mocked(createVacationPolicy).mockRejectedValue(
			new Error("Network failed"),
		);
		render(
			<VacationPolicyForm
				open
				onOpenChange={onOpenChange}
				organizationId="org_1"
			/>,
		);

		await user.type(screen.getByLabelText("Policy Name"), "Standard");
		await user.click(screen.getByRole("button", { name: "Create Policy" }));

		await waitFor(() =>
			expect(
				screen.getByRole("button", { name: "Create Policy" }),
			).toHaveProperty("disabled", false),
		);
		expect(toast.error).toHaveBeenCalledWith("An unexpected error occurred");
		expect(toast.success).not.toHaveBeenCalled();
		expect(onOpenChange).not.toHaveBeenCalled();
		expect(refresh).not.toHaveBeenCalled();
	});
});
