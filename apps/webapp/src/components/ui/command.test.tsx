/* @vitest-environment jsdom */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import * as React from "react";
import { describe, expect, it } from "vitest";

import { CommandDialog, CommandInput } from "./command";

describe("CommandDialog", () => {
	it("owns its backdrop lifecycle instead of delegating to DialogContent", async () => {
		const source = await readFile(join(process.cwd(), "src/components/ui/command.tsx"), "utf8");

		expect(source).toContain("COMMAND_DIALOG_CLOSE_DURATION_MS");
		expect(source).toContain("renderedOpen");
		expect(source).toContain("visualOpen");
		expect(source).toContain("data-command-open");
		expect(source).not.toContain("DialogContent");
	});

	it("keeps the command overlay mounted while closing", async () => {
		const user = userEvent.setup();

		function ControlledCommandDialog() {
			const [open, setOpen] = React.useState(true);

			return (
				<CommandDialog open={open} onOpenChange={setOpen} title="Search commands">
					<CommandInput placeholder="Search..." />
				</CommandDialog>
			);
		}

		render(<ControlledCommandDialog />);

		const overlay = document.querySelector<HTMLElement>('[data-slot="command-dialog-overlay"]');
		expect(overlay?.getAttribute("data-command-open")).toBe("true");

		await user.click(overlay as HTMLElement);

		expect(overlay?.getAttribute("data-command-open")).toBe("false");
		expect(screen.getByRole("dialog", { name: "Search commands" })).toBeTruthy();
	});
});
