"use client";

import { useCallback, useEffect, useRef } from "react";
import { useTranslate } from "@tolgee/react";
import { useOrganization } from "@/hooks/use-organization";
import { useSession } from "@/lib/auth-client";
import { isTourCompleted, markTourCompleted } from "./tour-constants";
import { buildDriverSteps, getStepsForRole } from "./tour-steps";
import { useSidebar } from "@/components/ui/sidebar";

interface UseAppTourOptions {
	autoStart?: boolean;
}

export function useAppTour({ autoStart = false }: UseAppTourOptions = {}) {
	const { data: session } = useSession();
	const { role, isLoading: orgLoading } = useOrganization();
	const { open: sidebarOpen, setOpen: setSidebarOpen, isMobile } = useSidebar();
	const { t } = useTranslate();
	const hasStarted = useRef(false);

	const startTour = useCallback(async () => {
		const userId = session?.user?.id;
		if (!userId) return;

		const filteredSteps = getStepsForRole(role);

		// On mobile, skip sidebar-targeted steps
		const steps = isMobile
			? filteredSteps.filter(
					(s) =>
						!s.element.includes("sidebar") &&
						!s.element.includes("nav-"),
				)
			: filteredSteps;

		const driverSteps = buildDriverSteps(steps, (key, def) => t(key, def));
		if (driverSteps.length === 0) return;

		// Lazy-load driver.js + CSS only when the tour actually starts
		const [{ driver }] = await Promise.all([
			import("driver.js"),
			// @ts-expect-error -- CSS side-effect import has no type declarations
			import("driver.js/dist/driver.css"),
			// @ts-expect-error -- CSS side-effect import has no type declarations
			import("./driver-theme.css"),
		]);

		const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

		const driverInstance = driver({
			animate: !prefersReducedMotion,
			showProgress: true,
			progressText: "{{current}} / {{total}}",
			nextBtnText: t("common.next", "Next"),
			prevBtnText: t("common.previous", "Previous"),
			doneBtnText: t("generic.done", "Done"),
			steps: driverSteps,
			onDestroyed: () => {
				markTourCompleted(userId);
			},
		});

		driverInstance.drive();
	}, [session?.user?.id, role, isMobile, t]);

	useEffect(() => {
		if (!autoStart || hasStarted.current) return;

		const userId = session?.user?.id;
		if (!userId || orgLoading) return;

		if (isTourCompleted(userId)) return;

		hasStarted.current = true;

		// Ensure sidebar is open for sidebar steps
		if (!isMobile && !sidebarOpen) {
			setSidebarOpen(true);
			// Wait for sidebar animation to complete
			const timer = setTimeout(startTour, 1150);
			return () => clearTimeout(timer);
		}

		// Wait for dashboard widgets to render
		const timer = setTimeout(startTour, 800);
		return () => clearTimeout(timer);
	}, [autoStart, session?.user?.id, orgLoading, isMobile, sidebarOpen, setSidebarOpen, startTour]);

	return { startTour };
}
