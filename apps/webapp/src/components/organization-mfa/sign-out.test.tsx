// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";

const { signOut } = vi.hoisted(() => ({ signOut: vi.fn() }));
vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({ t: (_key: string, fallback: string) => fallback }),
}));
vi.mock("@/lib/auth-client", () => ({ authClient: { signOut } }));

import { MfaSignOut } from "./sign-out";

it("keeps failed sign-out recoverable, prevents duplicate requests and offers retry", async () => {
	let finish: (value: unknown) => void = () => {
		throw new Error("Sign-out did not start");
	};
	signOut.mockImplementation(
		() =>
			new Promise((resolve) => {
				finish = resolve;
			}),
	);
	render(<MfaSignOut />);
	const button = screen.getByRole<HTMLButtonElement>("button", {
		name: "Sign out",
	});
	await userEvent.click(button);
	expect(button.disabled).toBe(true);
	fireEvent.click(button);
	expect(signOut).toHaveBeenCalledTimes(1);
	finish({ error: { message: "refused" } });
	expect((await screen.findByRole("alert")).textContent).toContain(
		"Sign-out failed. Try again.",
	);
	await waitFor(() => expect(button.disabled).toBe(false));
	signOut.mockRejectedValueOnce(new Error("offline"));
	await userEvent.click(button);
	expect(signOut).toHaveBeenCalledTimes(2);
	expect((await screen.findByRole("alert")).textContent).toContain(
		"Sign-out failed. Try again.",
	);
});
