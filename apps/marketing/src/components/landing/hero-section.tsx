"use client";

import { useThemeTokens } from "@/components/theme/theme-context";
import { features } from "./data";

export function HeroSection() {
	const { t } = useThemeTokens();

	return (
		<section className="relative z-10 px-8 pb-16 pt-20 lg:px-16">
			<div className="grid items-center gap-12 lg:grid-cols-2">
				<div>
					<h1
						className="animate-fade-up"
						style={{
							fontSize: "clamp(2.8rem, 5.5vw, 4.5rem)",
							fontWeight: 800,
							lineHeight: 1.08,
							letterSpacing: "-0.03em",
							animationDelay: "0.1s",
						}}
					>
						Zeiterfassung.
						<br />
						Endlich gel&ouml;st.
					</h1>
					<p
						className="animate-fade-up mt-6 max-w-md text-[17px] leading-[1.7]"
						style={{ animationDelay: "0.25s", color: t.textSecondary }}
					>
						Ersetzen Sie Ihre gesamte Tool-Landschaft. Stempeluhr, Lohnexport
						und Analyse &mdash; alles an einem Ort.
					</p>
					<div
						className="animate-fade-up mt-8 flex items-center gap-4"
						style={{ animationDelay: "0.4s" }}
					>
						<a
							href="#contact"
							className="rounded-xl px-7 py-4 text-[15px] font-bold transition-all hover:opacity-90"
							style={{ backgroundColor: t.surface, color: t.surfaceText }}
						>
							Kostenlos starten
						</a>
						<span className="text-[13px]" style={{ color: t.textTertiary }}>
							Dauerhaft kostenlos.
							<br />
							Keine Kreditkarte.
						</span>
					</div>

					<div className="animate-fade-up mt-10" style={{ animationDelay: "0.55s" }}>
						<p className="mb-3 text-[11px] font-bold uppercase tracking-[0.15em]" style={{ color: t.textTertiary }}>
							ALLES IN EINEM WERKZEUG
						</p>
						<div className="flex flex-wrap gap-2">
							{features.map((f, i) => (
								<span
									key={i}
									className="rounded-full border px-3.5 py-1.5 text-[13px] transition-all"
									style={{
										borderColor: i === 0 ? t.surface : t.borderStrong,
										backgroundColor: i === 0 ? t.chipActiveBg : t.chipBg,
										color: i === 0 ? t.chipActiveText : t.textSecondary,
										transition: "all 0.4s ease",
									}}
									onMouseOver={(e) => {
										if (i !== 0) {
											e.currentTarget.style.borderColor = t.surface;
											e.currentTarget.style.backgroundColor = t.chipActiveBg;
											e.currentTarget.style.color = t.chipActiveText;
										}
									}}
									onMouseOut={(e) => {
										if (i !== 0) {
											e.currentTarget.style.borderColor = t.borderStrong;
											e.currentTarget.style.backgroundColor = t.chipBg;
											e.currentTarget.style.color = t.textSecondary;
										}
									}}
								>
									{f}
								</span>
							))}
						</div>
					</div>
				</div>

				{/* Right — floating app mockup */}
				<div className="animate-scale-in relative" style={{ animationDelay: "0.3s" }}>
					<div
						className="relative overflow-hidden rounded-2xl"
						style={{
							boxShadow: `0 25px 80px ${t.shadow}, 0 8px 32px ${t.shadowLight}`,
							border: `1px solid ${t.borderMedium}`,
							transition: "box-shadow 0.4s ease, border-color 0.4s ease",
						}}
					>
						<div
							className="flex items-center justify-between px-5 py-3"
							style={{ backgroundColor: t.bgAlt, borderBottom: `1px solid ${t.border}`, transition: "background-color 0.4s ease" }}
						>
							<div className="flex items-center gap-3">
								<div className="flex gap-1.5">
									<div className="h-2.5 w-2.5 rounded-full bg-[#ff5f56]" />
									<div className="h-2.5 w-2.5 rounded-full bg-[#ffbd2e]" />
									<div className="h-2.5 w-2.5 rounded-full bg-[#27ca40]" />
								</div>
								<span className="text-[11px] font-semibold" style={{ color: t.textTertiary }}>Z8 &mdash; Dashboard</span>
							</div>
							<div className="flex items-center gap-2">
								<div className="h-5 w-16 rounded" style={{ backgroundColor: t.mockupBar }} />
								<div className="h-5 w-5 rounded" style={{ backgroundColor: t.mockupBar }} />
							</div>
						</div>
						<div className="flex" style={{ backgroundColor: t.mockupBg, transition: "background-color 0.4s ease" }}>
							<div
								className="hidden w-52 border-r p-4 md:block"
								style={{ backgroundColor: t.mockupSidebar, borderColor: t.border, transition: "background-color 0.4s ease" }}
							>
								<div className="mb-4 flex items-center gap-2">
									<div
										className="h-7 w-7 rounded-lg text-center text-[9px] font-bold leading-7"
										style={{ backgroundColor: t.surface, color: t.surfaceText }}
									>
										Z8
									</div>
									<span className="text-[12px] font-semibold">Umami GmbH</span>
								</div>
								{["Dashboard", "Stempeluhr", "Mitarbeiter", "Berichte", "Lohnexport", "Einstellungen"].map((item, i) => (
									<div
										key={i}
										className="mb-0.5 rounded-lg px-3 py-2 text-[12px]"
										style={{
											backgroundColor: i === 0 ? t.mockupBar : "transparent",
											color: i === 0 ? t.text : t.textTertiary,
											fontWeight: i === 0 ? 600 : 400,
										}}
									>
										{item}
									</div>
								))}
							</div>
							<div className="flex-1 p-5">
								<div className="mb-4 flex items-center justify-between">
									<div>
										<div className="text-[13px] font-semibold">Heute, 6. Februar</div>
										<div className="text-[11px]" style={{ color: t.textTertiary }}>12 Mitarbeiter aktiv</div>
									</div>
									<div className="flex gap-2">
										<div className="rounded-lg px-3 py-1.5 text-[11px] font-medium" style={{ backgroundColor: t.mockupBarInactive, color: t.textSecondary }}>Woche</div>
										<div className="rounded-lg px-3 py-1.5 text-[11px] font-medium" style={{ backgroundColor: t.surface, color: t.surfaceText }}>Monat</div>
									</div>
								</div>
								<div className="mb-4 flex h-32 items-end gap-1.5 rounded-xl p-4" style={{ backgroundColor: t.bgAlt }}>
									{[40, 65, 55, 80, 70, 90, 60, 75, 85, 50, 70, 88].map((h, i) => (
										<div
											key={i}
											className="flex-1 rounded-t-sm transition-all"
											style={{
												height: `${h}%`,
												backgroundColor: i === 11 ? t.chartBarActive : t.chartBar,
											}}
										/>
									))}
								</div>
								<div className="rounded-xl border" style={{ borderColor: t.border }}>
									{["Max Müller", "Anna Schmidt", "Lukas Weber"].map((name, i) => (
										<div key={i} className="flex items-center justify-between border-b px-4 py-2.5 last:border-0" style={{ borderColor: t.border }}>
											<div className="flex items-center gap-3">
												<div
													className="flex h-6 w-6 items-center justify-center rounded-full text-[9px] font-bold"
													style={{ backgroundColor: t.avatarBg, color: t.avatarText }}
												>
													{name.split(" ").map(n => n[0]).join("")}
												</div>
												<span className="text-[12px] font-medium">{name}</span>
											</div>
											<div className="flex items-center gap-3">
												<span className="text-[11px]" style={{ color: t.textTertiary }}>8h 15m</span>
												<span className="rounded-full px-2 py-0.5 text-[10px] font-medium" style={{ backgroundColor: t.statusBg, color: t.statusText }}>Aktiv</span>
											</div>
										</div>
									))}
								</div>
							</div>
						</div>
					</div>
				</div>
			</div>
		</section>
	);
}
