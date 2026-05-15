/* @vitest-environment jsdom */

import { render, screen } from "@testing-library/react";
import type React from "react";
import { describe, expect, it, vi } from "vitest";
import { UserAvatar } from "./user-avatar";

vi.mock("@/lib/avatar", () => ({
	generateAvatarDataUri: vi.fn(({ seed }: { seed: string }) => `data:image/svg+xml,${seed}`),
	getInitials: vi.fn((name?: string | null) => (name ? name.slice(0, 2).toUpperCase() : "?")),
}));

vi.mock("@/components/ui/avatar", () => ({
	Avatar: ({ children, ...props }: React.HTMLAttributes<HTMLSpanElement>) => (
		<span {...props}>{children}</span>
	),
	AvatarFallback: ({ children, ...props }: React.HTMLAttributes<HTMLSpanElement>) => (
		<span {...props}>{children}</span>
	),
	AvatarImage: (props: React.ImgHTMLAttributes<HTMLImageElement>) => <img {...props} />,
}));

describe("UserAvatar", () => {
	it("renders a green status badge for clocked-in users", () => {
		render(<UserAvatar seed="user-1" name="Ada Lovelace" clockStatus="clocked-in" />);

		const badge = screen.getByLabelText("Clocked in");
		expect(badge.className).toContain("bg-emerald-500");
	});

	it("renders a red status badge for clocked-out users", () => {
		render(<UserAvatar seed="user-1" name="Ada Lovelace" clockStatus="clocked-out" />);

		const badge = screen.getByLabelText("Clocked out");
		expect(badge.className).toContain("bg-red-500");
	});

	it("does not render a status badge when status is unknown or omitted", () => {
		const { rerender } = render(
			<UserAvatar seed="user-1" name="Ada Lovelace" clockStatus="unknown" />,
		);

		expect(screen.queryByLabelText("Clocked in")).toBeNull();
		expect(screen.queryByLabelText("Clocked out")).toBeNull();

		rerender(<UserAvatar seed="user-1" name="Ada Lovelace" />);

		expect(screen.queryByLabelText("Clocked in")).toBeNull();
		expect(screen.queryByLabelText("Clocked out")).toBeNull();
	});

	it("keeps using uploaded images before generated fallbacks", () => {
		render(<UserAvatar seed="user-1" name="Ada Lovelace" image="https://example.com/avatar.png" />);

		const image = screen.getByAltText("Ada Lovelace") as HTMLImageElement;
		expect(image.getAttribute("src")).toBe("https://example.com/avatar.png");
	});
});
