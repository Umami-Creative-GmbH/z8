/* @vitest-environment jsdom */

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ScimDestructiveDialogs } from "./scim-destructive-dialogs";

describe("ScimDestructiveDialogs", () => {
	it("keeps revoke behind an accessible keyboard-operable confirmation", () => {
		const onCancel = vi.fn(); const onConfirm = vi.fn();
		render(<ScimDestructiveDialogs action="revoke" onCancel={onCancel} onConfirm={onConfirm} />);
		expect(screen.getByRole("alertdialog", { name: "Revoke credential" })).toBeTruthy();
		const cancel = screen.getByRole("button", { name: "Cancel" }); cancel.focus(); expect(document.activeElement).toBe(cancel);
		fireEvent.keyDown(cancel, { key: "Enter" }); fireEvent.click(cancel); expect(onCancel).toHaveBeenCalled();
		fireEvent.click(screen.getByRole("button", { name: "Revoke" })); expect(onConfirm).toHaveBeenCalledOnce();
	});
});
