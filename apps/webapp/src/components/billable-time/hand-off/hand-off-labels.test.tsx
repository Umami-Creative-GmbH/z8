/* @vitest-environment jsdom */

import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CHANGED_FIELDS } from "@/lib/billable-time/hand-off/views";
import { render } from "@/test/render-with-translations";
import { useHandOffLabels } from "./hand-off-labels";

vi.mock("@/hooks/use-display-context", () => ({
	useDisplayContext: () => ({ locale: "en-US", timezone: "UTC", timeFormat: "24h" }),
}));

function ChangedFieldBadges() {
	const labels = useHandOffLabels();
	return (
		<ul>
			{CHANGED_FIELDS.map((field) => (
				<li key={field}>{labels.changedField(field)}</li>
			))}
		</ul>
	);
}

describe("changed field labels", () => {
	it("names every changed field, the customer change included (#1500)", () => {
		render(<ChangedFieldBadges />);

		expect(screen.getAllByRole("listitem").map((item) => item.textContent)).toEqual([
			"Times",
			"Project",
			"Billability",
			"Deleted",
			"Split",
			"Customer",
		]);
	});
});
