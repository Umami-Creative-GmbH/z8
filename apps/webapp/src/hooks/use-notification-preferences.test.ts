import { beforeEach, describe, expect, it, vi } from "vitest";

const useQueryMock = vi.fn();
const useMutationMock = vi.fn();
const useQueryClientMock = vi.fn();
const useSessionMock = vi.fn();

vi.mock("@tanstack/react-query", () => ({
	useMutation: useMutationMock,
	useQuery: useQueryMock,
	useQueryClient: useQueryClientMock,
}));

vi.mock("@/app/[locale]/(app)/settings/notifications/actions", () => ({
	bulkUpdateNotificationPreferences: vi.fn(),
	getNotificationPreferences: vi.fn(),
	updateNotificationPreference: vi.fn(),
}));

vi.mock("@/lib/auth-client", () => ({
	useSession: useSessionMock,
}));

describe("useNotificationPreferences", () => {
	const cancelQueriesMock = vi.fn();
	const getQueriesDataMock = vi.fn();
	const getQueryDataMock = vi.fn();
	const invalidateQueriesMock = vi.fn();
	const setQueriesDataMock = vi.fn();
	const setQueryDataMock = vi.fn();

	beforeEach(() => {
		useQueryMock.mockReset();
		useMutationMock.mockReset();
		useQueryClientMock.mockReset();
		useSessionMock.mockReset();
		cancelQueriesMock.mockReset();
		getQueriesDataMock.mockReset();
		getQueryDataMock.mockReset();
		invalidateQueriesMock.mockReset();
		setQueriesDataMock.mockReset();
		setQueryDataMock.mockReset();

		useQueryClientMock.mockReturnValue({
			cancelQueries: cancelQueriesMock,
			getQueriesData: getQueriesDataMock,
			getQueryData: getQueryDataMock,
			invalidateQueries: invalidateQueriesMock,
			setQueriesData: setQueriesDataMock,
			setQueryData: setQueryDataMock,
		});
		useSessionMock.mockReturnValue({ data: null });
		useMutationMock.mockReturnValue({
			isPending: false,
			mutate: vi.fn(),
			mutateAsync: vi.fn(),
		});
	});

	it("returns safe default channel availability while preferences are unavailable", async () => {
		useQueryMock.mockReturnValue({ data: undefined, error: null, isLoading: true });
		const { useNotificationPreferences } = await import("./use-notification-preferences");

		const result = useNotificationPreferences();

		expect(result.availableChannels).toEqual({
			in_app: true,
			push: true,
			email: true,
			teams: false,
			telegram: false,
			discord: false,
			slack: false,
		});
	});

	it("returns server-provided channel availability", async () => {
		const availableChannels = {
			in_app: true,
			push: false,
			email: true,
			teams: true,
			telegram: false,
			discord: true,
			slack: false,
		};
		useQueryMock.mockReturnValue({
			data: { availableChannels, matrix: null, preferences: [] },
			error: null,
			isLoading: false,
		});
		const { useNotificationPreferences } = await import("./use-notification-preferences");

		const result = useNotificationPreferences();

		expect(result.availableChannels).toBe(availableChannels);
	});

	it("scopes the preferences query key by active organization", async () => {
		useSessionMock.mockReturnValue({
			data: { session: { activeOrganizationId: "org-a" } },
		});
		useQueryMock.mockReturnValue({ data: undefined, error: null, isLoading: true });
		const { useNotificationPreferences } = await import("./use-notification-preferences");

		useNotificationPreferences();

		expect(useQueryMock).toHaveBeenCalledWith(
			expect.objectContaining({
				queryKey: ["notifications", "preferences", "org-a"],
			}),
		);
	});

	it("optimistically updates every cached organization preference matrix", async () => {
		useSessionMock.mockReturnValue({
			data: { session: { activeOrganizationId: "org-a" } },
		});
		getQueriesDataMock.mockReturnValue([
			[["notifications", "preferences", "org-a"], { preferences: [] }],
			[["notifications", "preferences", "org-b"], { preferences: [] }],
		]);
		useQueryMock.mockReturnValue({ data: undefined, error: null, isLoading: false });
		const { useNotificationPreferences } = await import("./use-notification-preferences");

		useNotificationPreferences();
		const updateMutation = useMutationMock.mock.calls[0][0];
		await updateMutation.onMutate({
			channel: "email",
			enabled: false,
			notificationType: "approval_request_submitted",
		});

		expect(cancelQueriesMock).toHaveBeenCalledWith({
			queryKey: ["notifications", "preferences"],
		});
		expect(getQueriesDataMock).toHaveBeenCalledWith({
			queryKey: ["notifications", "preferences"],
		});
		expect(setQueriesDataMock).toHaveBeenCalledWith(
			{ queryKey: ["notifications", "preferences"] },
			expect.any(Function),
		);

		const updatePreferences = setQueriesDataMock.mock.calls[0][1];
		expect(
			updatePreferences({
				availableChannels: { email: true },
				matrix: {
					approval_request_submitted: {
						email: true,
						in_app: true,
					},
				},
				preferences: [],
			}),
		).toEqual({
			availableChannels: { email: true },
			matrix: {
				approval_request_submitted: {
					email: false,
					in_app: true,
				},
			},
			preferences: [],
		});
	});

	it("rolls back every snapshotted organization preference cache", async () => {
		const orgAPreferences = { preferences: [] };
		const orgBPreferences = { preferences: [] };
		getQueriesDataMock.mockReturnValue([
			[["notifications", "preferences", "org-a"], orgAPreferences],
			[["notifications", "preferences", "org-b"], orgBPreferences],
		]);
		useQueryMock.mockReturnValue({ data: undefined, error: null, isLoading: false });
		const { useNotificationPreferences } = await import("./use-notification-preferences");

		useNotificationPreferences();
		const updateMutation = useMutationMock.mock.calls[0][0];
		const context = await updateMutation.onMutate({
			channel: "email",
			enabled: false,
			notificationType: "approval_request_submitted",
		});
		updateMutation.onError(new Error("failed"), undefined, context);

		expect(setQueryDataMock).toHaveBeenCalledWith(
			["notifications", "preferences", "org-a"],
			orgAPreferences,
		);
		expect(setQueryDataMock).toHaveBeenCalledWith(
			["notifications", "preferences", "org-b"],
			orgBPreferences,
		);
	});

	it("invalidates every organization preference cache after mutations", async () => {
		useSessionMock.mockReturnValue({
			data: { session: { activeOrganizationId: "org-a" } },
		});
		useQueryMock.mockReturnValue({ data: undefined, error: null, isLoading: false });
		const { useNotificationPreferences } = await import("./use-notification-preferences");

		useNotificationPreferences();
		const updateMutation = useMutationMock.mock.calls[0][0];
		const bulkMutation = useMutationMock.mock.calls[1][0];
		updateMutation.onSettled();
		bulkMutation.onSuccess();

		expect(invalidateQueriesMock).toHaveBeenCalledTimes(2);
		expect(invalidateQueriesMock).toHaveBeenNthCalledWith(1, {
			queryKey: ["notifications", "preferences"],
		});
		expect(invalidateQueriesMock).toHaveBeenNthCalledWith(2, {
			queryKey: ["notifications", "preferences"],
		});
	});
});
