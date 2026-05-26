import * as React from "react";

const MOBILE_BREAKPOINT = 768;

function subscribeToMobileStatus(callback: () => void) {
	const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);
	mql.addEventListener("change", callback);
	return () => mql.removeEventListener("change", callback);
}

function getMobileStatus() {
	return window.innerWidth < MOBILE_BREAKPOINT;
}

function getServerMobileStatus() {
	return false;
}

export function useIsMobile() {
	return React.useSyncExternalStore(
		subscribeToMobileStatus,
		getMobileStatus,
		getServerMobileStatus,
	);
}
