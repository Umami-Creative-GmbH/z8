import Link from "next/link";

export default function Design4() {
	return (
		<div
			className="min-h-screen"
			style={{
				fontFamily: "'Segoe UI', Tahoma, Geneva, Verdana, sans-serif",
				backgroundColor: "#fefcf9",
				color: "#3d3a36",
			}}
		>
			{/* Soft gradient background blobs */}
			<div className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
				<div
					className="absolute -left-32 -top-32 h-[600px] w-[600px] rounded-full opacity-30 blur-[120px]"
					style={{ backgroundColor: "#c4b5fd" }}
				/>
				<div
					className="absolute -right-48 top-1/3 h-[500px] w-[500px] rounded-full opacity-20 blur-[100px]"
					style={{ backgroundColor: "#fbcfe8" }}
				/>
				<div
					className="absolute bottom-0 left-1/3 h-[400px] w-[400px] rounded-full opacity-20 blur-[100px]"
					style={{ backgroundColor: "#a7f3d0" }}
				/>
			</div>

			{/* Header */}
			<header className="relative z-10 flex items-center justify-between px-6 py-6 lg:px-12">
				<div className="flex items-center gap-2.5">
					<div
						className="flex h-10 w-10 items-center justify-center rounded-2xl text-sm font-bold text-white"
						style={{
							background: "linear-gradient(135deg, #8b5cf6, #ec4899)",
						}}
					>
						Z8
					</div>
					<span className="text-lg font-semibold tracking-tight">Z8</span>
				</div>
				<nav className="hidden items-center gap-8 text-[14px] text-[#8a8580] md:flex">
					<a href="#features" className="transition-colors hover:text-[#3d3a36]">
						Funktionen
					</a>
					<a href="#why" className="transition-colors hover:text-[#3d3a36]">
						Warum Z8
					</a>
					<a href="#contact" className="transition-colors hover:text-[#3d3a36]">
						Kontakt
					</a>
				</nav>
				<a
					href="#contact"
					className="rounded-full px-6 py-2.5 text-[13px] font-semibold text-white shadow-lg transition-transform hover:scale-105"
					style={{
						background: "linear-gradient(135deg, #8b5cf6, #ec4899)",
						boxShadow: "0 4px 20px rgba(139,92,246,0.3)",
					}}
				>
					Kostenlos testen
				</a>
			</header>

			{/* Hero */}
			<section className="relative z-10 px-6 pb-20 pt-20 text-center lg:px-12 lg:pt-28">
				<div
					className="animate-scale-in mx-auto mb-6 inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-[12px] font-medium"
					style={{
						backgroundColor: "#f3e8ff",
						color: "#7c3aed",
						animationDelay: "0.1s",
					}}
				>
					<span
						className="inline-block h-2 w-2 rounded-full"
						style={{ backgroundColor: "#7c3aed" }}
					/>
					Jetzt verf&uuml;gbar f&uuml;r Teams jeder Gr&ouml;&szlig;e
				</div>

				<h1
					className="animate-fade-up mx-auto max-w-4xl text-[clamp(2.5rem,6vw,4.5rem)] font-bold leading-[1.1] tracking-[-0.03em]"
					style={{ animationDelay: "0.2s" }}
				>
					Zeiterfassung, die sich{" "}
					<span
						className="bg-clip-text text-transparent"
						style={{
							backgroundImage: "linear-gradient(135deg, #8b5cf6, #ec4899, #f59e0b)",
						}}
					>
						gut anf&uuml;hlt
					</span>
				</h1>

				<p
					className="animate-fade-up mx-auto mt-6 max-w-xl text-[16px] leading-relaxed text-[#8a8580]"
					style={{ animationDelay: "0.35s" }}
				>
					Stempeln, planen, exportieren &mdash; Z8 macht Arbeitszeitverwaltung so einfach wie sie
					sein sollte. GoBD-konform und intuitiv.
				</p>

				<div
					className="animate-fade-up mt-10 flex flex-wrap items-center justify-center gap-4"
					style={{ animationDelay: "0.5s" }}
				>
					<a
						href="#contact"
						className="rounded-full px-8 py-3.5 text-[14px] font-semibold text-white shadow-lg transition-transform hover:scale-105"
						style={{
							background: "linear-gradient(135deg, #8b5cf6, #ec4899)",
							boxShadow: "0 4px 24px rgba(139,92,246,0.3)",
						}}
					>
						Jetzt starten
					</a>
					<a
						href="#features"
						className="rounded-full px-8 py-3.5 text-[14px] font-semibold transition-colors"
						style={{
							border: "1.5px solid #e5e0d8",
							color: "#8a8580",
						}}
					>
						Mehr erfahren
					</a>
				</div>

				{/* Dashboard mockup placeholder */}
				<div
					className="animate-scale-in mx-auto mt-16 flex h-[45vh] max-w-4xl items-center justify-center overflow-hidden rounded-3xl shadow-2xl"
					style={{
						background: "linear-gradient(180deg, #f8f4ff 0%, #fef2f8 100%)",
						border: "1px solid #ede5f7",
						animationDelay: "0.6s",
					}}
				>
					<span className="text-[13px] font-medium text-[#b5a0d0]">Dashboard Vorschau</span>
				</div>
			</section>

			{/* Features */}
			<section id="features" className="relative z-10 px-6 py-24 lg:px-12">
				<div className="mb-16 text-center">
					<p
						className="mb-3 text-[12px] font-semibold uppercase tracking-[0.3em]"
						style={{ color: "#8b5cf6" }}
					>
						Funktionen
					</p>
					<h2 className="text-3xl font-bold tracking-tight">Alles, was Ihr Team braucht</h2>
				</div>

				<div className="mx-auto grid max-w-5xl gap-6 md:grid-cols-2 lg:grid-cols-3">
					{[
						{
							emoji: "\u23f0",
							title: "Stempeluhr",
							desc: "Ein Klick zum Ein- und Ausstempeln. Auf jedem Ger\u00e4t, jederzeit.",
							gradient: "linear-gradient(135deg, #ede9fe, #fce7f3)",
						},
						{
							emoji: "\ud83d\udee1\ufe0f",
							title: "GoBD-konform",
							desc: "Revisionssichere Protokollierung. Jeder Eintrag unver\u00e4nderbar dokumentiert.",
							gradient: "linear-gradient(135deg, #fce7f3, #fff7ed)",
						},
						{
							emoji: "\ud83d\udcca",
							title: "Live-Dashboards",
							desc: "Anwesenheit, \u00dcberstunden, Trends \u2014 alles auf einen Blick visualisiert.",
							gradient: "linear-gradient(135deg, #ecfdf5, #ede9fe)",
						},
						{
							emoji: "\ud83d\udd17",
							title: "Lohnexport",
							desc: "DATEV, Lexware, Personio. Automatischer Export ohne H\u00e4ndisches.",
							gradient: "linear-gradient(135deg, #fff7ed, #ede9fe)",
						},
						{
							emoji: "\ud83d\udc65",
							title: "Team-Verwaltung",
							desc: "Abteilungen, Rollen, Berechtigungen \u2014 flexibel und \u00fcbersichtlich.",
							gradient: "linear-gradient(135deg, #ede9fe, #ecfdf5)",
						},
						{
							emoji: "\ud83d\udcf1",
							title: "Multi-Plattform",
							desc: "Web, Desktop, Mobile, Browser-Extension. \u00dcberall verf\u00fcgbar.",
							gradient: "linear-gradient(135deg, #fce7f3, #ecfdf5)",
						},
					].map((f, i) => (
						<div
							key={i}
							className="group rounded-2xl p-6 transition-all hover:-translate-y-1 hover:shadow-lg"
							style={{
								background: f.gradient,
								border: "1px solid rgba(255,255,255,0.7)",
							}}
						>
							<span className="mb-4 block text-3xl">{f.emoji}</span>
							<h3 className="mb-2 text-lg font-semibold tracking-tight">{f.title}</h3>
							<p className="text-[13px] leading-relaxed text-[#8a8580]">{f.desc}</p>
						</div>
					))}
				</div>
			</section>

			{/* Why Z8 */}
			<section
				id="why"
				className="relative z-10 px-6 py-24 lg:px-12"
				style={{
					background: "linear-gradient(180deg, #f8f4ff 0%, #fefcf9 100%)",
				}}
			>
				<div className="mx-auto max-w-3xl text-center">
					<p
						className="mb-3 text-[12px] font-semibold uppercase tracking-[0.3em]"
						style={{ color: "#ec4899" }}
					>
						Warum Z8
					</p>
					<h2 className="mb-6 text-3xl font-bold tracking-tight">Gebaut mit Liebe zum Detail</h2>
					<p className="text-[16px] leading-relaxed text-[#8a8580]">
						Z8 entstand aus der Frustration mit komplizierter, h&auml;sslicher
						Zeiterfassungssoftware. Wir glauben, dass auch Business-Tools sch&ouml;n und intuitiv
						sein k&ouml;nnen &mdash; ohne Kompromisse bei Compliance und Sicherheit.
					</p>
				</div>
			</section>

			{/* Contact */}
			<section id="contact" className="relative z-10 px-6 py-24 text-center lg:px-12">
				<div
					className="mx-auto max-w-2xl rounded-3xl p-12 shadow-xl"
					style={{
						background: "linear-gradient(135deg, #8b5cf6, #ec4899)",
					}}
				>
					<h2 className="mb-4 text-3xl font-bold tracking-tight text-white">Bereit loszulegen?</h2>
					<p className="mb-8 text-[15px] leading-relaxed text-white/80">
						Starten Sie heute kostenlos. Kein Kreditkarte. Kein Risiko.
					</p>
					<a
						href="mailto:hello@z8.app"
						className="inline-block rounded-full bg-white px-8 py-3.5 text-[14px] font-semibold shadow-lg transition-transform hover:scale-105"
						style={{ color: "#8b5cf6" }}
					>
						Kostenlose Demo vereinbaren
					</a>
				</div>
			</section>

			{/* Footer */}
			<footer
				className="relative z-10 px-6 py-8 lg:px-12"
				style={{ borderTop: "1px solid #f0ebe3" }}
			>
				<div className="flex items-center justify-between text-[12px] text-[#b5b0a8]">
					<span>&copy; 2025 Z8</span>
					<Link href="/" className="transition-colors hover:text-[#8b5cf6]">
						&larr; Alle Designs
					</Link>
				</div>
			</footer>
		</div>
	);
}
