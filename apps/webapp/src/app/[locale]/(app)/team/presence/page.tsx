import { Suspense } from "react";
import { redirectWithLocale } from "@/lib/navigation/locale-redirect";
import { LocationSelection, LocationSelectionLoading } from "./location-selection";
import { getWhoIsInViewer } from "./presence-data";

async function AuthorizedSelection() {
	let viewer: Awaited<ReturnType<typeof getWhoIsInViewer>>;
	try {
		viewer = await getWhoIsInViewer();
	} catch {
		// The local reader presents a recoverable failure without exposing server details.
		return <LocationSelection />;
	}
	if (!viewer) return redirectWithLocale("/");
	return <LocationSelection />;
}

export default function WhoIsInPage() {
	return (
		<Suspense fallback={<LocationSelectionLoading />}>
			<AuthorizedSelection />
		</Suspense>
	);
}
