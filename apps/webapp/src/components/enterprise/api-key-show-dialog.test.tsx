// @vitest-environment jsdom
import { cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Activity } from "react";
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

it("retires a displayed one-time key when Activity hides and shows the same opening", async () => {
	const close = vi.fn();
	const tree = (visible: boolean) => (
		<Activity mode={visible ? "visible" : "hidden"}>
			<ApiKeyShowDialog apiKey={first} open onOpenChange={close} />
		</Activity>
	);
	const view = render(tree(true));
	expect(screen.getByText(first.key)).toBeTruthy();
	view.rerender(tree(false));
	view.rerender(tree(true));
	expect(screen.queryByText(first.key)).toBeNull();
});
