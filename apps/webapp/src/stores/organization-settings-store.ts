"use client";

import { createContext, createElement, type ReactNode, use, useRef } from "react";
import { useStore } from "zustand";
import { createStore, type StoreApi } from "zustand/vanilla";

export interface OrganizationSettings {
	organizationId: string | null;
	shiftsEnabled: boolean;
	projectsEnabled: boolean;
	surchargesEnabled: boolean;
	demoDataEnabled: boolean;
	worksCouncilEnabled: boolean;
	timezone: string;
	deletedAt: string | null;
	isHydrated: boolean;
}

export type OrganizationSettingsBootstrap = Omit<OrganizationSettings, "isHydrated">;

interface OrganizationSettingsActions {
	setSettings: (settings: Partial<Omit<OrganizationSettings, "isHydrated">>) => void;
	hydrate: (settings: Omit<OrganizationSettings, "isHydrated">) => void;
	reset: () => void;
}

export type OrganizationSettingsStore = OrganizationSettings & OrganizationSettingsActions;

const initialState: OrganizationSettings = {
	organizationId: null,
	shiftsEnabled: false,
	projectsEnabled: false,
	surchargesEnabled: false,
	demoDataEnabled: true,
	worksCouncilEnabled: false,
	timezone: "UTC",
	deletedAt: null,
	isHydrated: false,
};

function createOrganizationSettingsStore(initialSettings?: OrganizationSettingsBootstrap | null) {
	return createStore<OrganizationSettingsStore>((set) => ({
		...initialState,
		...(initialSettings ?? {}),
		isHydrated: Boolean(initialSettings),

		setSettings: (settings) =>
			set((state) => ({
				...state,
				...settings,
			})),

		hydrate: (settings) =>
			set({
				...settings,
				isHydrated: true,
			}),

		reset: () => set(initialState),
	}));
}

const defaultStore = createOrganizationSettingsStore();
const OrganizationSettingsStoreContext = createContext<
	StoreApi<OrganizationSettingsStore> | undefined
>(undefined);

export function OrganizationSettingsStoreProvider({
	children,
	initialSettings,
}: {
	children: ReactNode;
	initialSettings?: OrganizationSettingsBootstrap | null;
}) {
	const storeRef = useRef<StoreApi<OrganizationSettingsStore> | null>(null);
	if (!storeRef.current) {
		storeRef.current = createOrganizationSettingsStore(initialSettings);
	}

	return createElement(
		OrganizationSettingsStoreContext.Provider,
		{ value: storeRef.current },
		children,
	);
}

function useOrganizationSettingsStore(): OrganizationSettingsStore;
function useOrganizationSettingsStore<T>(selector: (state: OrganizationSettingsStore) => T): T;
function useOrganizationSettingsStore<T>(
	selector?: (state: OrganizationSettingsStore) => T,
): T | OrganizationSettingsStore {
	const store = use(OrganizationSettingsStoreContext) ?? defaultStore;
	const resolvedSelector: (state: OrganizationSettingsStore) => T | OrganizationSettingsStore =
		selector ?? ((state) => state);
	return useStore(store, resolvedSelector);
}

export const useOrganizationSettings = Object.assign(useOrganizationSettingsStore, {
	getState: defaultStore.getState,
	setState: defaultStore.setState,
	subscribe: defaultStore.subscribe,
});

// Selector hooks for specific settings
export const useProjectsEnabled = () => useOrganizationSettings((state) => state.projectsEnabled);
export const useShiftsEnabled = () => useOrganizationSettings((state) => state.shiftsEnabled);
export const useSurchargesEnabled = () =>
	useOrganizationSettings((state) => state.surchargesEnabled);
export const useDemoDataEnabled = () => useOrganizationSettings((state) => state.demoDataEnabled);
export const useWorksCouncilEnabled = () =>
	useOrganizationSettings((state) => state.worksCouncilEnabled);
export const useOrganizationTimezone = () => useOrganizationSettings((state) => state.timezone);
export const useOrganizationDeletedAt = () => useOrganizationSettings((state) => state.deletedAt);
