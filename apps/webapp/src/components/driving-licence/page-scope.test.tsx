// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

const remote = vi.hoisted(() => ({ organizationId: "old", userId: "viewer" }));
vi.mock("@/lib/auth-client", () => ({
	useSession: () => ({
		data: {
			session: { activeOrganizationId: remote.organizationId },
			user: { id: remote.userId },
		},
	}),
}));
vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({ t: (_: string, fallback: string) => fallback }),
}));

import {
	DrivingLicencePageLoading,
	DrivingLicencePageScope,
} from "./page-scope";

afterEach(() => {
	cleanup();
	remote.organizationId = "old";
	remote.userId = "viewer";
});
it("names the route during streamed first arrival without exposing role panels", () => {
	render(<DrivingLicencePageLoading kind="team" />);
	expect(
		screen.getAllByRole("heading", { level: 1 }).map((n) => n.textContent),
	).toEqual(["Driving licences"]);
	expect(screen.getByRole("status")).toBeTruthy();
	expect(screen.queryByRole("button")).toBeNull();
});
it("withdraws old role panels and action targets while the new organization render is pending", () => {
	const view = render(
		<DrivingLicencePageScope kind="my" organizationId="old" userId="viewer">
			<button type="button">Report impediment</button>
		</DrivingLicencePageScope>,
	);
	expect(
		screen.getByRole("button", { name: "Report impediment" }),
	).toBeTruthy();
	remote.organizationId = "new";
	view.rerender(
		<DrivingLicencePageScope kind="my" organizationId="old" userId="viewer">
			<button type="button">Report impediment</button>
		</DrivingLicencePageScope>,
	);
	expect(screen.queryByRole("button")).toBeNull();
	expect(screen.getByRole("status")).toBeTruthy();
	view.rerender(
		<DrivingLicencePageScope kind="my" organizationId="new" userId="viewer">
			<p>New organization</p>
		</DrivingLicencePageScope>,
	);
	expect(screen.getByText("New organization")).toBeTruthy();
});
it("withdraws the old snapshot after identity loss", () => {
	remote.userId = "";
	render(
		<DrivingLicencePageScope kind="my" organizationId="old" userId="viewer">
			<p>Private record</p>
		</DrivingLicencePageScope>,
	);
	expect(screen.queryByText("Private record")).toBeNull();
});
