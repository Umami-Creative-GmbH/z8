/* @vitest-environment jsdom */

import { fireEvent, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { expect, it, vi } from "vitest";
import AdminError from "@/app/[locale]/(admin)/error";
import AdminNotFound from "@/app/[locale]/(admin)/not-found";
import WorkspaceError from "@/app/[locale]/(app)/error";
import WorkspaceNotFound from "@/app/[locale]/(app)/not-found";
import SettingsError from "@/app/[locale]/(app)/settings/error";
import { render } from "@/test/render-with-translations";

let pathname = "/calendar";

vi.mock("@/navigation", () => ({
	Link: ({ children, href }: { children: ReactNode; href: string }) => (
		<a href={href}>{children}</a>
	),
	useRouter: () => ({ back: () => {} }),
	usePathname: () => pathname,
}));

it("keeps Settings retry and recovery without displaying internal error messages", () => {
	const reset = vi.fn();
	vi.spyOn(console, "error").mockImplementation(() => {});
	render(
		<SettingsError
			error={new Error("private database detail")}
			reset={reset}
		/>,
	);
	expect(
		screen.getByRole("heading", { level: 2, name: "Something went wrong" }),
	).toBeTruthy();
	expect(screen.queryByText("private database detail")).toBeNull();
	expect(
		screen.getByRole("link", { name: "Back to Settings" }).getAttribute("href"),
	).toBe("/settings");
	fireEvent.click(screen.getByRole("button", { name: "Retry" }));
	expect(reset).toHaveBeenCalledOnce();
});

it("keeps one main heading when workspace failure replaces a converted or unconverted page", () => {
	vi.spyOn(console, "error").mockImplementation(() => {});
	pathname = "/de/calendar";
	const page = render(
		<>
			<h1>Calendar</h1>
			<WorkspaceError error={new Error("internal")} reset={() => {}} />
		</>,
	);
	expect(
		screen
			.getAllByRole("heading", { level: 1 })
			.map((heading) => heading.textContent),
	).toEqual(["Calendar"]);
	expect(
		screen.getByRole("link", { name: "Settings" }).getAttribute("href"),
	).toBe("/settings");
	pathname = "/de/reports";
	page.rerender(<WorkspaceNotFound />);
	expect(
		screen.getByRole("heading", { level: 1, name: "Page not found" }),
	).toBeTruthy();
	expect(screen.queryByText("internal")).toBeNull();
});

it("keeps admin error and not-found recovery inside its distinct shell", () => {
	vi.spyOn(console, "error").mockImplementation(() => {});
	const page = render(
		<AdminError error={new Error("internal")} reset={() => {}} />,
	);
	expect(
		screen.getByRole("link", { name: "Admin Console" }).getAttribute("href"),
	).toBe("/platform-admin");
	expect(screen.queryByRole("link", { name: "Settings" })).toBeNull();
	page.rerender(<AdminNotFound />);
	expect(
		screen.getByRole("heading", { level: 1, name: "Page not found" }),
	).toBeTruthy();
	expect(
		screen.getByRole("link", { name: "Admin Console" }).getAttribute("href"),
	).toBe("/platform-admin");
});
