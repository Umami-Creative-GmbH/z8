import Image from "next/image";
import Link from "next/link";

const logos = ["DATEV", "Lexware", "Personio", "SAP", "Sage"];

export default function DesignP6() {
	return (
		<div
			className="min-h-screen"
			style={{
				fontFamily: "'Outfit', 'Manrope', 'General Sans', sans-serif",
				backgroundColor: "#fafafe",
				color: "#18161f",
			}}
		>
			{/* Prismatic gradient header bar */}
			<div
				className="relative z-20 flex items-center justify-center py-2.5"
				style={{
					background: "linear-gradient(90deg, #6478ff, #8860e0, #c850c0, #ff5088, #ffb347, #3cdcb4)",
				}}
			>
				<span className="text-[11px] font-semibold text-white/90">
					Z8 v4 ist da &mdash; Jetzt mit prismatischen Dashboards.
				</span>
			</div>

			{/* Header */}
			<header className="relative z-20 flex items-center justify-between px-8 py-5 lg:px-16">
				<div className="flex items-center gap-8">
					<span
						className="text-[22px] font-bold tracking-[-0.02em]"
						style={{
							background: "linear-gradient(135deg, #6478ff, #c850c0)",
							WebkitBackgroundClip: "text",
							WebkitTextFillColor: "transparent",
						}}
					>
						Z8
					</span>
					<nav className="hidden items-center gap-6 text-[14px] text-[#8a8696] md:flex">
						<a href="#features" className="transition-colors hover:text-[#18161f]">Funktionen</a>
						<a href="#product" className="transition-colors hover:text-[#18161f]">Produkt</a>
						<a href="#contact" className="transition-colors hover:text-[#18161f]">Preise</a>
					</nav>
				</div>
				<div className="flex items-center gap-3">
					<a href="#contact" className="text-[14px] text-[#8a8696] transition-colors hover:text-[#18161f]">Anmelden</a>
					<a
						href="#contact"
						className="rounded-xl px-5 py-2.5 text-[14px] font-semibold text-white transition-all hover:opacity-90"
						style={{ background: "linear-gradient(135deg, #6478ff, #c850c0)" }}
					>
						Kostenlos starten
					</a>
				</div>
			</header>

			{/* Hero — centered with gradient text and glass dashboard */}
			<section className="relative z-10 px-8 pb-32 pt-28 lg:px-14">
				{/* Subtle prismatic ambient */}
				<div
					className="pointer-events-none absolute inset-0"
					style={{
						background:
							"radial-gradient(ellipse 60% 40% at 50% 0%, rgba(100,120,255,0.06) 0%, transparent 50%), radial-gradient(ellipse 40% 30% at 80% 80%, rgba(200,80,192,0.04) 0%, transparent 50%)",
					}}
				/>

				<div className="relative mx-auto max-w-5xl text-center">
					{/* Badge */}
					<div
						className="animate-fade-up mx-auto mb-8 inline-flex items-center gap-2 rounded-full px-4 py-2 text-[12px] font-medium"
						style={{
							background: "linear-gradient(135deg, rgba(100,120,255,0.06), rgba(200,80,192,0.06))",
							border: "1px solid rgba(100,120,255,0.12)",
							animationDelay: "0.05s",
						}}
					>
						<span className="h-1.5 w-1.5 rounded-full" style={{ background: "linear-gradient(135deg, #6478ff, #c850c0)" }} />
						<span style={{ color: "#8860e0" }}>Version 4.0 &mdash; Jetzt verf&uuml;gbar</span>
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
								background: "linear-gradient(135deg, #6478ff, #8860e0, #c850c0, #ff5088, #ffb347, #3cdcb4)",
								WebkitBackgroundClip: "text",
								WebkitTextFillColor: "transparent",
							}}
						>
							neu definiert
						</span>
						.
					</h1>

					<p
						className="animate-fade-up mx-auto mt-6 max-w-lg text-[16px] leading-[1.8] text-[#8a8696]"
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
							className="group relative overflow-hidden rounded-xl px-8 py-4 text-[14px] font-bold text-white"
							style={{ background: "linear-gradient(135deg, #6478ff, #c850c0)" }}
						>
							<span className="relative z-10">Kostenlos starten</span>
							<div
								className="absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100"
								style={{ background: "linear-gradient(135deg, #c850c0, #ff5088, #ffb347)" }}
							/>
						</a>
						<a
							href="#contact"
							className="rounded-xl px-8 py-4 text-[14px] text-[#8a8696] transition-colors hover:text-[#18161f]"
							style={{ border: "1px solid #e4e2ea" }}
						>
							Demo ansehen
						</a>
					</div>
				</div>

				{/* Glass dashboard with prismatic accents */}
				<div className="animate-scale-in mx-auto mt-20 max-w-4xl" style={{ animationDelay: "0.6s" }}>
					<div
						className="relative overflow-hidden rounded-2xl bg-white"
						style={{
							boxShadow: "0 30px 80px rgba(100,120,255,0.08), 0 10px 30px rgba(200,80,192,0.04), inset 0 1px 0 rgba(255,255,255,0.8)",
							border: "1px solid rgba(100,120,255,0.1)",
						}}
					>
						{/* Window bar */}
						<div className="flex items-center gap-2 px-5 py-3" style={{ borderBottom: "1px solid #f0eef4", backgroundColor: "#fbfafe" }}>
							<div className="flex gap-1.5">
								<div className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: "#6478ff" }} />
								<div className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: "#c850c0" }} />
								<div className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: "#3cdcb4" }} />
							</div>
							<div className="ml-4 flex-1">
								<div className="mx-auto max-w-xs rounded-lg px-4 py-1.5 text-center text-[10px] text-[#8a8696]" style={{ backgroundColor: "#f7f6f9" }}>
									z8.app
								</div>
							</div>
						</div>
						{/* Dashboard content */}
						<div className="p-6">
							<div className="mb-6 grid grid-cols-4 gap-3">
								{[
									{ label: "Aktive Nutzer", value: "127", change: "+12%", color: "#6478ff" },
									{ label: "Stunden (heute)", value: "842", change: "+3%", color: "#c850c0" },
									{ label: "\u00dcberstunden", value: "48", change: "-8%", color: "#ff5088" },
									{ label: "GoBD-Status", value: "100%", change: "Konform", color: "#3cdcb4" },
								].map((s, i) => (
									<div
										key={i}
										className="rounded-xl p-4"
										style={{
											backgroundColor: `${s.color}06`,
											border: `1px solid ${s.color}10`,
										}}
									>
										<div className="text-[10px] text-[#8a8696]">{s.label}</div>
										<div className="mt-1 flex items-end gap-2">
											<span className="text-[22px] font-bold tracking-tight">{s.value}</span>
											<span className="mb-1 text-[10px] font-medium" style={{ color: s.color }}>{s.change}</span>
										</div>
									</div>
								))}
							</div>
							{/* Chart with rainbow bars */}
							<div
								className="flex h-36 items-end gap-1 rounded-xl p-4"
								style={{ backgroundColor: "#fbfafe", border: "1px solid #f0eef4" }}
							>
								{[30, 45, 38, 60, 52, 70, 48, 65, 55, 72, 60, 80, 55, 68, 75, 50, 78, 62, 85, 72, 90, 68, 82, 75].map((h, i) => {
									const colors = ["#6478ff", "#8860e0", "#c850c0", "#ff5088", "#ffb347", "#3cdcb4"];
									return (
										<div
											key={i}
											className="flex-1 rounded-t-sm transition-all"
											style={{
												height: `${h}%`,
												backgroundColor: i >= 18 ? colors[i % 6] : "#e8e6ed",
											}}
										/>
									);
								})}
							</div>
						</div>
					</div>
					{/* Rainbow reflection */}
					<div
						className="mx-auto mt-3 h-[1px] max-w-md"
						style={{
							background: "linear-gradient(90deg, transparent, #6478ff20, #c850c020, #ff508820, #ffb34720, #3cdcb420, transparent)",
						}}
					/>
				</div>
			</section>

			{/* Logo bar */}
			<section className="relative z-10 px-8 py-16 lg:px-16" style={{ borderTop: "1px solid #f0eef4" }}>
				<div className="flex flex-wrap items-center justify-center gap-12">
					<span
						className="text-[11px] font-bold uppercase tracking-[0.2em]"
						style={{
							background: "linear-gradient(90deg, #6478ff80, #c850c080)",
							WebkitBackgroundClip: "text",
							WebkitTextFillColor: "transparent",
						}}
					>
						Vertraut von
					</span>
					{logos.map((logo, i) => (
						<span key={i} className="text-[18px] font-bold text-[#d0d0d8]" style={{ letterSpacing: "-0.01em" }}>
							{logo}
						</span>
					))}
				</div>
			</section>

			{/* Features */}
			<section id="features" className="relative z-10 px-8 py-24 lg:px-14" style={{ backgroundColor: "#f7f6f9" }}>
				<div className="mx-auto max-w-5xl">
					<div className="mb-14 text-center">
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
							Alles an einem Ort.
						</h2>
					</div>
					<div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
						{[
							{ title: "Stempeluhr", desc: "Ein Klick. Alle Ger\u00e4te. Sofort synchronisiert.", color: "#6478ff", gradient: "135deg, #6478ff, #818cf8" },
							{ title: "GoBD-konform", desc: "Revisionssicher. Unantastbar. L\u00fcckenlos.", color: "#8860e0", gradient: "135deg, #8860e0, #a78bfa" },
							{ title: "Lohnexport", desc: "DATEV, Lexware, Personio, SAP. Automatisch.", color: "#c850c0", gradient: "135deg, #c850c0, #d884d8" },
							{ title: "Multi-Tenant", desc: "Mandantenf\u00e4hig. Isoliert und skalierbar.", color: "#ff5088", gradient: "135deg, #ff5088, #f472b6" },
							{ title: "Enterprise-SSO", desc: "SAML, OIDC, SCIM. Nahtlos integriert.", color: "#ffb347", gradient: "135deg, #ffb347, #fbbf24" },
							{ title: "Dashboards", desc: "\u00dcberstunden, Trends. Live und sofort.", color: "#3cdcb4", gradient: "135deg, #3cdcb4, #34d399" },
						].map((f, i) => (
							<div
								key={i}
								className="group relative overflow-hidden rounded-2xl bg-white p-6 transition-all duration-300 hover:-translate-y-1"
								style={{ border: `1px solid ${f.color}12` }}
							>
								<div
									className="absolute inset-0 translate-x-[-100%] transition-transform duration-700 group-hover:translate-x-[100%]"
									style={{ background: `linear-gradient(90deg, transparent, ${f.color}06, transparent)` }}
								/>
								<div
									className="mb-4 flex h-9 w-9 items-center justify-center rounded-xl text-[11px] font-bold text-white"
									style={{ background: `linear-gradient(${f.gradient})` }}
								>
									{String(i + 1).padStart(2, "0")}
								</div>
								<h3 className="mb-2 text-[15px] font-bold transition-colors group-hover:text-[#18161f]">{f.title}</h3>
								<p className="text-[13px] leading-[1.7] text-[#8a8696]">{f.desc}</p>
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
			<section className="relative z-10 mx-8 my-24 lg:mx-14">
				<div className="relative h-[30vh] overflow-hidden rounded-2xl" style={{ border: "1px solid rgba(100,120,255,0.08)" }}>
					<Image
						src="https://images.unsplash.com/photo-1600880292203-757bb62b4baf?w=1400&q=80&auto=format&fit=crop"
						alt=""
						fill
						className="object-cover"
						style={{ filter: "saturate(0.5) brightness(0.95) contrast(1.05)" }}
					/>
					<div className="absolute inset-0" style={{ background: "linear-gradient(135deg, rgba(100,120,255,0.05), rgba(200,80,192,0.03), transparent)" }} />
				</div>
			</section>

			{/* Quote */}
			<section className="relative z-10 px-8 py-24 lg:px-14">
				<div className="mx-auto max-w-2xl text-center">
					<div className="mb-6 flex justify-center">
						<div
							className="h-px w-40"
							style={{ background: "linear-gradient(90deg, transparent, #6478ff20, #c850c020, #ff508820, #3cdcb420, transparent)" }}
						/>
					</div>
					<blockquote className="text-[clamp(1.5rem,3.5vw,2.5rem)] font-bold leading-[1.35] tracking-[-0.02em]">
						Die Zukunft der Arbeit{" "}
						<span
							style={{
								background: "linear-gradient(135deg, #6478ff, #c850c0, #ff5088, #3cdcb4)",
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
						background: "linear-gradient(135deg, rgba(100,120,255,0.06), rgba(200,80,192,0.04), rgba(60,220,180,0.05))",
						border: "1px solid rgba(100,120,255,0.1)",
					}}
				>
					<h2 className="mb-4 text-3xl font-bold tracking-[-0.02em]">
						Bereit f&uuml;r die{" "}
						<span
							style={{
								background: "linear-gradient(135deg, #6478ff, #c850c0, #ff5088)",
								WebkitBackgroundClip: "text",
								WebkitTextFillColor: "transparent",
							}}
						>
							Zukunft
						</span>
						?
					</h2>
					<p className="mb-8 text-[14px] text-[#8a8696]">
						Starten Sie kostenlos. Upgraden Sie, wenn Sie bereit sind.
					</p>
					<div className="flex items-center justify-center gap-3">
						<a
							href="mailto:hello@z8.app"
							className="group relative overflow-hidden rounded-xl px-8 py-4 text-[14px] font-bold text-white"
							style={{ background: "linear-gradient(135deg, #6478ff, #c850c0)" }}
						>
							<span className="relative z-10">Kostenlos starten</span>
							<div
								className="absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100"
								style={{ background: "linear-gradient(135deg, #c850c0, #ff5088)" }}
							/>
						</a>
						<a href="mailto:hello@z8.app" className="rounded-xl px-8 py-4 text-[14px] text-[#8a8696] transition-colors hover:text-[#18161f]" style={{ border: "1px solid #e4e2ea" }}>
							hello@z8.app
						</a>
					</div>
				</div>
			</section>

			{/* Footer */}
			<footer className="relative z-10 px-8 py-8 lg:px-14">
				<div
					className="h-[1px]"
					style={{
						background: "linear-gradient(90deg, #6478ff10, #c850c010, #ff508810, #3cdcb410, transparent)",
					}}
				/>
				<div className="flex items-center justify-between pt-6 text-[13px] text-[#c0bcc8]">
					<span>&copy; 2025 Z8</span>
					<Link href="/" className="transition-colors hover:text-[#18161f]">&larr; Alle Designs</Link>
				</div>
			</footer>
		</div>
	);
}
