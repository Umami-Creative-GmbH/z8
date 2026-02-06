import Image from "next/image";
import Link from "next/link";

export default function DesignP4() {
	return (
		<div
			className="min-h-screen"
			style={{
				fontFamily: "'Satoshi', 'General Sans', 'Switzer', sans-serif",
				backgroundColor: "#ffffff",
				color: "#18161f",
			}}
		>
			{/* Announcement bar with prismatic gradient bg */}
			<div
				className="relative z-20 flex items-center justify-center gap-2 py-2.5 text-[12px]"
				style={{
					background: "linear-gradient(90deg, rgba(100,120,255,0.04), rgba(200,80,192,0.04), rgba(60,220,180,0.04))",
					borderBottom: "1px solid rgba(100,120,255,0.08)",
				}}
			>
				<span
					className="rounded-full px-2.5 py-0.5 text-[10px] font-bold text-white"
					style={{ background: "linear-gradient(135deg, #6478ff, #c850c0)" }}
				>
					Neu
				</span>
				<span className="text-[#666]">
					Z8 v4 &mdash; Schneller, sch&ouml;ner, smarter.
				</span>
			</div>

			{/* Header */}
			<header className="relative z-20 flex items-center justify-between px-8 py-5 lg:px-16">
				<div className="flex items-center gap-8">
					<span
						className="text-[22px] font-black tracking-[-0.02em]"
						style={{
							background: "linear-gradient(135deg, #6478ff, #c850c0)",
							WebkitBackgroundClip: "text",
							WebkitTextFillColor: "transparent",
						}}
					>
						Z8
					</span>
					<nav className="hidden items-center gap-6 text-[14px] text-[#888] md:flex">
						<a href="#features" className="transition-colors hover:text-[#18161f]">Produkt</a>
						<a href="#features" className="transition-colors hover:text-[#18161f]">Funktionen</a>
						<a href="#contact" className="transition-colors hover:text-[#18161f]">Preise</a>
					</nav>
				</div>
				<div className="flex items-center gap-3">
					<a href="#contact" className="text-[14px] text-[#888] transition-colors hover:text-[#18161f]">
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

			{/* Hero — centered text with floating product cards */}
			<section className="relative z-10 px-8 pb-8 pt-24 lg:px-16">
				<div className="mx-auto max-w-5xl text-center">
					<h1
						className="animate-fade-up"
						style={{
							fontSize: "clamp(3rem, 7vw, 5.5rem)",
							fontWeight: 800,
							lineHeight: 1.05,
							letterSpacing: "-0.04em",
							animationDelay: "0.1s",
						}}
					>
						Die Zentrale
						<br />
						<span
							style={{
								background: "linear-gradient(135deg, #6478ff, #8860e0, #c850c0, #ff5088, #ffb347, #3cdcb4)",
								WebkitBackgroundClip: "text",
								WebkitTextFillColor: "transparent",
							}}
						>
							f&uuml;r Arbeitszeit
						</span>
						.
					</h1>

					<p
						className="animate-fade-up mx-auto mt-6 max-w-lg text-[16px] leading-[1.8] text-[#888]"
						style={{ animationDelay: "0.25s" }}
					>
						Stempeluhr, GoBD-Export, Echtzeit-Analyse &mdash; eine prismatische Plattform,
						die Ihr gesamtes Workforce-Management vereint.
					</p>

					<div
						className="animate-fade-up mt-10 flex items-center justify-center gap-3"
						style={{ animationDelay: "0.4s" }}
					>
						<a
							href="#contact"
							className="group relative overflow-hidden rounded-xl px-8 py-3.5 text-[14px] font-bold text-white"
							style={{ background: "linear-gradient(135deg, #6478ff, #c850c0, #ff5088)" }}
						>
							<span className="relative z-10">Kostenlos testen</span>
							<div
								className="absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100"
								style={{ background: "linear-gradient(135deg, #ff5088, #ffb347, #3cdcb4)" }}
							/>
						</a>
						<a
							href="#contact"
							className="rounded-xl px-8 py-3.5 text-[14px] text-[#888] transition-colors hover:text-[#18161f]"
							style={{ border: "1px solid #e0e0e0" }}
						>
							Demo ansehen
						</a>
					</div>
				</div>
			</section>

			{/* Floating product cards — like m-4 but light and prismatic */}
			<section className="relative z-10 px-8 pb-32 pt-16 lg:px-16">
				<div className="animate-scale-in mx-auto flex max-w-6xl items-center justify-center gap-6" style={{ animationDelay: "0.55s", perspective: "1200px" }}>
					{/* Left card — live clock */}
					<div
						className="hidden w-72 rounded-2xl bg-white p-6 md:block"
						style={{
							border: "1px solid rgba(100,120,255,0.12)",
							transform: "rotateY(8deg) translateZ(-40px)",
							boxShadow: "0 25px 60px rgba(100,120,255,0.06)",
						}}
					>
						<div className="mb-4 flex items-center gap-2">
							<div className="h-2 w-2 rounded-full" style={{ backgroundColor: "#3cdcb4" }} />
							<span className="text-[11px] font-medium text-[#888]">Live Stempeluhr</span>
						</div>
						<div className="space-y-2.5">
							{[
								{ name: "Max M\u00fcller", time: "7:42", color: "#6478ff" },
								{ name: "Anna Schmidt", time: "5:18", color: "#c850c0" },
								{ name: "Lukas Weber", time: "8:01", color: "#3cdcb4" },
							].map((entry, i) => (
								<div key={i} className="flex items-center justify-between rounded-lg px-3 py-2.5" style={{ backgroundColor: "#fafafa" }}>
									<div className="flex items-center gap-2">
										<div
											className="flex h-6 w-6 items-center justify-center rounded-full text-[8px] font-bold text-white"
											style={{ backgroundColor: entry.color }}
										>
											{entry.name.split(" ").map(n => n[0]).join("")}
										</div>
										<span className="text-[12px] font-medium">{entry.name}</span>
									</div>
									<span className="text-[11px] font-medium" style={{ color: "#3cdcb4" }}>{entry.time}</span>
								</div>
							))}
						</div>
					</div>

					{/* Center card — main dashboard */}
					<div
						className="w-80 rounded-2xl bg-white p-6"
						style={{
							border: "1px solid rgba(200,80,192,0.12)",
							boxShadow: "0 30px 80px rgba(100,120,255,0.08), 0 10px 30px rgba(200,80,192,0.04)",
						}}
					>
						<div className="mb-4 flex items-center justify-between">
							<span className="text-[13px] font-semibold">Dashboard</span>
							<div className="flex gap-1.5">
								<div className="rounded-md px-2.5 py-1 text-[10px] text-[#888]" style={{ backgroundColor: "#fafafa" }}>Woche</div>
								<div
									className="rounded-md px-2.5 py-1 text-[10px] font-medium text-white"
									style={{ background: "linear-gradient(135deg, #6478ff, #c850c0)" }}
								>
									Monat
								</div>
							</div>
						</div>
						<div className="mb-4 grid grid-cols-2 gap-3">
							<div className="rounded-xl p-4" style={{ backgroundColor: "rgba(100,120,255,0.04)", border: "1px solid rgba(100,120,255,0.08)" }}>
								<div className="text-[10px] text-[#888]">Stunden</div>
								<div className="mt-1 text-[24px] font-bold tracking-tight">1.284</div>
							</div>
							<div className="rounded-xl p-4" style={{ backgroundColor: "rgba(255,80,136,0.04)", border: "1px solid rgba(255,80,136,0.08)" }}>
								<div className="text-[10px] text-[#888]">&Uuml;berstunden</div>
								<div className="mt-1 text-[24px] font-bold tracking-tight" style={{ color: "#ff5088" }}>48</div>
							</div>
						</div>
						<div className="flex h-28 items-end gap-1 rounded-xl p-3" style={{ backgroundColor: "#fafafa" }}>
							{[35, 55, 45, 70, 60, 80, 50, 65, 75, 42, 68, 82, 58, 72, 88, 55, 78, 62, 90, 70].map((h, i) => {
								const colors = ["#6478ff", "#8860e0", "#c850c0", "#ff5088", "#ffb347", "#3cdcb4"];
								return (
									<div
										key={i}
										className="flex-1 rounded-t-sm"
										style={{
											height: `${h}%`,
											backgroundColor: i >= 18 ? colors[i % 6] : "#e8e6ed",
										}}
									/>
								);
							})}
						</div>
					</div>

					{/* Right card — exports */}
					<div
						className="hidden w-72 rounded-2xl bg-white p-6 md:block"
						style={{
							border: "1px solid rgba(60,220,180,0.12)",
							transform: "rotateY(-8deg) translateZ(-40px)",
							boxShadow: "0 25px 60px rgba(60,220,180,0.06)",
						}}
					>
						<div className="mb-4 flex items-center gap-2">
							<span className="text-[11px] font-medium text-[#888]">Lohnexport</span>
						</div>
						<div className="space-y-2">
							{[
								{ name: "DATEV", status: "Exportiert", color: "#3cdcb4" },
								{ name: "Lexware", status: "Bereit", color: "#ffb347" },
								{ name: "Personio", status: "Exportiert", color: "#3cdcb4" },
							].map((item, i) => (
								<div key={i} className="flex items-center justify-between rounded-lg px-3 py-2.5" style={{ backgroundColor: "#fafafa" }}>
									<span className="text-[12px] font-medium">{item.name}</span>
									<span className="rounded-full px-2 py-0.5 text-[10px] font-medium" style={{ backgroundColor: `${item.color}15`, color: item.color }}>
										{item.status}
									</span>
								</div>
							))}
						</div>
						<div
							className="mt-4 rounded-lg px-3 py-2.5 text-center text-[11px] font-semibold text-white"
							style={{ background: "linear-gradient(135deg, #3cdcb4, #6478ff)" }}
						>
							Alle exportieren
						</div>
					</div>
				</div>
			</section>

			{/* Features */}
			<section id="features" className="relative z-10 px-8 py-24 lg:px-16" style={{ backgroundColor: "#fafafa", borderTop: "1px solid #f0f0f0" }}>
				<div className="mx-auto max-w-5xl">
					<div className="mb-14 text-center">
						<h2 className="text-[clamp(2rem,4vw,3rem)] font-bold tracking-[-0.03em]">
							Sechs Bausteine. Ein{" "}
							<span
								style={{
									background: "linear-gradient(135deg, #6478ff, #c850c0, #ff5088)",
									WebkitBackgroundClip: "text",
									WebkitTextFillColor: "transparent",
								}}
							>
								System
							</span>
							.
						</h2>
					</div>
					<div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
						{[
							{ title: "Stempeluhr", desc: "Ein Klick. Alle Ger\u00e4te. Sofort synchronisiert.", color: "#6478ff" },
							{ title: "GoBD-konform", desc: "Revisionssicher. Unantastbar. L\u00fcckenlos.", color: "#8860e0" },
							{ title: "Lohnexport", desc: "DATEV, Lexware, Personio, SAP. Automatisch.", color: "#c850c0" },
							{ title: "Multi-Tenant", desc: "Mandantenf\u00e4hig. Isoliert und skalierbar.", color: "#ff5088" },
							{ title: "Enterprise-SSO", desc: "SAML, OIDC, SCIM. Nahtlos integriert.", color: "#ffb347" },
							{ title: "Dashboards", desc: "\u00dcberstunden, Trends. Live und sofort.", color: "#3cdcb4" },
						].map((f, i) => (
							<div
								key={i}
								className="group relative overflow-hidden rounded-2xl bg-white p-6 transition-all hover:-translate-y-1"
								style={{ border: `1px solid ${f.color}12` }}
							>
								<div
									className="absolute inset-0 translate-x-[-100%] transition-transform duration-700 group-hover:translate-x-[100%]"
									style={{ background: `linear-gradient(90deg, transparent, ${f.color}06, transparent)` }}
								/>
								<div className="mb-3 flex h-2 w-8 rounded-full" style={{ backgroundColor: `${f.color}30` }} />
								<h3 className="mb-2 text-[15px] font-bold">{f.title}</h3>
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

			{/* Image */}
			<section className="relative z-10 mx-8 my-24 lg:mx-16">
				<div className="relative h-[35vh] overflow-hidden rounded-2xl" style={{ border: "1px solid rgba(100,120,255,0.08)" }}>
					<Image
						src="https://images.unsplash.com/photo-1557804506-669a67965ba0?w=1400&q=80&auto=format&fit=crop"
						alt=""
						fill
						className="object-cover"
						style={{ filter: "saturate(0.6) contrast(1.05)" }}
					/>
					<div className="absolute inset-0" style={{ background: "linear-gradient(135deg, rgba(100,120,255,0.05), rgba(200,80,192,0.03), transparent)" }} />
				</div>
			</section>

			{/* Contact */}
			<section id="contact" className="relative z-10 px-8 py-24 lg:px-16">
				<div className="mx-auto max-w-2xl text-center">
					<h2 className="mb-4 text-3xl font-bold tracking-[-0.02em]">
						Bereit f&uuml;r die{" "}
						<span
							style={{
								background: "linear-gradient(135deg, #6478ff, #c850c0, #ff5088)",
								WebkitBackgroundClip: "text",
								WebkitTextFillColor: "transparent",
							}}
						>
							Zentrale
						</span>
						?
					</h2>
					<p className="mb-8 text-[14px] text-[#888]">
						Kostenlos starten. Ohne Kreditkarte.
					</p>
					<div className="flex items-center justify-center gap-3">
						<a
							href="mailto:hello@z8.app"
							className="group relative overflow-hidden rounded-xl px-8 py-3.5 text-[14px] font-bold text-white"
							style={{ background: "linear-gradient(135deg, #6478ff, #c850c0)" }}
						>
							<span className="relative z-10">Kostenlos testen</span>
							<div
								className="absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100"
								style={{ background: "linear-gradient(135deg, #c850c0, #ff5088)" }}
							/>
						</a>
						<a href="mailto:hello@z8.app" className="rounded-xl px-8 py-3.5 text-[14px] text-[#888] transition-colors hover:text-[#18161f]" style={{ border: "1px solid #e0e0e0" }}>
							hello@z8.app
						</a>
					</div>
				</div>
			</section>

			{/* Footer */}
			<footer className="relative z-10 px-8 py-8 lg:px-16" style={{ borderTop: "1px solid #f0f0f0" }}>
				<div className="flex items-center justify-between text-[13px] text-[#ccc]">
					<span>&copy; 2025 Z8</span>
					<Link href="/" className="transition-colors hover:text-[#18161f]">&larr; Alle Designs</Link>
				</div>
			</footer>
		</div>
	);
}
