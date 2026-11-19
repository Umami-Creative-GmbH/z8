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
	const retry = vi.fn();
	vi.spyOn(console, "error").mockImplementation(() => {});
	pathname = "/de/settings/webhooks";
	const { unmount } = render(
		<SettingsError
			error={new Error("private database detail")}
			retry={retry}
		/>,
	);
	expect(
		screen.getByRole("heading", { level: 2, name: "Something went wrong" }),
	).toBeTruthy();
	unmount();
	// A settings page that owns its heading gets the main heading from the boundary.
	pathname = "/de/settings/security";
	const owned = render(
		<SettingsError
			error={new Error("private database detail")}
			retry={retry}
		/>,
	);
	expect(
		screen.getByRole("heading", { level: 1, name: "Something went wrong" }),
	).toBeTruthy();
	expect(screen.queryByText("private database detail")).toBeNull();
	expect(
		screen.getByRole("link", { name: "Back to Settings" }).getAttribute("href"),
	).toBe("/settings");
	fireEvent.click(screen.getByRole("button", { name: "Retry" }));
	expect(retry).toHaveBeenCalledOnce();
	owned.unmount();
});

it.each([
	{
		name: "a shell-owned unknown descendant",
		path: "/de/calendar/unknown/descendant",
		shellHeading: true,
		expectedHeading: "Calendar",
	},
	{
		name: "a converted page",
		path: "/de/",
		shellHeading: false,
		expectedHeading: "Something went wrong",
	},
])(
	"keeps one main heading for $name recovery",
	({ path, shellHeading, expectedHeading }) => {
		vi.spyOn(console, "error").mockImplementation(() => {});
		pathname = path;
		const page = render(
			<>
				{shellHeading ? <h1>Calendar</h1> : null}
				<WorkspaceError error={new Error("internal")} retry={() => {}} />
			</>,
		);
		expect(
			screen
				.getAllByRole("heading", { level: 1 })
				.map((heading) => heading.textContent),
		).toEqual([expectedHeading]);
		expect(
			screen.getByRole("link", { name: "Settings" }).getAttribute("href"),
		).toBe("/settings");
		pathname = "/de/reports";
		page.rerender(<WorkspaceNotFound />);
		expect(
			screen.getByRole("heading", { level: 1, name: "Page not found" }),
		).toBeTruthy();
		expect(screen.queryByText("internal")).toBeNull();
	},
);

it("keeps admin error and not-found recovery inside its distinct shell", () => {
	vi.spyOn(console, "error").mockImplementation(() => {});
	const page = render(
		<AdminError error={new Error("internal")} retry={() => {}} />,
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
