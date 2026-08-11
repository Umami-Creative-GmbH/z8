import { Suspense } from "react";
import { AuthenticatedAppContent } from "./app-layout-content";
import { AuthenticatedAppShell } from "./app-layout-shell";

interface AppLayoutProps {
	children: React.ReactNode;
	params: Promise<{ locale: string }>;
}

export default function AppLayout({ children, params }: AppLayoutProps) {
	return (
		<Suspense fallback={<AuthenticatedAppShell />}>
			<AuthenticatedAppContent params={params}>
				{children}
			</AuthenticatedAppContent>
		</Suspense>
	);
}
