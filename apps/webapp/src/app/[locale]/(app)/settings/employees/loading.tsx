import { SettingsPageSkeleton } from "@/components/settings/settings-skeletons";

export default function EmployeesLoading() {
	return (
		<div data-testid="employees-shell" className="flex flex-1 flex-col">
			<SettingsPageSkeleton
				variant="list"
				label={{
					labelKey: "common.loadingRegions.employees",
					labelDefault: "Loading employees",
				}}
			/>
		</div>
	);
}
