import Image from "next/image";
import Link from "next/link";

export default function DesignM6() {
	return (
		<div
			className="min-h-screen"
			style={{
				fontFamily: "'Plus Jakarta Sans', 'Figtree', 'Nunito Sans', sans-serif",
				backgroundColor: "#0f0f12",
				color: "#f0f0f5",
			}}
		>
			{/* Gradient background */}
			<div
				className="pointer-events-none fixed inset-0 z-0"
				style={{
					background:
						"radial-gradient(ellipse 80% 60% at 50% 0%, rgba(99,102,241,0.12) 0%, transparent 50%), radial-gradient(ellipse 60% 40% at 80% 80%, rgba(168,85,247,0.06) 0%, transparent 50%)",
				}}
			/>

			{/* Header */}
			<header className="relative z-20 flex items-center justify-between px-8 py-5 lg:px-14">
				<div className="flex items-center gap-8">
					<span className="text-[20px] font-bold">Z8</span>
					<nav className="hidden items-center gap-6 text-[13px] font-medium text-[#6b6b80] md:flex">
						<a href="#features" className="transition-colors hover:text-white">Funktionen</a>
						<a href="#product" className="transition-colors hover:text-white">Produkt</a>
						<a href="#contact" className="transition-colors hover:text-white">Preise</a>
					</nav>
				</div>
				<div className="flex items-center gap-3">
					<a href="#contact" className="text-[13px] text-[#6b6b80] transition-colors hover:text-white">Anmelden</a>
					<a
						href="#contact"
						className="rounded-xl px-5 py-2.5 text-[13px] font-semibold text-white transition-all hover:opacity-90"
						style={{
							background: "linear-gradient(135deg, #6366f1, #a855f7)",
						}}
					>
						Kostenlos starten
					</a>
				</div>
			</header>

			{/* Hero — gradient header with glass card */}
			<section className="relative z-10 px-8 pb-32 pt-28 lg:px-14">
				<div className="mx-auto max-w-5xl text-center">
					{/* Badge */}
					<div
						className="animate-fade-up mx-auto mb-8 inline-flex items-center gap-2 rounded-full px-4 py-2 text-[12px] font-medium"
						style={{
							background: "linear-gradient(135deg, rgba(99,102,241,0.1), rgba(168,85,247,0.1))",
							border: "1px solid rgba(99,102,241,0.2)",
							color: "#a78bfa",
							animationDelay: "0.05s",
						}}
					>
						<span className="h-1.5 w-1.5 rounded-full" style={{ background: "linear-gradient(135deg, #6366f1, #a855f7)" }} />
						Version 4.0 &mdash; Jetzt verf&uuml;gbar
					</div>

					<h1
						className="animate-fade-up"
						style={{
							fontSize: "clamp(3rem, 7vw, 5.5rem)",
							fontWeight: 800,
							lineHeight: 1.05,
							letterSpacing: "-0.04em",
							animationDelay: "0.15s",
						}}
					>
						Zeiterfassung,
						<br />
						<span
							style={{
								background: "linear-gradient(135deg, #6366f1, #a855f7, #ec4899)",
								WebkitBackgroundClip: "text",
								WebkitTextFillColor: "transparent",
							}}
						>
							neu definiert
						</span>
						.
					</h1>

					<p
						className="animate-fade-up mx-auto mt-6 max-w-lg text-[16px] leading-[1.8] text-[#6b6b80]"
						style={{ animationDelay: "0.3s" }}
					>
						Die moderne Plattform f&uuml;r Teams, die ihre Arbeitszeit nicht nur erfassen,
						sondern verstehen &mdash; mit KI, Echtzeit-Dashboards und GoBD-Export.
					</p>

					<div
						className="animate-fade-up mt-10 flex items-center justify-center gap-3"
						style={{ animationDelay: "0.45s" }}
					>
						<a
							href="#contact"
							className="rounded-xl px-8 py-4 text-[14px] font-bold text-white transition-all hover:opacity-90 hover:shadow-[0_0_30px_rgba(99,102,241,0.3)]"
							style={{ background: "linear-gradient(135deg, #6366f1, #a855f7)" }}
						>
							Kostenlos starten
						</a>
						<a
							href="#contact"
							className="rounded-xl px-8 py-4 text-[14px] text-[#6b6b80] transition-colors hover:text-white"
							style={{ border: "1px solid #2a2a35" }}
						>
							Demo ansehen
						</a>
					</div>
				</div>

				{/* Glass dashboard preview */}
				<div className="animate-scale-in mx-auto mt-20 max-w-4xl" style={{ animationDelay: "0.6s" }}>
					<div
						className="relative overflow-hidden rounded-2xl"
						style={{
							background: "linear-gradient(135deg, rgba(255,255,255,0.05), rgba(255,255,255,0.02))",
							border: "1px solid rgba(255,255,255,0.08)",
							boxShadow: "0 30px 80px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.05)",
							backdropFilter: "blur(20px)",
						}}
					>
						{/* Window bar */}
						<div className="flex items-center gap-2 px-5 py-3" style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
							<div className="flex gap-1.5">
								<div className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: "#ff5f56" }} />
								<div className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: "#ffbd2e" }} />
								<div className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: "#27ca40" }} />
							</div>
							<div className="ml-4 flex-1">
								<div className="mx-auto max-w-xs rounded-lg px-4 py-1.5 text-center text-[10px] text-[#4a4a60]" style={{ backgroundColor: "rgba(255,255,255,0.03)" }}>
									z8.app
								</div>
							</div>
						</div>
						{/* Dashboard content */}
						<div className="p-6">
							{/* Top stats */}
							<div className="mb-6 grid grid-cols-4 gap-3">
								{[
									{ label: "Aktive Nutzer", value: "127", change: "+12%", color: "#6366f1" },
									{ label: "Stunden (heute)", value: "842", change: "+3%", color: "#a855f7" },
									{ label: "Überstunden", value: "48", change: "-8%", color: "#ec4899" },
									{ label: "GoBD-Status", value: "100%", change: "Konform", color: "#10b981" },
								].map((s, i) => (
									<div
										key={i}
										className="rounded-xl p-4"
										style={{
											background: "linear-gradient(135deg, rgba(255,255,255,0.04), rgba(255,255,255,0.01))",
											border: "1px solid rgba(255,255,255,0.05)",
										}}
									>
										<div className="text-[10px] text-[#6b6b80]">{s.label}</div>
										<div className="mt-1 flex items-end gap-2">
											<span className="text-[22px] font-bold tracking-tight">{s.value}</span>
											<span className="mb-1 text-[10px] font-medium" style={{ color: s.color }}>{s.change}</span>
										</div>
									</div>
								))}
							</div>
							{/* Chart */}
							<div
								className="flex h-36 items-end gap-1 rounded-xl p-4"
								style={{
									background: "linear-gradient(135deg, rgba(255,255,255,0.03), rgba(255,255,255,0.01))",
									border: "1px solid rgba(255,255,255,0.04)",
								}}
							>
								{[30, 45, 38, 60, 52, 70, 48, 65, 55, 72, 60, 80, 55, 68, 75, 50, 78, 62, 85, 72, 90, 68, 82, 75].map((h, i) => (
									<div
										key={i}
										className="flex-1 rounded-t-sm transition-all"
										style={{
											height: `${h}%`,
											background: i >= 20
												? "linear-gradient(180deg, #6366f1, #a855f7)"
												: "rgba(255,255,255,0.06)",
										}}
									/>
								))}
							</div>
						</div>
					</div>
				</div>
			</section>

			{/* Features */}
			<section id="features" className="relative z-10 px-8 py-24 lg:px-14">
				<div className="mx-auto max-w-5xl">
					<div className="mb-14 text-center">
						<h2 className="text-[clamp(2rem,4vw,3rem)] font-bold tracking-[-0.03em]">
							Alles an einem Ort.
						</h2>
					</div>
					<div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
						{[
							{ title: "Stempeluhr", desc: "Ein Klick. Alle Geräte. Sofort synchronisiert.", gradient: "135deg, #6366f1, #818cf8" },
							{ title: "GoBD-konform", desc: "Revisionssicher. Unantastbar. Lückenlos.", gradient: "135deg, #8b5cf6, #a78bfa" },
							{ title: "Lohnexport", desc: "DATEV, Lexware, Personio, SAP. Automatisch.", gradient: "135deg, #a855f7, #c084fc" },
							{ title: "Multi-Tenant", desc: "Mandantenfähig. Isoliert und skalierbar.", gradient: "135deg, #d946ef, #e879f9" },
							{ title: "Enterprise-SSO", desc: "SAML, OIDC, SCIM. Nahtlos integriert.", gradient: "135deg, #ec4899, #f472b6" },
							{ title: "Dashboards", desc: "Überstunden, Trends. Live und sofort.", gradient: "135deg, #10b981, #34d399" },
						].map((f, i) => (
							<div
								key={i}
								className="group rounded-2xl p-6 transition-all duration-300 hover:-translate-y-1"
								style={{
									background: "linear-gradient(135deg, rgba(255,255,255,0.04), rgba(255,255,255,0.01))",
									border: "1px solid rgba(255,255,255,0.06)",
								}}
							>
								<div
									className="mb-4 flex h-9 w-9 items-center justify-center rounded-xl text-[11px] font-bold text-white"
									style={{ background: `linear-gradient(${f.gradient})` }}
								>
									{String(i + 1).padStart(2, "0")}
								</div>
								<h3 className="mb-2 text-[15px] font-bold transition-colors group-hover:text-white">{f.title}</h3>
								<p className="text-[13px] leading-[1.7] text-[#6b6b80]">{f.desc}</p>
							</div>
						))}
					</div>
				</div>
			</section>

			{/* Image section */}
			<section className="relative z-10 mx-8 mb-24 lg:mx-14">
				<div className="relative h-[30vh] overflow-hidden rounded-2xl">
					<Image
						src="https://images.unsplash.com/photo-1600880292203-757bb62b4baf?w=1400&q=80&auto=format&fit=crop"
						alt=""
						fill
						className="object-cover"
						style={{ filter: "saturate(0.3) brightness(0.35) contrast(1.2)" }}
					/>
					<div className="absolute inset-0" style={{ background: "linear-gradient(135deg, rgba(99,102,241,0.1), rgba(168,85,247,0.05), transparent)" }} />
				</div>
			</section>

			{/* Quote */}
			<section className="relative z-10 px-8 py-24 lg:px-14">
				<div className="mx-auto max-w-2xl text-center">
					<blockquote className="text-[clamp(1.5rem,3.5vw,2.5rem)] font-bold leading-[1.35] tracking-[-0.02em]">
						Die Zukunft der Arbeit{" "}
						<span
							style={{
								background: "linear-gradient(135deg, #6366f1, #a855f7, #ec4899)",
								WebkitBackgroundClip: "text",
								WebkitTextFillColor: "transparent",
							}}
						>
							beginnt mit einer Sekunde
						</span>
						.
					</blockquote>
				</div>
			</section>

			{/* Contact */}
			<section id="contact" className="relative z-10 px-8 py-24 lg:px-14">
				<div
					className="mx-auto max-w-3xl overflow-hidden rounded-2xl p-12 text-center lg:p-16"
					style={{
						background: "linear-gradient(135deg, rgba(99,102,241,0.08), rgba(168,85,247,0.04))",
						border: "1px solid rgba(99,102,241,0.15)",
					}}
				>
					<h2 className="mb-4 text-3xl font-bold tracking-[-0.02em]">
						Bereit f&uuml;r die Zukunft?
					</h2>
					<p className="mb-8 text-[14px] text-[#6b6b80]">
						Starten Sie kostenlos. Upgraden Sie, wenn Sie bereit sind.
					</p>
					<div className="flex items-center justify-center gap-3">
						<a
							href="mailto:hello@z8.app"
							className="rounded-xl px-8 py-4 text-[14px] font-bold text-white transition-all hover:opacity-90 hover:shadow-[0_0_30px_rgba(99,102,241,0.3)]"
							style={{ background: "linear-gradient(135deg, #6366f1, #a855f7)" }}
						>
							Kostenlos starten
						</a>
						<a href="mailto:hello@z8.app" className="rounded-xl px-8 py-4 text-[14px] text-[#6b6b80] transition-colors hover:text-white" style={{ border: "1px solid #2a2a35" }}>
							hello@z8.app
						</a>
					</div>
				</div>
			</section>

			{/* Footer */}
			<footer className="relative z-10 px-8 py-8 lg:px-14" style={{ borderTop: "1px solid rgba(255,255,255,0.04)" }}>
				<div className="flex items-center justify-between text-[13px] text-[#2a2a35]">
					<span>&copy; 2025 Z8</span>
					<Link href="/" className="transition-colors hover:text-white">&larr; Alle Designs</Link>
				</div>
			</footer>
		</div>
	);
}
