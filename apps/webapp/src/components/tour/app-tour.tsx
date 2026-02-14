"use client";

import { useAppTour } from "./use-app-tour";

export function AppTour() {
	useAppTour({ autoStart: true });
	return null;
}
