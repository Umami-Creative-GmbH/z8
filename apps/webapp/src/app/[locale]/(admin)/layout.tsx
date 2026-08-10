import { Suspense } from "react";
import { AdminLayoutContent } from "./admin-layout-content";
import { AdminLayoutShell } from "./admin-layout-shell";

export default function AdminLayout({
	children,
}: {
	children: React.ReactNode;
}) {
	return (
		<Suspense fallback={<AdminLayoutShell />}>
			<AdminLayoutContent>{children}</AdminLayoutContent>
		</Suspense>
	);
}
