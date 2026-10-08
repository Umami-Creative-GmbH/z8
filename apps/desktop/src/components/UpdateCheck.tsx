import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { useI18n } from "../lib/i18n";
interface AvailableUpdate {
	configured: boolean;
	version: string | null;
}
function useRelease() {
	return useQuery({
		queryKey: ["release-update"],
		queryFn: () => invoke<AvailableUpdate>("check_for_updates"),
		staleTime: 60 * 60 * 1000,
		refetchInterval: 60 * 60 * 1000,
		retry: false,
	});
}
export function UpdateNotice({ onOpen }: { onOpen: () => void }) {
	const release = useRelease();
	const { t } = useI18n();
	return release.data?.version ? (
		<div className="update-notice" role="status">
			<span>
				{t("Update available")}: {release.data.version}
			</span>
			<button type="button" className="clock-recovery-action" onClick={onOpen}>
				{t("Review update")}
			</button>
		</div>
	) : null;
}
export function UpdateCheck() {
	const release = useRelease();
	const { t } = useI18n();
	const [installing, setInstalling] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const install = async () => {
		const version = release.data?.version;
		if (!version || installing) return;
		setInstalling(true);
		setError(null);
		try {
			await invoke("install_update", { version });
		} catch (failure) {
			setError(String(failure));
			setInstalling(false);
		}
	};
	return (
		<section className="update-controls" aria-label={t("App updates")}>
			{release.data?.version && (
				<p>
					{t("Update available")}: {release.data.version}
				</p>
			)}
			{release.data && !release.data.configured && (
				<p className="field-hint">
					{t("Release updates are not configured yet.")}
				</p>
			)}
			{release.data?.configured && !release.data.version && (
				<p role="status">{t("Up to date")}</p>
			)}
			{(release.error || error) && (
				<p role="alert">
					{t(error ? "Update installation failed" : "Update check failed")}:{" "}
					{error ?? String(release.error)}
				</p>
			)}
			<button
				type="button"
				className="secondary-action"
				disabled={release.isFetching || installing}
				onClick={() => {
					setError(null);
					void release.refetch();
				}}
			>
				{t(release.isFetching ? "Checking…" : "Check for updates")}
			</button>
			{release.data?.version && (
				<>
					<p className="field-hint">
						{t("Saved actions remain on this device during the restart.")}
					</p>
					<button
						type="button"
						className="primary-action"
						disabled={installing || release.isFetching}
						onClick={() => void install()}
					>
						{t(installing ? "Installing…" : "Install and restart")}
					</button>
				</>
			)}
		</section>
	);
}
