"use client";

import { create } from "zustand";

export interface OrganizationSettings {
	organizationId: string | null;
	shiftsEnabled: boolean;
	projectsEnabled: boolean;
	surchargesEnabled: boolean;
	timezone: string;
	deletedAt: string | null;
	isHydrated: boolean;
}

interface OrganizationSettingsActions {
	setSettings: (settings: Partial<Omit<OrganizationSettings, "isHydrated">>) => void;
	hydrate: (settings: Omit<OrganizationSettings, "isHydrated">) => void;
	reset: () => void;
}

type OrganizationSettingsStore = OrganizationSettings & OrganizationSettingsActions;

const initialState: OrganizationSettings = {
	organizationId: null,
	shiftsEnabled: false,
	projectsEnabled: false,
	surchargesEnabled: false,
	timezone: "UTC",
	deletedAt: null,
	isHydrated: false,
};

export const useOrganizationSettings = create<OrganizationSettingsStore>((set) => ({
	...initialState,

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

// Selector hooks for specific settings
export const useProjectsEnabled = () => useOrganizationSettings((state) => state.projectsEnabled);
export const useShiftsEnabled = () => useOrganizationSettings((state) => state.shiftsEnabled);
export const useSurchargesEnabled = () =>
	useOrganizationSettings((state) => state.surchargesEnabled);
export const useOrganizationTimezone = () => useOrganizationSettings((state) => state.timezone);
export const useOrganizationDeletedAt = () => useOrganizationSettings((state) => state.deletedAt);
