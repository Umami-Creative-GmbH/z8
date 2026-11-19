/* @vitest-environment jsdom */

import { screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { render } from "@/test/render-with-translations";
import { LoadingRegion } from "./loading-region";

it("announces a pending region instead of presenting it as an empty result", () => {
	render(
		<LoadingRegion
			label={{ labelKey: "common.loading", labelDefault: "Loading" }}
		>
			<span aria-hidden="true">Placeholder</span>
		</LoadingRegion>,
	);
	const pending = screen.getByRole("status", { name: "Loading" });
	expect(pending.getAttribute("aria-busy")).toBe("true");
});

it("keeps a main landmark when the loading region is the page shell", () => {
	render(
		<LoadingRegion
			as="main"
			label={{ labelKey: "common.loading", labelDefault: "Loading" }}
		/>,
	);
	expect(
		screen.getByRole("main", { name: "Loading" }).getAttribute("aria-busy"),
	).toBe("true");
});
