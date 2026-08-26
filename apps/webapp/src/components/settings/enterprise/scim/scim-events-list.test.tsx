/* @vitest-environment jsdom */

import { render } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { ScimEventsList } from "./scim-events-list";

vi.mock("@tolgee/react", () => ({
	useTolgee: () => ({ getLanguage: () => "en-US" }),
	useTranslate: () => ({ t: (_key: string, fallback: string) => fallback }),
}));

it("formats provisioning event timestamps with the selected locale in UTC", () => {
	const originalFormatter = Intl.DateTimeFormat;
	const formatter = vi.fn(function (...args: any[]) {
		return new originalFormatter(...args);
	});
	vi.stubGlobal("Intl", { ...Intl, DateTimeFormat: formatter });

	render(
		<ScimEventsList
			error={false}
			events={
				[{ type: "user.created", createdAt: "2026-01-02T03:04:00.000Z" }] as any
			}
		/>,
	);

	expect(formatter).toHaveBeenCalledWith("en-US", {
		dateStyle: "medium",
		timeStyle: "short",
		timeZone: "UTC",
	});
});
