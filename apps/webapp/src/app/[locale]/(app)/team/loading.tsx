import { SettingsPageSkeleton } from "@/components/settings/settings-skeletons";

/** A local boundary also covers sibling navigation after the app layout is mounted. */
export default function TeamLoading() {
	return (
		<div data-testid="team-shell" className="flex flex-1 flex-col">
			<SettingsPageSkeleton
				variant="list"
				label={{
					labelKey: "common.loadingRegions.team",
					labelDefault: "Loading team",
				}}
			/>
		</div>
	);
}
