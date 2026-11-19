// @vitest-environment jsdom
import { cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { render } from "@/test/render-with-translations";
import { ApiKeyShowDialog } from "./api-key-show-dialog";

afterEach(cleanup);
const first = {
	id: "public-first",
	key: "public-test-dummy-first",
	name: "First fixture",
	prefix: "public-prefix",
	expiresAt: null,
};
const second = {
	...first,
	id: "public-second",
	key: "public-test-dummy-second",
	name: "Second fixture",
};

it("shows a new one-time key during the development StrictMode effect probe", () => {
	render(<ApiKeyShowDialog apiKey={first} open onOpenChange={vi.fn()} />, {
		reactStrictMode: true,
	});
	expect(screen.getByRole<HTMLInputElement>("textbox", { name: "Your API Key" }).value).toBe(
		first.key,
	);
});

it("shows the key in a labelled read-only field that hides, reveals and copies it", async () => {
	const user = userEvent.setup();
	const writeText = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue(undefined);
	render(<ApiKeyShowDialog apiKey={first} open onOpenChange={vi.fn()} />);
	const field = screen.getByRole<HTMLInputElement>("textbox", { name: "Your API Key" });
	expect(field.readOnly).toBe(true);
	expect(field.value).toBe(first.key);

	await user.click(field);
	expect(field.selectionStart).toBe(0);
	expect(field.selectionEnd).toBe(first.key.length);

	await user.click(screen.getByRole("button", { name: "Hide key" }));
	expect(field.value).toBe("");
	expect(field.placeholder).toBe("Key hidden");
	await user.click(screen.getByRole("button", { name: "Reveal key" }));
	expect(field.value).toBe(first.key);

	await user.click(screen.getByRole("button", { name: "Copy API key" }));
	expect(writeText).toHaveBeenCalledWith(first.key);
	expect(await screen.findByText("Key copied to clipboard")).toBeTruthy();
});

it("does not carry the close acknowledgment from one key opening to the next", async () => {
	const close = vi.fn();
	const view = render(<ApiKeyShowDialog apiKey={first} open onOpenChange={close} />);
	await userEvent
		.setup()
		.click(screen.getAllByRole("button", { name: "Close", exact: true }).at(-1)!);
	expect(screen.getByRole("button", { name: "Close Anyway" })).toBeTruthy();
	view.rerender(<ApiKeyShowDialog apiKey={second} open onOpenChange={close} />);
	expect(screen.queryByRole("button", { name: "Close Anyway" })).toBeNull();
	expect(close).not.toHaveBeenCalled();
});
