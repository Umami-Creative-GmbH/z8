/* @vitest-environment jsdom */

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TFormLabel } from "./tanstack-form";

describe("TanStack form UI helpers", () => {
	it("does not crash when a label is rendered without TFormItem", () => {
		render(<TFormLabel>Standalone label</TFormLabel>);

		expect(screen.getByText("Standalone label")).toBeTruthy();
	});
});
