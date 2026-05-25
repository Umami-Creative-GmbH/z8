/* @vitest-environment jsdom */

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { FontSizeToggle } from "./font-size-toggle";

const mockFontSizeState = vi.hoisted(() => ({
	fontSize: "default",
	setFontSize: vi.fn(),
}));

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({ t: (_key: string, defaultValue?: string) => defaultValue ?? _key }),
}));

vi.mock("./font-size-preference", async () => {
	const actual = await vi.importActual<typeof import("./font-size-preference")>(
		"./font-size-preference",
	);
	return {
		...actual,
		useFontSizePreference: () => mockFontSizeState,
	};
});

vi.mock("@/components/ui/dropdown-menu", () => {
	let onRadioValueChange: ((value: string) => void) | undefined;

	return {
		DropdownMenu: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
		DropdownMenuContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
		DropdownMenuRadioGroup: ({
			children,
			onValueChange,
		}: {
			children: React.ReactNode;
			onValueChange?: (value: string) => void;
		}) => {
			onRadioValueChange = onValueChange;
			return <div>{children}</div>;
		},
		DropdownMenuRadioItem: ({
			children,
			onClick,
			value,
		}: React.ComponentProps<"button"> & { value: string }) => (
			<button
				type="button"
				onClick={(event) => {
					onClick?.(event);
					onRadioValueChange?.(value);
				}}
			>
				{children}
			</button>
		),
		DropdownMenuTrigger: ({ children }: { children: React.ReactNode }) => (
			<div>{children}</div>
		),
	};
});

describe("FontSizeToggle", () => {
	it("renders an accessible icon trigger and all choices", () => {
		render(<FontSizeToggle />);

		expect(screen.getByRole("button", { name: "Font size" })).toBeTruthy();
		expect(screen.getByRole("button", { name: "Default" })).toBeTruthy();
		expect(screen.getByRole("button", { name: "Comfortable" })).toBeTruthy();
		expect(screen.getByRole("button", { name: "Large" })).toBeTruthy();
	});

	it("updates the preference when a choice is selected", () => {
		render(<FontSizeToggle />);

		fireEvent.click(screen.getByRole("button", { name: "Large" }));

		expect(mockFontSizeState.setFontSize).toHaveBeenCalledWith("large");
	});
});
