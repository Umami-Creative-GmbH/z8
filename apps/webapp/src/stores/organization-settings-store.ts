"use client";

import { create } from "zustand";

export interface OrganizationSettings {
	organizationId: string | null;
	shiftsEnabled: boolean;
	projectsEnabled: boolean;
	surchargesEnabled: boolean;
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
export const useSurchargesEnabled = () => useOrganizationSettings((state) => state.surchargesEnabled);
