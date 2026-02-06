import Image from "next/image";
import Link from "next/link";

const features = [
	"Stempeluhr", "GoBD-konform", "Lohnexport", "Multi-Tenant",
	"Enterprise-SSO", "Echtzeit-Analyse", "Dashboards", "Automatisierung",
	"DATEV-Export", "Schichtplanung",
];

const logos = ["DATEV", "Lexware", "Personio", "SAP", "Sage"];

export default function DesignM1() {
	return (
		<div
			className="min-h-screen"
			style={{
				fontFamily: "'Satoshi', 'General Sans', 'Switzer', 'Cerebri Sans', sans-serif",
				backgroundColor: "#ffffff",
				color: "#1a1a1a",
			}}
		>
			{/* Announcement bar */}
			<div
				className="relative z-20 flex items-center justify-center gap-2 py-2.5 text-[12px]"
				style={{ backgroundColor: "#fafafa", borderBottom: "1px solid #f0f0f0" }}
			>
				<span
					className="rounded-full px-2.5 py-0.5 text-[10px] font-bold"
					style={{ backgroundColor: "#1a1a1a", color: "#fff" }}
				>
					Neu
				</span>
				<span className="text-[#666]">
					Z8 v4 ist da: Schneller, sch&ouml;ner, smarter.
				</span>
				<span className="text-[#999]">&rsaquo;</span>
			</div>

			{/* Header */}
			<header className="relative z-20 flex items-center justify-between px-8 py-5 lg:px-16">
				<div className="flex items-center gap-8">
					<span className="text-[22px] font-black tracking-[-0.02em]">Z8</span>
					<nav className="hidden items-center gap-6 text-[14px] text-[#666] md:flex">
						<a href="#features" className="transition-colors hover:text-[#1a1a1a]">Produkt</a>
						<a href="#features" className="transition-colors hover:text-[#1a1a1a]">Funktionen</a>
						<a href="#contact" className="transition-colors hover:text-[#1a1a1a]">Preise</a>
						<a href="#contact" className="transition-colors hover:text-[#1a1a1a]">Unternehmen</a>
					</nav>
				</div>
				<div className="flex items-center gap-3">
					<a href="#contact" className="text-[14px] text-[#666] transition-colors hover:text-[#1a1a1a]">
						Anmelden
					</a>
					<a
						href="#contact"
						className="rounded-lg px-5 py-2.5 text-[14px] font-semibold text-white transition-all hover:opacity-90"
						style={{ backgroundColor: "#1a1a1a" }}
					>
						Kostenlos starten
					</a>
				</div>
			</header>

			{/* Hero — text left, product screenshot right */}
			<section className="relative z-10 px-8 pb-16 pt-20 lg:px-16">
				<div className="grid items-center gap-12 lg:grid-cols-2">
					{/* Left text */}
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
							Maximale
							<br />
							Zeiterfassung.
						</h1>
						<p
							className="animate-fade-up mt-6 max-w-md text-[17px] leading-[1.7] text-[#666]"
							style={{ animationDelay: "0.25s" }}
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
								className="rounded-xl px-7 py-4 text-[15px] font-bold text-white transition-all hover:opacity-90"
								style={{ backgroundColor: "#1a1a1a" }}
							>
								Kostenlos starten
							</a>
							<span className="text-[13px] text-[#999]">
								Dauerhaft kostenlos.
								<br />
								Keine Kreditkarte.
							</span>
						</div>

						{/* Feature chips */}
						<div className="animate-fade-up mt-10" style={{ animationDelay: "0.55s" }}>
							<p className="mb-3 text-[11px] font-bold uppercase tracking-[0.15em] text-[#999]">
								ALLES IN EINEM WERKZEUG
							</p>
							<div className="flex flex-wrap gap-2">
								{features.map((f, i) => (
									<span
										key={i}
										className="rounded-full border px-3.5 py-1.5 text-[13px] transition-all hover:border-[#1a1a1a] hover:bg-[#1a1a1a] hover:text-white"
										style={{
											borderColor: i === 0 ? "#1a1a1a" : "#e0e0e0",
											backgroundColor: i === 0 ? "#1a1a1a" : "transparent",
											color: i === 0 ? "#fff" : "#666",
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
								boxShadow: "0 25px 80px rgba(0,0,0,0.12), 0 8px 32px rgba(0,0,0,0.08)",
								border: "1px solid #e8e8e8",
							}}
						>
							{/* Fake app header */}
							<div className="flex items-center justify-between bg-[#fafafa] px-5 py-3" style={{ borderBottom: "1px solid #f0f0f0" }}>
								<div className="flex items-center gap-3">
									<div className="flex gap-1.5">
										<div className="h-2.5 w-2.5 rounded-full bg-[#ff5f56]" />
										<div className="h-2.5 w-2.5 rounded-full bg-[#ffbd2e]" />
										<div className="h-2.5 w-2.5 rounded-full bg-[#27ca40]" />
									</div>
									<span className="text-[11px] font-semibold text-[#999]">Z8 &mdash; Dashboard</span>
								</div>
								<div className="flex items-center gap-2">
									<div className="h-5 w-16 rounded bg-[#f0f0f0]" />
									<div className="h-5 w-5 rounded bg-[#f0f0f0]" />
								</div>
							</div>
							{/* App sidebar + content mockup */}
							<div className="flex" style={{ backgroundColor: "#fff" }}>
								{/* Sidebar */}
								<div className="hidden w-52 border-r border-[#f0f0f0] p-4 md:block" style={{ backgroundColor: "#fafafa" }}>
									<div className="mb-4 flex items-center gap-2">
										<div className="h-7 w-7 rounded-lg bg-[#1a1a1a] text-center text-[9px] font-bold leading-7 text-white">Z8</div>
										<span className="text-[12px] font-semibold">Umami GmbH</span>
									</div>
									{["Dashboard", "Stempeluhr", "Mitarbeiter", "Berichte", "Lohnexport", "Einstellungen"].map((item, i) => (
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
									<div className="mb-4 flex items-center justify-between">
										<div>
											<div className="text-[13px] font-semibold">Heute, 6. Februar</div>
											<div className="text-[11px] text-[#999]">12 Mitarbeiter aktiv</div>
										</div>
										<div className="flex gap-2">
											<div className="rounded-lg bg-[#f5f5f5] px-3 py-1.5 text-[11px] font-medium text-[#666]">Woche</div>
											<div className="rounded-lg bg-[#1a1a1a] px-3 py-1.5 text-[11px] font-medium text-white">Monat</div>
										</div>
									</div>
									{/* Chart placeholder */}
									<div className="mb-4 flex h-32 items-end gap-1.5 rounded-xl bg-[#fafafa] p-4">
										{[40, 65, 55, 80, 70, 90, 60, 75, 85, 50, 70, 88].map((h, i) => (
											<div
												key={i}
												className="flex-1 rounded-t-sm transition-all"
												style={{
													height: `${h}%`,
													backgroundColor: i === 11 ? "#1a1a1a" : "#e0e0e0",
												}}
											/>
										))}
									</div>
									{/* Table */}
									<div className="rounded-xl border border-[#f0f0f0]">
										{["Max Müller", "Anna Schmidt", "Lukas Weber"].map((name, i) => (
											<div key={i} className="flex items-center justify-between border-b border-[#f0f0f0] px-4 py-2.5 last:border-0">
												<div className="flex items-center gap-3">
													<div className="flex h-6 w-6 items-center justify-center rounded-full bg-[#f0f0f0] text-[9px] font-bold text-[#999]">
														{name.split(" ").map(n => n[0]).join("")}
													</div>
													<span className="text-[12px] font-medium">{name}</span>
												</div>
												<div className="flex items-center gap-3">
													<span className="text-[11px] text-[#999]">8h 15m</span>
													<span className="rounded-full bg-[#dcfce7] px-2 py-0.5 text-[10px] font-medium text-[#16a34a]">Aktiv</span>
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

			{/* Logo bar */}
			<section className="relative z-10 px-8 py-16 lg:px-16" style={{ borderTop: "1px solid #f0f0f0" }}>
				<div className="flex flex-wrap items-center justify-center gap-12">
					<span className="text-[11px] font-bold uppercase tracking-[0.2em] text-[#ccc]">Vertraut von</span>
					{logos.map((logo, i) => (
						<span key={i} className="text-[18px] font-bold text-[#d0d0d0]" style={{ letterSpacing: "-0.01em" }}>
							{logo}
						</span>
					))}
				</div>
			</section>

			{/* Features grid */}
			<section id="features" className="relative z-10 px-8 py-24 lg:px-16" style={{ backgroundColor: "#fafafa" }}>
				<div className="mx-auto max-w-5xl">
					<div className="mb-16 text-center">
						<span className="mb-3 block text-[12px] font-bold uppercase tracking-[0.15em] text-[#999]">
							Funktionen
						</span>
						<h2 className="text-[clamp(2rem,4vw,3rem)] font-bold tracking-[-0.02em]">
							Alles, was Ihr Team braucht.
						</h2>
					</div>
					<div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
						{[
							{ title: "Stempeluhr", desc: "Ein Klick. Alle Geräte. Sofort synchronisiert über Web, Desktop und Mobile." },
							{ title: "GoBD-konform", desc: "Revisionssichere Einträge. Lückenlos dokumentiert und unantastbar." },
							{ title: "Lohnexport", desc: "DATEV, Lexware, Personio, SAP. Automatisch und fehlerfrei." },
							{ title: "Multi-Tenant", desc: "Mandantenfähig. Jede Organisation strikt isoliert und sicher." },
							{ title: "Enterprise-SSO", desc: "SAML, OIDC, SCIM. Nahtlose Integration in Ihre IT-Infrastruktur." },
							{ title: "Echtzeit-Analyse", desc: "Überstunden, Trends, Dashboards. Immer live, immer aktuell." },
						].map((f, i) => (
							<div
								key={i}
								className="group rounded-2xl bg-white p-7 transition-all hover:-translate-y-1 hover:shadow-lg"
								style={{ border: "1px solid #f0f0f0" }}
							>
								<div
									className="mb-4 flex h-10 w-10 items-center justify-center rounded-xl text-[12px] font-bold text-white"
									style={{ backgroundColor: "#1a1a1a" }}
								>
									{String(i + 1).padStart(2, "0")}
								</div>
								<h3 className="mb-2 text-[16px] font-bold">{f.title}</h3>
								<p className="text-[13px] leading-[1.7] text-[#888]">{f.desc}</p>
							</div>
						))}
					</div>
				</div>
			</section>

			{/* Image section */}
			<section className="relative z-10 mx-8 mb-24 lg:mx-16">
				<div className="grid gap-4 md:grid-cols-3">
					{[
						"https://images.unsplash.com/photo-1497215842964-222b430dc094?w=500&q=80&auto=format&fit=crop",
						"https://images.unsplash.com/photo-1600880292203-757bb62b4baf?w=500&q=80&auto=format&fit=crop",
						"https://images.unsplash.com/photo-1557804506-669a67965ba0?w=500&q=80&auto=format&fit=crop",
					].map((src, i) => (
						<div key={i} className="relative h-56 overflow-hidden rounded-2xl">
							<Image src={src} alt="" fill className="object-cover" />
						</div>
					))}
				</div>
			</section>

			{/* CTA */}
			<section id="contact" className="relative z-10 px-8 py-24 lg:px-16">
				<div
					className="mx-auto max-w-3xl rounded-3xl p-14 text-center text-white"
					style={{ backgroundColor: "#1a1a1a" }}
				>
					<h2 className="mb-4 text-[clamp(2rem,4vw,3rem)] font-bold tracking-[-0.02em]">
						Bereit durchzustarten?
					</h2>
					<p className="mb-8 text-[15px] text-[#999]">
						Starten Sie kostenlos &mdash; keine Kreditkarte, kein Risiko.
					</p>
					<div className="flex items-center justify-center gap-3">
						<a
							href="mailto:hello@z8.app"
							className="rounded-xl bg-white px-8 py-4 text-[14px] font-bold text-[#1a1a1a] transition-all hover:bg-[#f0f0f0]"
						>
							Kostenlos starten
						</a>
						<a
							href="mailto:hello@z8.app"
							className="rounded-xl px-8 py-4 text-[14px] font-medium text-[#999] transition-colors hover:text-white"
							style={{ border: "1px solid #333" }}
						>
							Demo anfragen
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
