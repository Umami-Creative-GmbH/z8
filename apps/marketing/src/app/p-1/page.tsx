import Image from "next/image";
import Link from "next/link";

const features = [
	"Stempeluhr", "GoBD-konform", "Lohnexport", "Multi-Tenant",
	"Enterprise-SSO", "Echtzeit-Analyse", "Dashboards", "Automatisierung",
];

export default function DesignP1() {
	return (
		<div
			className="min-h-screen"
			style={{
				fontFamily: "'Satoshi', 'General Sans', 'Switzer', sans-serif",
				backgroundColor: "#fefefe",
				color: "#1a1a1a",
			}}
		>
			{/* Prismatic top line */}
			<div
				className="h-[2px]"
				style={{
					background: "linear-gradient(90deg, #6478ff 0%, #c850c0 20%, #ff5088 40%, #ffb347 60%, #3cdcb4 80%, #6478ff 100%)",
				}}
			/>

			{/* Header */}
			<header className="relative z-20 flex items-center justify-between px-8 py-5 lg:px-16">
				<div className="flex items-center gap-8">
					<span
						className="text-[22px] font-black tracking-[-0.02em]"
						style={{
							background: "linear-gradient(135deg, #6478ff, #c850c0, #ff5088)",
							WebkitBackgroundClip: "text",
							WebkitTextFillColor: "transparent",
						}}
					>
						Z8
					</span>
					<nav className="hidden items-center gap-6 text-[14px] text-[#888] md:flex">
						<a href="#features" className="transition-colors hover:text-[#1a1a1a]">Produkt</a>
						<a href="#features" className="transition-colors hover:text-[#1a1a1a]">Funktionen</a>
						<a href="#contact" className="transition-colors hover:text-[#1a1a1a]">Preise</a>
					</nav>
				</div>
				<div className="flex items-center gap-3">
					<a href="#contact" className="text-[14px] text-[#888] transition-colors hover:text-[#1a1a1a]">
						Anmelden
					</a>
					<a
						href="#contact"
						className="rounded-xl px-5 py-2.5 text-[14px] font-semibold text-white transition-all hover:opacity-90"
						style={{ background: "linear-gradient(135deg, #6478ff, #c850c0)" }}
					>
						Kostenlos starten
					</a>
				</div>
			</header>

			{/* Hero — split layout like m-1 with prismatic accents */}
			<section className="relative z-10 px-8 pb-16 pt-20 lg:px-16">
				<div className="grid items-center gap-12 lg:grid-cols-2">
					<div>
						{/* Prismatic badge */}
						<div
							className="animate-fade-up mb-6 inline-flex items-center gap-2 rounded-full px-4 py-2 text-[12px]"
							style={{
								background: "linear-gradient(135deg, rgba(100,120,255,0.06), rgba(200,80,192,0.06))",
								border: "1px solid rgba(100,120,255,0.12)",
								animationDelay: "0.05s",
							}}
						>
							<span
								className="h-1.5 w-1.5 rounded-full"
								style={{ background: "linear-gradient(135deg, #6478ff, #c850c0)" }}
							/>
							<span style={{ color: "#8860e0" }}>v4.0 &mdash; Jetzt verf&uuml;gbar</span>
						</div>

						<h1
							className="animate-fade-up"
							style={{
								fontSize: "clamp(2.8rem, 5.5vw, 4.5rem)",
								fontWeight: 800,
								lineHeight: 1.08,
								letterSpacing: "-0.03em",
								animationDelay: "0.15s",
							}}
						>
							Maximale
							<br />
							<span
								style={{
									background: "linear-gradient(135deg, #6478ff, #c850c0, #ff5088)",
									WebkitBackgroundClip: "text",
									WebkitTextFillColor: "transparent",
								}}
							>
								Zeiterfassung
							</span>
							.
						</h1>

						<p
							className="animate-fade-up mt-6 max-w-md text-[17px] leading-[1.7] text-[#666]"
							style={{ animationDelay: "0.3s" }}
						>
							Ersetzen Sie Ihre gesamte Tool-Landschaft. Stempeluhr, Lohnexport
							und Analyse &mdash; in einer prismatischen Plattform.
						</p>

						<div
							className="animate-fade-up mt-8 flex items-center gap-4"
							style={{ animationDelay: "0.4s" }}
						>
							<a
								href="#contact"
								className="group relative overflow-hidden rounded-xl px-7 py-4 text-[15px] font-bold text-white"
								style={{ background: "linear-gradient(135deg, #6478ff, #c850c0, #ff5088)" }}
							>
								<span className="relative z-10">Kostenlos starten</span>
								<div
									className="absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100"
									style={{ background: "linear-gradient(135deg, #ff5088, #ffb347, #3cdcb4)" }}
								/>
							</a>
							<span className="text-[13px] text-[#999]">
								Dauerhaft kostenlos.
								<br />
								Keine Kreditkarte.
							</span>
						</div>

						{/* Feature chips with spectral colors */}
						<div className="animate-fade-up mt-10" style={{ animationDelay: "0.55s" }}>
							<p
								className="mb-3 text-[11px] font-bold uppercase tracking-[0.15em]"
								style={{
									background: "linear-gradient(90deg, #6478ff, #c850c0, #ff5088)",
									WebkitBackgroundClip: "text",
									WebkitTextFillColor: "transparent",
								}}
							>
								Alles in einem Werkzeug
							</p>
							<div className="flex flex-wrap gap-2">
								{features.map((f, i) => {
									const colors = ["#6478ff", "#8860e0", "#c850c0", "#ff5088", "#ffb347", "#3cdcb4", "#6478ff", "#8860e0"];
									return (
										<span
											key={i}
											className="rounded-full border px-3.5 py-1.5 text-[13px] transition-all"
											style={{
												borderColor: `${colors[i]}30`,
												color: colors[i],
												backgroundColor: `${colors[i]}06`,
											}}
										>
											{f}
										</span>
									);
								})}
							</div>
						</div>
					</div>

					{/* Right — app mockup with prismatic border */}
					<div className="animate-scale-in relative" style={{ animationDelay: "0.3s" }}>
						<div
							className="relative overflow-hidden rounded-2xl"
							style={{
								padding: "1px",
								background: "linear-gradient(135deg, #6478ff30, #c850c020, #ff508820, #3cdcb430)",
							}}
						>
							<div className="overflow-hidden rounded-2xl bg-white">
								{/* App header */}
								<div className="flex items-center justify-between bg-[#fafafa] px-5 py-3" style={{ borderBottom: "1px solid #f0f0f0" }}>
									<div className="flex items-center gap-3">
										<div className="flex gap-1.5">
											<div className="h-2.5 w-2.5 rounded-full bg-[#ff5f56]" />
											<div className="h-2.5 w-2.5 rounded-full bg-[#ffbd2e]" />
											<div className="h-2.5 w-2.5 rounded-full bg-[#27ca40]" />
										</div>
										<span className="text-[11px] font-semibold text-[#999]">Z8 &mdash; Dashboard</span>
									</div>
								</div>
								<div className="flex">
									{/* Sidebar */}
									<div className="hidden w-48 border-r border-[#f0f0f0] p-4 md:block" style={{ backgroundColor: "#fafafa" }}>
										<div className="mb-4 flex items-center gap-2">
											<div
												className="flex h-7 w-7 items-center justify-center rounded-lg text-[9px] font-bold text-white"
												style={{ background: "linear-gradient(135deg, #6478ff, #c850c0)" }}
											>
												Z8
											</div>
											<span className="text-[12px] font-semibold">Umami GmbH</span>
										</div>
										{["Dashboard", "Stempeluhr", "Mitarbeiter", "Berichte", "Export"].map((item, i) => (
											<div
												key={i}
												className="mb-0.5 rounded-lg px-3 py-2 text-[12px]"
												style={{
													backgroundColor: i === 0 ? "#f0f0f0" : "transparent",
													color: i === 0 ? "#1a1a1a" : "#999",
													fontWeight: i === 0 ? 600 : 400,
												}}
											>
												{item}
											</div>
										))}
									</div>
									{/* Content */}
									<div className="flex-1 p-5">
										<div className="mb-4 grid grid-cols-3 gap-3">
											{[
												{ label: "Aktive Nutzer", value: "127", color: "#6478ff" },
												{ label: "Stunden (heute)", value: "842", color: "#c850c0" },
												{ label: "GoBD-Status", value: "100%", color: "#3cdcb4" },
											].map((s, i) => (
												<div key={i} className="rounded-xl p-3" style={{ backgroundColor: `${s.color}06`, border: `1px solid ${s.color}15` }}>
													<div className="text-[10px] text-[#999]">{s.label}</div>
													<div className="mt-1 text-[20px] font-bold tracking-tight">{s.value}</div>
													<div className="mt-0.5 h-1 w-8 rounded-full" style={{ backgroundColor: `${s.color}30` }} />
												</div>
											))}
										</div>
										<div className="flex h-28 items-end gap-1.5 rounded-xl bg-[#fafafa] p-3">
											{[40, 65, 55, 80, 70, 90, 60, 75, 85, 50, 70, 88].map((h, i) => {
												const colors = ["#6478ff", "#8860e0", "#c850c0", "#ff5088", "#ffb347", "#3cdcb4"];
												return (
													<div
														key={i}
														className="flex-1 rounded-t-sm"
														style={{
															height: `${h}%`,
															backgroundColor: i >= 10 ? colors[i % 6] : "#e8e8e8",
														}}
													/>
												);
											})}
										</div>
									</div>
								</div>
							</div>
						</div>
						{/* Rainbow reflection */}
						<div
							className="mx-auto mt-3 h-[1px] max-w-sm"
							style={{
								background: "linear-gradient(90deg, transparent, #6478ff30, #c850c030, #ff508830, #3cdcb430, transparent)",
							}}
						/>
					</div>
				</div>
			</section>

			{/* Features — white cards with spectral accents */}
			<section id="features" className="relative z-10 px-8 py-24 lg:px-16" style={{ backgroundColor: "#fafafa" }}>
				<div className="mx-auto max-w-5xl">
					<div className="mb-16 text-center">
						<span
							className="mb-3 block text-[12px] font-bold uppercase tracking-[0.15em]"
							style={{
								background: "linear-gradient(90deg, #6478ff, #c850c0, #ff5088)",
								WebkitBackgroundClip: "text",
								WebkitTextFillColor: "transparent",
							}}
						>
							Funktionen
						</span>
						<h2 className="text-[clamp(2rem,4vw,3rem)] font-bold tracking-[-0.02em]">
							Sechs Wellenl&auml;ngen. Ein Werkzeug.
						</h2>
					</div>
					<div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
						{[
							{ title: "Stempeluhr", desc: "Ein Klick. Alle Geräte. Sofort synchronisiert über Web, Desktop und Mobile.", color: "#6478ff" },
							{ title: "GoBD-konform", desc: "Revisionssichere Einträge. Lückenlos dokumentiert und unantastbar.", color: "#8860e0" },
							{ title: "Lohnexport", desc: "DATEV, Lexware, Personio, SAP. Automatisch und fehlerfrei.", color: "#c850c0" },
							{ title: "Multi-Tenant", desc: "Mandantenfähig. Jede Organisation strikt isoliert und sicher.", color: "#ff5088" },
							{ title: "Enterprise-SSO", desc: "SAML, OIDC, SCIM. Nahtlose Integration in Ihre IT-Infrastruktur.", color: "#ffb347" },
							{ title: "Echtzeit-Analyse", desc: "Überstunden, Trends, Dashboards. Immer live, immer aktuell.", color: "#3cdcb4" },
						].map((f, i) => (
							<div
								key={i}
								className="group relative overflow-hidden rounded-2xl bg-white p-7 transition-all hover:-translate-y-1 hover:shadow-lg"
								style={{ border: `1px solid ${f.color}15` }}
							>
								<div
									className="absolute inset-0 translate-x-[-100%] transition-transform duration-700 group-hover:translate-x-[100%]"
									style={{ background: `linear-gradient(90deg, transparent, ${f.color}08, transparent)` }}
								/>
								<div
									className="mb-4 flex h-10 w-10 items-center justify-center rounded-xl text-[12px] font-bold text-white"
									style={{ backgroundColor: f.color }}
								>
									{String(i + 1).padStart(2, "0")}
								</div>
								<h3 className="mb-2 text-[16px] font-bold">{f.title}</h3>
								<p className="text-[13px] leading-[1.7] text-[#888]">{f.desc}</p>
								<div
									className="absolute bottom-0 left-0 h-[2px] w-full opacity-0 transition-opacity duration-500 group-hover:opacity-100"
									style={{ background: `linear-gradient(90deg, ${f.color}, transparent)` }}
								/>
							</div>
						))}
					</div>
				</div>
			</section>

			{/* Images */}
			<section className="relative z-10 mx-8 my-24 lg:mx-16">
				<div className="grid gap-4 md:grid-cols-3">
					{[
						"https://images.unsplash.com/photo-1497215842964-222b430dc094?w=500&q=80&auto=format&fit=crop",
						"https://images.unsplash.com/photo-1600880292203-757bb62b4baf?w=500&q=80&auto=format&fit=crop",
						"https://images.unsplash.com/photo-1557804506-669a67965ba0?w=500&q=80&auto=format&fit=crop",
					].map((src, i) => (
						<div
							key={i}
							className="relative h-56 overflow-hidden rounded-2xl"
							style={{ border: `1px solid ${["#6478ff", "#c850c0", "#3cdcb4"][i]}15` }}
						>
							<Image src={src} alt="" fill className="object-cover" />
						</div>
					))}
				</div>
			</section>

			{/* CTA */}
			<section id="contact" className="relative z-10 px-8 py-24 lg:px-16">
				<div
					className="mx-auto max-w-3xl overflow-hidden rounded-3xl p-14 text-center text-white"
					style={{ background: "linear-gradient(135deg, #6478ff, #8860e0, #c850c0, #ff5088)" }}
				>
					<h2 className="mb-4 text-[clamp(2rem,4vw,3rem)] font-bold tracking-[-0.02em]">
						Bereit f&uuml;r das volle Spektrum?
					</h2>
					<p className="mb-8 text-[15px] text-white/70">
						Starten Sie kostenlos &mdash; keine Kreditkarte, kein Risiko.
					</p>
					<div className="flex items-center justify-center gap-3">
						<a
							href="mailto:hello@z8.app"
							className="rounded-xl bg-white px-8 py-4 text-[14px] font-bold text-[#6478ff] transition-all hover:bg-white/90"
						>
							Kostenlos starten
						</a>
						<a
							href="mailto:hello@z8.app"
							className="rounded-xl px-8 py-4 text-[14px] font-medium text-white/70 transition-colors hover:text-white"
							style={{ border: "1px solid rgba(255,255,255,0.25)" }}
						>
							hello@z8.app
						</a>
					</div>
				</div>
			</section>

			{/* Footer */}
			<footer className="relative z-10 px-8 py-8 lg:px-16" style={{ borderTop: "1px solid #f0f0f0" }}>
				<div className="flex items-center justify-between text-[13px] text-[#ccc]">
					<span>&copy; 2025 Z8</span>
					<Link href="/" className="transition-colors hover:text-[#1a1a1a]">&larr; Alle Designs</Link>
				</div>
			</footer>
		</div>
	);
}
