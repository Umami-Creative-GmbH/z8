/* @vitest-environment jsdom */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ScimOneTimeCredentialDialog } from "./scim-one-time-credential-dialog";

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({ t: (_key: string, fallback: string) => fallback }),
}));

describe("ScimOneTimeCredentialDialog", () => {
	it("requires acknowledgement and clears the one-time credential after close", async () => {
		const onClosed = vi.fn();
		Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
		render(
			<ScimOneTimeCredentialDialog
				token="scim_secret_returned_once"
				open
				onClosed={onClosed}
			/>,
		);

		expect(screen.getByText("scim_secret_returned_once")).toBeTruthy();
		fireEvent.click(screen.getAllByRole("button", { name: "Close" })[0]);
		expect(onClosed).not.toHaveBeenCalled();
		expect(screen.getByText("Confirm that the credential is saved before closing.")).toBeTruthy();

		fireEvent.click(screen.getByRole("button", { name: "Copy credential" }));
		await waitFor(() =>
			expect(navigator.clipboard.writeText).toHaveBeenCalledWith("scim_secret_returned_once"),
		);
		fireEvent.click(screen.getByRole("checkbox", { name: "I have saved this credential" }));
		fireEvent.click(screen.getAllByRole("button", { name: "Close" })[0]);
		expect(onClosed).toHaveBeenCalledOnce();
	});

	it("does not dismiss with escape and requires a second close confirmation when not copied", () => {
		const onClosed = vi.fn();
		render(<ScimOneTimeCredentialDialog token="scim_secret_returned_once" open onClosed={onClosed} />);
		fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
		expect(onClosed).not.toHaveBeenCalled();
		fireEvent.click(screen.getAllByRole("button", { name: "Close" })[0]);
		fireEvent.click(screen.getAllByRole("button", { name: "Close" })[0]);
		expect(onClosed).toHaveBeenCalledOnce();
	});
});
