/* @vitest-environment jsdom */

import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it } from "vitest";
import { render } from "@/test/render-with-translations";
import { ThemeProvider } from "./theme-provider";
import { ThemeToggle } from "./theme-toggle";
import { Button } from "./ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";

it("changes the real theme from the phone overflow and returns keyboard focus through both overlays", async () => {
	const user = userEvent.setup();
	render(
		<ThemeProvider
			attribute="class"
			defaultTheme="light"
			enableSystem={false}
			storageKey="f1-theme-test"
		>
			<Popover>
				<PopoverTrigger asChild>
					<Button>More actions</Button>
				</PopoverTrigger>
				<PopoverContent aria-label="More actions">
					<ThemeToggle trigger={<Button>Toggle theme</Button>} />
				</PopoverContent>
			</Popover>
		</ThemeProvider>,
	);
	await user.click(screen.getByRole("button", { name: "More actions" }));
	await user.click(screen.getByRole("button", { name: "Toggle theme" }));
	await user.click(await screen.findByRole("menuitem", { name: "Dark" }));
	await waitFor(() =>
		expect(document.documentElement.classList.contains("dark")).toBe(true),
	);
	expect(localStorage.getItem("f1-theme-test")).toBe("dark");
	const themeTrigger = screen.getByRole("button", { name: "Toggle theme" });
	await user.click(themeTrigger);
	await screen.findByRole("menu");
	await user.keyboard("{Escape}");
	await waitFor(() => expect(document.activeElement).toBe(themeTrigger));
	await user.keyboard("{Escape}");
	await waitFor(() =>
		expect(document.activeElement).toBe(
			screen.getByRole("button", { name: "More actions" }),
		),
	);
});
