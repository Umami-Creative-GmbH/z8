/* @vitest-environment jsdom */

import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { expect, it } from "vitest";
import { PageHeader } from "./page-header";

function Page() {
	const [scope, setScope] = useState("My records · November");
	return (
		<>
			<PageHeader
				title="Employee Reports"
				scope={scope}
				description="Choose a period to generate a report."
				actions={
					<button
						type="button"
						onClick={() => setScope("My records · December")}
					>
						Next month
					</button>
				}
			/>
			<input aria-label="Report note" defaultValue="Prepared note" />
		</>
	);
}

it("keeps task, scope and a working action together without owning the page draft", () => {
	render(<Page />);
	expect(
		screen
			.getAllByRole("heading", { level: 1 })
			.map((heading) => heading.textContent),
	).toEqual(["Employee Reports"]);
	expect(screen.getByText("My records · November")).toBeTruthy();
	fireEvent.change(screen.getByLabelText("Report note"), {
		target: { value: "Keep my edit" },
	});
	fireEvent.click(screen.getByRole("button", { name: "Next month" }));
	expect(screen.getByText("My records · December")).toBeTruthy();
	expect((screen.getByLabelText("Report note") as HTMLInputElement).value).toBe(
		"Keep my edit",
	);
});
