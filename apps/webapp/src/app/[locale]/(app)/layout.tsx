import type { ReactNode } from "react";
import { PushPermissionProvider } from "@/components/notifications/push-permission-provider";

interface AppLayoutProps {
	children: ReactNode;
}

export default function AppLayout({ children }: AppLayoutProps) {
	return <PushPermissionProvider>{children}</PushPermissionProvider>;
}
