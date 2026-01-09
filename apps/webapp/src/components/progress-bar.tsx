"use client";

import { AppProgressProvider } from "@bprogress/next";
import type { ReactNode } from "react";

export function ProgressBar({ children }: { children: ReactNode }) {
	return (
		<AppProgressProvider
			height="3px"
			color="oklch(var(--primary))"
			options={{ showSpinner: false }}
		>
			{children}
		</AppProgressProvider>
	);
}
