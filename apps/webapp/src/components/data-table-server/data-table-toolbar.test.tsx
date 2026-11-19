/* @vitest-environment jsdom */
import { cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { render } from "@/test/render-with-translations";
import { DataTableToolbar } from "./data-table-toolbar";

afterEach(cleanup);

function ReportControls() {
	const [draft, setDraft] = useState("");
	const [period, setPeriod] = useState("2025");
	const [result, setResult] = useState("Not generated");
	return (
		<>
			<DataTableToolbar
				search={draft}
				onSearchChange={setDraft}
				searchLabel="Find projects"
				filterControls={
					<label>
						Report year
						<input
							value={period}
							onChange={(event) => setPeriod(event.target.value)}
						/>
					</label>
				}
				actions={
					<button
						type="button"
						onClick={() => setResult(`${draft}: ${period}`)}
					>
						Generate
					</button>
				}
			/>
			<output>{result}</output>
		</>
	);
}

describe("record toolbar", () => {
	it("names search and composes domain filters without executing a report before Generate", async () => {
		const user = userEvent.setup();
		render(<ReportControls />);
		await user.type(
			screen.getByRole("textbox", { name: "Find projects" }),
			"Website",
		);
		const period = screen.getByRole("textbox", { name: "Report year" });
		await user.clear(period);
		await user.type(period, "2026");
		expect(screen.getByRole("status").textContent).toBe("Not generated");
		await user.click(screen.getByRole("button", { name: "Generate" }));
		expect(screen.getByRole("status").textContent).toBe("Website: 2026");
	});
});
