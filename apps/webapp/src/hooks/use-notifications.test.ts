import { beforeEach, describe, expect, it, vi } from "vitest";

const useQueryMock = vi.fn();
const useMutationMock = vi.fn();
const invalidateQueriesMock = vi.fn();

vi.mock("@tanstack/react-query", () => ({
	useMutation: useMutationMock,
	useQuery: useQueryMock,
	useQueryClient: () => ({ invalidateQueries: invalidateQueriesMock }),
}));

vi.mock("@/lib/fetch", () => ({
	fetchApi: vi.fn(),
}));

vi.mock("react", async (importOriginal) => ({
	...(await importOriginal<typeof import("react")>()),
	useCallback: (callback: unknown) => callback,
}));

describe("useNotifications", () => {
	beforeEach(() => {
		useQueryMock.mockReset();
		useMutationMock.mockReset();
		invalidateQueriesMock.mockReset();

		useQueryMock.mockReturnValue({
			data: undefined,
			isError: false,
			isFetching: false,
			isLoading: false,
		});
		useMutationMock.mockReturnValue({
			isPending: false,
			mutateAsync: vi.fn(),
		});
	});

	it("includes every list fetch option in the notification list query key", async () => {
		const { useNotifications } = await import("./use-notifications");

		useNotifications({ limit: 100, unreadOnly: true, organizationId: "org-a" });

		expect(useQueryMock).toHaveBeenNthCalledWith(
			1,
			expect.objectContaining({
				queryKey: [
					"notifications",
					"list",
					{ limit: 100, unreadOnly: true, organizationId: "org-a" },
				],
			}),
		);
	});

	it("includes organization in the unread count query key", async () => {
		const { useNotifications } = await import("./use-notifications");

		useNotifications({ organizationId: "org-a" });

		expect(useQueryMock).toHaveBeenNthCalledWith(
			2,
			expect.objectContaining({
				queryKey: ["notifications", "unread-count", "org-a"],
			}),
		);
	});

	it("polls the notification list every 20 minutes", async () => {
		const { useNotifications } = await import("./use-notifications");

		useNotifications({ organizationId: "org-a" });

		expect(useQueryMock).toHaveBeenNthCalledWith(
			1,
			expect.objectContaining({
				refetchInterval: 20 * 60 * 1000,
				refetchOnWindowFocus: true,
			}),
		);
	});

	it("polls the unread count every 20 minutes", async () => {
		const { useNotifications } = await import("./use-notifications");

		useNotifications({ organizationId: "org-a" });

		expect(useQueryMock).toHaveBeenNthCalledWith(
			2,
			expect.objectContaining({
				refetchInterval: 20 * 60 * 1000,
				refetchOnWindowFocus: true,
			}),
		);
	});
});
