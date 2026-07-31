/* @vitest-environment jsdom */

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { addDomainAction } from "@/app/[locale]/(app)/settings/enterprise/actions";
import { DomainAddDialog } from "./domain-add-dialog";

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({ t: (_key: string, fallback: string) => fallback }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/app/[locale]/(app)/settings/enterprise/actions", () => ({
	addDomainAction: vi.fn(),
}));

describe("DomainAddDialog", () => {
	beforeEach(() => vi.clearAllMocks());

	it("re-enables add and keeps the dialog open when adding rejects", async () => {
		const user = userEvent.setup();
		const onOpenChange = vi.fn();
		const onDomainAdded = vi.fn();
		vi.mocked(addDomainAction).mockRejectedValue(
			new Error("Domain unavailable"),
		);
		render(
			<DomainAddDialog
				open
				onOpenChange={onOpenChange}
				onDomainAdded={onDomainAdded}
			/>,
		);

		await user.type(screen.getByLabelText("Domain"), "login.example.com");
		await user.click(screen.getByRole("button", { name: "Add Domain" }));

		await waitFor(() =>
			expect(screen.getByRole("button", { name: "Add Domain" })).toHaveProperty(
				"disabled",
				false,
			),
		);
		expect(toast.error).toHaveBeenCalledWith("Domain unavailable");
		expect(toast.success).not.toHaveBeenCalled();
		expect(onDomainAdded).not.toHaveBeenCalled();
		expect(onOpenChange).not.toHaveBeenCalled();
	});
});
