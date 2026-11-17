// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { PageHeader } from "@/components/ui/page-header";
import { appPageOwnsHeading } from "@/lib/navigation/route-metadata";

it("gives only the period submissions route one task heading during arrival", () => {
	render(
		<>
			<header>
				{appPageOwnsHeading("/en/team/period-submissions") ? <p>Team</p> : <h1>Team</h1>}
			</header>
			<main>
				<PageHeader title="Period submissions" />
				<p role="status">Loading period submissions</p>
			</main>
		</>,
	);
	expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
	expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Period submissions");
	expect(appPageOwnsHeading("/de/team/period-submissions/")).toBe(true);
	expect(appPageOwnsHeading("/en/team/period-submissions/detail")).toBe(false);
	expect(appPageOwnsHeading("/en/team/presence")).toBe(false);
	expect(appPageOwnsHeading("/en/reports/projects")).toBe(true);
});
