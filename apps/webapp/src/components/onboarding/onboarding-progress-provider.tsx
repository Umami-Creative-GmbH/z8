"use client";

import {
	createContext,
	type ReactNode,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { getOnboardingIsAdmin } from "@/app/[locale]/onboarding/actions";
import { useSession } from "@/lib/auth-client";

interface OnboardingProgressContextValue {
	isAdmin: boolean;
	refreshIsAdmin: () => Promise<void>;
}

const noopRefresh = async () => {};

const OnboardingProgressContext = createContext<OnboardingProgressContextValue>({
	isAdmin: false,
	refreshIsAdmin: noopRefresh,
});

function scopeKeyOf(userId: string | null | undefined, organizationId: string | null | undefined) {
	if (!userId) return null;
	return `${userId}:${organizationId ?? ""}`;
}

export function OnboardingProgressProvider({
	children,
	initialIsAdmin,
	initialUserId = null,
	initialOrganizationId = null,
}: {
	children: ReactNode;
	initialIsAdmin: boolean;
	initialUserId?: string | null;
	initialOrganizationId?: string | null;
}) {
	const { data: session, isPending } = useSession();
	const [isAdmin, setIsAdmin] = useState(initialIsAdmin);
	const requestSequence = useRef(0);
	const mounted = useRef(true);
	const lastSyncedScope = useRef<string | null>(scopeKeyOf(initialUserId, initialOrganizationId));

	const userId = session?.user?.id ?? null;
	const organizationId = session?.session?.activeOrganizationId ?? null;
	const currentScope = scopeKeyOf(userId, organizationId);

	useEffect(() => {
		mounted.current = true;
		return () => {
			mounted.current = false;
			requestSequence.current += 1;
		};
	}, []);

	const refreshIsAdmin = useCallback(async () => {
		const requestId = ++requestSequence.current;
		try {
			const result = await getOnboardingIsAdmin();
			if (!mounted.current || requestSequence.current !== requestId) return;
			setIsAdmin(result.success ? result.data : false);
		} catch {
			if (!mounted.current || requestSequence.current !== requestId) return;
			setIsAdmin(false);
		}
	}, []);

	useEffect(() => {
		if (isPending) return;
		if (!currentScope) {
			requestSequence.current += 1;
			lastSyncedScope.current = null;
			return;
		}
		if (currentScope === lastSyncedScope.current) return;
		lastSyncedScope.current = currentScope;
		const requestId = ++requestSequence.current;
		let cancelled = false;
		void getOnboardingIsAdmin()
			.then((result) => {
				if (cancelled || !mounted.current || requestSequence.current !== requestId) return;
				setIsAdmin(result.success ? result.data : false);
			})
			.catch(() => {
				if (cancelled || !mounted.current || requestSequence.current !== requestId) return;
				setIsAdmin(false);
			});
		return () => {
			cancelled = true;
		};
	}, [currentScope, isPending]);

	const effectiveIsAdmin = !isPending && !currentScope ? false : isAdmin;

	const value = useMemo(
		() => ({
			isAdmin: effectiveIsAdmin,
			refreshIsAdmin,
		}),
		[effectiveIsAdmin, refreshIsAdmin],
	);

	return (
		<OnboardingProgressContext.Provider value={value}>
			{children}
		</OnboardingProgressContext.Provider>
	);
}

export function useOnboardingIsAdmin(): boolean {
	return useContext(OnboardingProgressContext).isAdmin;
}

export function useRefreshOnboardingIsAdmin(): () => Promise<void> {
	return useContext(OnboardingProgressContext).refreshIsAdmin;
}
