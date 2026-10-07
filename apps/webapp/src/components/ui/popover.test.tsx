/* @vitest-environment jsdom */

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import * as React from "react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { Command, CommandInput, CommandItem, CommandList } from "./command";
import { Popover, PopoverContent, PopoverTrigger } from "./popover";

beforeAll(() => {
	vi.stubGlobal(
		"ResizeObserver",
		class {
			observe() {}
			unobserve() {}
			disconnect() {}
		},
	);
	HTMLElement.prototype.scrollIntoView = vi.fn();
});

function SearchablePopover(props: React.ComponentProps<typeof PopoverContent>) {
	return (
		<Popover>
			<PopoverTrigger>Open</PopoverTrigger>
			<PopoverContent {...props}>
				<button type="button">Before search</button>
				<Command>
					<CommandInput placeholder="Search" />
					<CommandList>
						<CommandItem>Item</CommandItem>
					</CommandList>
				</Command>
			</PopoverContent>
		</Popover>
	);
}

describe("PopoverContent", () => {
	it("focuses the search field even when it is not the first tabbable element", async () => {
		const user = userEvent.setup();
		render(<SearchablePopover />);

		await user.click(screen.getByRole("button", { name: "Open" }));

		const search = await screen.findByPlaceholderText("Search");
		await waitFor(() => expect(document.activeElement).toBe(search));
	});

	it("keeps focusing the first tabbable element when there is no search field", async () => {
		const user = userEvent.setup();
		render(
			<Popover>
				<PopoverTrigger>Open</PopoverTrigger>
				<PopoverContent>
					<button type="button">First</button>
					<button type="button">Second</button>
				</PopoverContent>
			</Popover>,
		);

		await user.click(screen.getByRole("button", { name: "Open" }));

		const first = await screen.findByRole("button", { name: "First" });
		await waitFor(() => expect(document.activeElement).toBe(first));
	});

	it("lets callers choose their own initial focus", async () => {
		const user = userEvent.setup();

		function ExplicitFocus() {
			const beforeRef = React.useRef<HTMLButtonElement>(null);

			return (
				<Popover>
					<PopoverTrigger>Open</PopoverTrigger>
					<PopoverContent initialFocus={beforeRef}>
						<button ref={beforeRef} type="button">
							Before search
						</button>
						<Command>
							<CommandInput placeholder="Search" />
						</Command>
					</PopoverContent>
				</Popover>
			);
		}

		render(<ExplicitFocus />);

		await user.click(screen.getByRole("button", { name: "Open" }));

		const before = await screen.findByRole("button", { name: "Before search" });
		await waitFor(() => expect(document.activeElement).toBe(before));
	});

	it("still forwards a ref to the popup element", async () => {
		const user = userEvent.setup();
		const ref = React.createRef<HTMLDivElement>();
		render(<SearchablePopover ref={ref} />);

		await user.click(screen.getByRole("button", { name: "Open" }));

		await waitFor(() => expect(ref.current?.dataset.slot).toBe("popover-content"));
	});
});
