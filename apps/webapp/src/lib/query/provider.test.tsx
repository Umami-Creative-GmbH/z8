/* @vitest-environment jsdom */

import { useMutation, useQuery } from "@tanstack/react-query";
import { render, waitFor } from "@testing-library/react";
import { UnrecognizedActionError } from "next/dist/client/components/unrecognized-action-error";
import { useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	toast: vi.fn(),
	replace: vi.fn(),
}));

vi.mock("sonner", () => ({ toast: mocks.toast }));
vi.mock("@tanstack/react-query-devtools", () => ({ ReactQueryDevtools: () => null }));
vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({ t: (_key: string, fallback: string) => fallback }),
}));
vi.mock("next/navigation", async (importOriginal) => ({
	...(await importOriginal<typeof import("next/navigation")>()),
	useRouter: () => ({ replace: mocks.replace }),
}));

import { QueryProvider } from "./provider";

const skewError = () =>
	new UnrecognizedActionError('Server Action "7f3a" was not found on the server.');

function FailingMutation() {
	const mutation = useMutation({ mutationFn: async () => Promise.reject(skewError()) });
	useEffect(() => {
		mutation.mutate();
	}, [mutation.mutate]);
	return null;
}

function FailingQuery() {
	useQuery({ queryKey: ["skew"], queryFn: () => Promise.reject(skewError()), retry: false });
	return null;
}

function expectUpdateToast() {
	expect(mocks.toast).toHaveBeenCalledTimes(1);
	expect(mocks.toast).toHaveBeenCalledWith(
		"Z8 was updated",
		expect.objectContaining({
			description: "Reload the page to continue. Your last action was not saved.",
			duration: Infinity,
			action: expect.objectContaining({ label: "Reload" }),
		}),
	);
}

describe("QueryProvider server action version skew", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("asks the user to reload once when queries and mutations hit an old deployment", async () => {
		render(
			<QueryProvider>
				<FailingMutation />
				<FailingQuery />
			</QueryProvider>,
		);

		await waitFor(() => expectUpdateToast());
	});

	it("asks the user to reload when a direct server action call rejects unhandled", async () => {
		render(<QueryProvider>{null}</QueryProvider>);

		const event = new Event("unhandledrejection") as PromiseRejectionEvent;
		Object.assign(event, { reason: skewError() });
		window.dispatchEvent(event);

		await waitFor(() => expectUpdateToast());
	});

	it("does not retry mutations that failed because of version skew", async () => {
		const mutationFn = vi.fn(async () => Promise.reject(skewError()));
		function CountingMutation() {
			const mutation = useMutation({ mutationFn });
			useEffect(() => {
				mutation.mutate();
			}, [mutation.mutate]);
			return null;
		}

		render(
			<QueryProvider>
				<CountingMutation />
			</QueryProvider>,
		);

		await waitFor(() => expectUpdateToast());
		expect(mutationFn).toHaveBeenCalledTimes(1);
	});
});
