// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, expect, it, vi } from "vitest";
import LocationPresenceError from "./error";
import { LocationPresenceLoading } from "./location-presence-loading";
import LocationPresenceNotFound from "./not-found";

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({ t: (_key: string, fallback: string) => fallback }),
}));
vi.mock("@/navigation", () => ({
	Link: (props: ComponentProps<"a">) => <a {...props} />,
	useRouter: () => ({ back: vi.fn() }),
}));

afterEach(cleanup);

it("names the task while presence is pending without pretending the roster is empty", () => {
	render(<LocationPresenceLoading />);
	expect(screen.getAllByRole("heading", { level: 1 }).map((node) => node.textContent)).toEqual([
		"Who is in",
	]);
	expect(screen.getByRole("status", { name: "Loading location presence…" })).toBeTruthy();
	expect(screen.queryByRole("table")).toBeNull();
	expect(screen.queryByText(/Nobody you can see/)).toBeNull();
	expect(screen.getByRole("link", { name: "All locations" }).getAttribute("href")).toBe(
		"/team/presence",
	);
});

it("offers local Retry and the location selector after a read failure without exposing error details", () => {
	const retry = vi.fn();
	render(<LocationPresenceError error={new Error("private database details")} retry={retry} />);
	expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Presence unavailable");
	expect(screen.queryByText("private database details")).toBeNull();
	fireEvent.click(screen.getByRole("button", { name: "Retry" }));
	expect(retry).toHaveBeenCalledOnce();
	expect(screen.getByRole("link", { name: "All locations" }).getAttribute("href")).toBe(
		"/team/presence",
	);
});

it("keeps unavailable locations indistinguishable and returns to the authorized selector", () => {
	render(<LocationPresenceNotFound />);
	expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Location unavailable");
	expect(screen.queryByRole("table")).toBeNull();
	expect(screen.getByRole("link", { name: "All locations" }).getAttribute("href")).toBe(
		"/team/presence",
	);
});
