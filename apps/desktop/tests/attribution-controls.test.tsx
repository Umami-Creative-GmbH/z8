import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ClosingAttributionFields } from "../src/components/ClosingAttributionFields";
import { useClosingAttribution } from "../src/hooks/useClosingAttribution";
import type { DesktopContext, ClosingAttribution } from "../src/types";

afterEach(cleanup);
const context: DesktopContext = {
	userId: "user",
	organizationId: "org",
	employeeId: "employee",
	timezone: "Europe/Berlin",
	locale: "en",
	fetchedAt: "2026-10-09T08:00:00Z",
	cached: false,
	dayTotalBasis: {
		timezone: "Europe/Berlin",
		completedMinutesByDate: {},
		liveWork: [],
	},
	projects: [],
	categories: [],
	liveWork: null,
};
function Controls({
	context,
	onRead,
}: {
	context: DesktopContext;
	onRead?: (value: ClosingAttribution) => void;
}) {
	const attribution = useClosingAttribution(context);
	return (
		<>
			<ClosingAttributionFields
				form={attribution.form}
				context={context}
				disabled={false}
			/>
			<button type="button" onClick={() => onRead?.(attribution.value())}>
				Read assignment
			</button>
		</>
	);
}
describe("tenant attribution controls", () => {
	it("omits the entire assignment section when neither feature is available", () => {
		render(<Controls context={context} />);
		expect(screen.queryByRole("combobox")).toBeNull();
		expect(screen.queryByText("Applied when work ends")).toBeNull();
	});
	it("hides projects when the tenant has disabled them, even with old assignments", () => {
		render(
			<Controls
				context={{
					...context,
					projectsEnabled: false,
					projects: [{ id: "project", name: "Old project" }],
				}}
			/>,
		);
		expect(screen.queryByLabelText("Project")).toBeNull();
	});
	it("shows available categories independently of project tracking", () => {
		render(
			<Controls
				context={{
					...context,
					projectsEnabled: false,
					categories: [{ id: "category", name: "Support" }],
				}}
			/>,
		);
		expect(screen.getByLabelText("Work category")).toBeDefined();
		expect(screen.queryByLabelText("Project")).toBeNull();
	});
	it("preserves assignments if a feature becomes unavailable before closing work", async () => {
		let assignment: ClosingAttribution | undefined;
		const onRead = (value: ClosingAttribution) => {
			assignment = value;
		};
		const { rerender } = render(
			<Controls
				context={{
					...context,
					projectsEnabled: true,
					projects: [{ id: "project", name: "Current project" }],
				}}
				onRead={onRead}
			/>,
		);
		await userEvent.selectOptions(screen.getByLabelText("Project"), "project");
		rerender(
			<Controls
				context={{ ...context, projectsEnabled: false }}
				onRead={onRead}
			/>,
		);
		await userEvent.click(screen.getByText("Read assignment"));
		expect(assignment).toEqual({
			project: { kind: "preserve" },
			workCategory: { kind: "preserve" },
		});
	});
});
