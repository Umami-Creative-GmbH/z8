/* @vitest-environment jsdom */

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, defaultValue?: string) => defaultValue ?? _key,
	}),
}));

vi.mock("next/image", () => ({
	default: ({ alt, src }: { alt: string; src: string }) => <img alt={alt} src={src} />,
}));

import { AuthFormWrapper } from "./auth-form-wrapper";

describe("AuthFormWrapper", () => {
	it("renders the simpler auth shell without the process rail", () => {
		render(
			<AuthFormWrapper title="Create your account">
				<div>form body</div>
			</AuthFormWrapper>,
		);

		expect(screen.getByText("z8")).toBeTruthy();
		expect(screen.getByText("Create your account")).toBeTruthy();
		expect(screen.queryByText("Operationally ready from the first login")).toBeNull();
		expect(screen.queryByText("Capture")).toBeNull();
	});
});
