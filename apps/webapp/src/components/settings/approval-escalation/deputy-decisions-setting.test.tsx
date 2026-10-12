/* @vitest-environment jsdom */

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { saveDeputyDecisionsEnabledAction } from "@/app/[locale]/(app)/settings/approval-escalation/deputy-decisions-actions";
import { DeputyDecisionsSetting } from "./deputy-decisions-setting";

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({ t: (_key: string, fallback: string) => fallback }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/app/[locale]/(app)/settings/approval-escalation/deputy-decisions-actions", () => ({
	saveDeputyDecisionsEnabledAction: vi.fn(),
}));

const toggle = () => screen.getByRole("switch", { name: "Deputies can decide approvals" });

describe("DeputyDecisionsSetting", () => {
	beforeEach(() => vi.clearAllMocks());

	it("turns deputy decisions off", async () => {
		const user = userEvent.setup();
		vi.mocked(saveDeputyDecisionsEnabledAction).mockResolvedValue({
			success: true,
			data: { deputyDecisionsEnabled: false },
		});
		render(<DeputyDecisionsSetting enabled />);

		expect(toggle().getAttribute("aria-checked")).toBe("true");
		await user.click(toggle());

		expect(saveDeputyDecisionsEnabledAction).toHaveBeenCalledWith({ enabled: false });
		await waitFor(() =>
			expect(toast.success).toHaveBeenCalledWith(
				"Deputies can no longer decide approvals. They stay contacts.",
			),
		);
		expect(toggle().getAttribute("aria-checked")).toBe("false");
	});

	it("restores the switch and reports the error when saving fails", async () => {
		const user = userEvent.setup();
		vi.mocked(saveDeputyDecisionsEnabledAction).mockResolvedValue({
			success: false,
			error: "You do not have permission to manage approval settings.",
		});
		render(<DeputyDecisionsSetting enabled={false} />);

		await user.click(toggle());

		await waitFor(() =>
			expect(toast.error).toHaveBeenCalledWith(
				"You do not have permission to manage approval settings.",
			),
		);
		expect(toggle().getAttribute("aria-checked")).toBe("false");
	});
});
