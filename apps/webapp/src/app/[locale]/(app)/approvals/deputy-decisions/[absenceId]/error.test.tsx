/* @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, expect, it, vi } from "vitest";
import DeputyDecisionsError from "./error";

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({ t: (_key: string, fallback: string) => fallback }),
}));
vi.mock("@/navigation", () => ({
	Link: (props: ComponentProps<"a">) => <a {...props} />,
	useRouter: () => ({ back: vi.fn() }),
}));
afterEach(cleanup);

it("refetches failed history through Next retry and keeps private errors out of the page", () => {
	const retry = vi.fn();
	render(
		<DeputyDecisionsError
			error={new Error("private database query")}
			retry={retry}
		/>,
	);
	expect(
		screen.getByRole("heading", { level: 1, name: "Something went wrong" }),
	).toBeTruthy();
	expect(screen.queryByText(/private database/)).toBeNull();
	fireEvent.click(screen.getByRole("button", { name: "Retry" }));
	expect(retry).toHaveBeenCalledOnce();
});
