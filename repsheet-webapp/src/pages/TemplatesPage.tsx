import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Empty, ErrorText, Sheet } from "@/components/ui";
import { api, keys } from "@/lib/api/endpoints";
import { formatDay, formatShortInstant } from "@/lib/dates";

export function TemplatesPage() {
	const { t } = useTranslation();
	const [pickingWorkout, setPickingWorkout] = useState(false);
	const templates = useQuery({
		queryKey: [...keys.templates, 1],
		queryFn: () => api.templates({ perPage: 100 }),
	});
	const workouts = useQuery({
		queryKey: [...keys.workouts, 1],
		queryFn: () => api.workouts({ perPage: 50 }),
		enabled: pickingWorkout,
	});
	const items = templates.data?.items ?? [];

	return (
		<main className="screen">
			<header className="bar">
				<h1 className="display page-title">{t("nav.templates")}</h1>
			</header>
			<p className="muted small">{t("templates.intro")}</p>
			<div className="stack-tight">
				<Link to="/templates/new" className="btn btn-primary">
					{t("templates.new")}
				</Link>
				<button
					type="button"
					className="btn"
					onClick={() => setPickingWorkout(true)}
				>
					{t("templates.fromWorkout")}
				</button>
			</div>
			{templates.isError ? (
				<ErrorText>{t("templates.loadFailed")}</ErrorText>
			) : null}
			{templates.isSuccess && items.length === 0 ? (
				<Empty>{t("templates.empty")}</Empty>
			) : null}
			{items.length > 0 ? (
				<ul className="card list list-grid">
					{items.map((template) => (
						<li key={template.id}>
							<Link
								to="/templates/$templateId"
								params={{ templateId: template.id }}
								className="list-item"
							>
								<span className="list-icon" aria-hidden="true">
									◫
								</span>
								<span className="grow">
									<span className="strong">{template.name}</span>
									<span className="muted small line-block">
										{t("common.blocks", { count: template.blockCount })} ·{" "}
										{t("templates.updated", {
											date: formatShortInstant(template.updatedAt),
										})}
									</span>
								</span>
								<span className="muted" aria-hidden="true">
									›
								</span>
							</Link>
						</li>
					))}
				</ul>
			) : null}

			{pickingWorkout ? (
				<Sheet
					title={t("templates.chooseWorkout")}
					onClose={() => setPickingWorkout(false)}
				>
					<h2 className="display sheet-title">
						{t("templates.chooseWorkout")}
					</h2>
					<div className="sheet-body">
						{workouts.isSuccess && workouts.data.items.length === 0 ? (
							<Empty>{t("templates.noWorkout")}</Empty>
						) : null}
						<ul className="card list">
							{workouts.data?.items.map((w) => (
								<li key={w.id}>
									<Link
										to="/templates/new"
										search={{ fromWorkout: w.id }}
										className="list-item"
									>
										<span className="grow">
											<span className="strong">{w.name}</span>
											<span className="muted small line-block">
												{formatDay(w.performedOn)} ·{" "}
												{t("common.blocks", { count: w.blockCount })}
											</span>
										</span>
										<span className="accent">{t("common.choose")}</span>
									</Link>
								</li>
							))}
						</ul>
					</div>
				</Sheet>
			) : null}
		</main>
	);
}
