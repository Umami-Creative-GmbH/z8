import { Suspense } from "react";
import { ServerAppSidebar } from "./server-app-sidebar";
import { SidebarLoading } from "./sidebar-loading";

/** Mount only inside the already authorized/billing-admitted application layout. */
export function ServerSidebarRegion(
	props: React.ComponentProps<typeof ServerAppSidebar>,
) {
	return (
		<Suspense
			fallback={
				<SidebarLoading
					variant={props.variant}
					side={props.side}
					collapsible={props.collapsible}
				/>
			}
		>
			<ServerAppSidebar {...props} />
		</Suspense>
	);
}
