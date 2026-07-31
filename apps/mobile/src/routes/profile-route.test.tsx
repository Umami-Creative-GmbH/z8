import React from "react";
// @ts-expect-error react-dom server types are not installed in the mobile package.
import { renderToStaticMarkup } from "react-dom/server";

const {
	invalidateQueries,
	setQueryData,
	switchOrganizationMutateAsync,
	signOutMutateAsync,
	useMobileSession,
	useMobileSessionController,
	useMutation,
} = vi.hoisted(() => ({
	invalidateQueries: vi.fn().mockResolvedValue(undefined),
	setQueryData: vi.fn(),
	switchOrganizationMutateAsync: vi.fn(),
	signOutMutateAsync: vi.fn(),
	useMobileSession: vi.fn(),
	useMobileSessionController: vi.fn(),
	useMutation: vi.fn(),
}));

let profileScreenProps: {
	onSignOut: () => Promise<void>;
	onSwitchOrganization: (organizationId: string) => Promise<void>;
};

vi.mock("@tanstack/react-query", () => ({
	useMutation,
	useQueryClient: () => ({ invalidateQueries, setQueryData }),
}));

vi.mock("expo-router", () => ({
	Redirect: ({ href }: { href: string }) =>
		React.createElement("Redirect", { href }),
}));

vi.mock("@/src/features/profile/profile-screen", () => ({
	ProfileScreen: (props: typeof profileScreenProps) => {
		profileScreenProps = props;
		return React.createElement("div", {}, "Profile screen");
	},
}));

vi.mock("@/src/features/session/mobile-session-error-state", () => ({
	MobileSessionErrorState: () =>
		React.createElement("div", {}, "Session error"),
}));

vi.mock("@/src/features/session/use-mobile-session", () => ({
	MOBILE_SESSION_QUERY_KEY: ["mobile-session"],
	useMobileSession,
	useMobileSessionController,
}));

vi.mock("@/src/lib/config", () => ({
	getWebappUrl: () => "https://example.com",
}));

import ProfileRoute from "../../app/(app)/profile";

describe("Profile route mutations", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		useMobileSession.mockReturnValue({
			data: {
				token: "token",
				activeOrganizationId: "org-1",
				organizations: [],
				user: { id: "user-1", name: "User", email: "user@example.com" },
			},
			isError: false,
			isLoading: false,
			refetch: vi.fn(),
		});
		useMobileSessionController.mockReturnValue({ signOut: vi.fn() });

		useMutation
			.mockReturnValueOnce({
				isPending: false,
				mutateAsync: switchOrganizationMutateAsync,
			})
			.mockReturnValueOnce({
				isPending: false,
				mutateAsync: signOutMutateAsync,
			});

		renderToStaticMarkup(React.createElement(ProfileRoute));
	});

	it("invalidates the exact mobile session query after a successful organization switch", async () => {
		const switchMutation = useMutation.mock.calls[0]?.[0];
		vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));

		await switchMutation.mutationFn("org-2");
		await switchMutation.onSuccess(undefined, "org-2");

		expect(invalidateQueries).toHaveBeenCalledWith({
			exact: true,
			queryKey: ["mobile-session"],
		});
	});

	it("does not invalidate session data when switching organizations fails", async () => {
		const switchMutation = useMutation.mock.calls[0]?.[0];
		vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));

		await expect(switchMutation.mutationFn("org-2")).rejects.toThrow(
			"Failed to switch organization",
		);

		expect(invalidateQueries).not.toHaveBeenCalled();
	});

	it("updates the exact mobile session query after a successful sign-out", async () => {
		const signOutMutation = useMutation.mock.calls[1]?.[0];

		await signOutMutation.onSuccess();

		expect(setQueryData).toHaveBeenCalledWith(["mobile-session"], null);
	});

	it("handles a rejected organization switch mutation promise", async () => {
		switchOrganizationMutateAsync.mockRejectedValue(new Error("switch failed"));

		await expect(
			profileScreenProps.onSwitchOrganization("org-2"),
		).resolves.toBeUndefined();
	});

	it("handles a rejected sign-out mutation promise", async () => {
		signOutMutateAsync.mockRejectedValue(new Error("sign out failed"));

		await expect(profileScreenProps.onSignOut()).resolves.toBeUndefined();
	});
});
