/* @vitest-environment jsdom */

import { render, screen } from "@testing-library/react";
import { isValidElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import InitPage from "./page-client";

const translateMock = vi.hoisted(() => vi.fn());

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({ t: translateMock }),
}));

describe("InitPage", () => {
	beforeEach(() => {
		translateMock.mockImplementation(
			(_key: string, fallback: string) => fallback,
		);
	});

	it("provides a centered accessible workspace progress state", () => {
		translateMock.mockImplementation((key: string, fallback: string) =>
			key === "setup:init.checking"
				? "Arbeitsbereich wird initialisiert"
				: fallback,
		);
		const page = InitPage();
		if (!isValidElement<{ fallback: React.ReactNode }>(page)) {
			throw new Error("Expected InitPage to return a React element");
		}

		render(page.props.fallback);

		expect(
			screen.getByRole("status", { name: "Arbeitsbereich wird initialisiert" }),
		).toBeTruthy();
		expect(screen.getByText("Arbeitsbereich wird initialisiert")).toBeTruthy();
		expect(translateMock).toHaveBeenCalledWith(
			"setup:init.checking",
			"Checking session...",
		);
		const loadingClassName = screen.getByTestId("init-page-loading").className;
		expect(loadingClassName).toContain("min-h-screen");
		expect(loadingClassName).toContain("items-center");
		expect(loadingClassName).toContain("justify-center");
	});
});
