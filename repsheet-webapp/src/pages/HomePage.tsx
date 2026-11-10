import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { AccountPanel } from "@/components/AccountPanel";
import { DateIcon } from "@/components/DateIcon";
import { Logo } from "@/components/Logo";
import { Empty, ErrorText, Sheet } from "@/components/ui";
import { WorkoutForm } from "@/components/WorkoutForm";
import { api, keys } from "@/lib/api/endpoints";
import { errorMessage } from "@/lib/api/errors";
import type {
	CreateWorkoutInput,
	PlannedSessionSummary,
	WorkoutSummary,
} from "@/lib/api/schemas";
import {
	formatDay,
	formatLongDay,
	formatMinutes,
	today,
	weekDays,
} from "@/lib/dates";
import { useMe } from "@/lib/hooks";

interface Draft {
	name: string;
	templateId?: string;
	/** Set when the workout is logged from a planned session. */
	planned?: PlannedSessionSummary;
}

/** A session a coach planned for the user, which they log like a template. */
function PlannedRow({
	session,
	onLog,
}: {
	session: PlannedSessionSummary;
	onLog: () => void;
}) {
	const { t } = useTranslation();
	const meta = [
		session.plannedOn === today()
			? t("home.plannedToday")
			: formatDay(session.plannedOn),
		t("common.blocks", { count: session.blockCount }),
		session.author ? t("home.plannedBy", { name: session.author.name }) : null,
	]
		.filter(Boolean)
		.join(" · ");
	return (
		<li>
			<button
				type="button"
				className="list-item"
				aria-label={t("home.logPlannedNamed", {
					name: session.name,
					day: formatDay(session.plannedOn),
				})}
				onClick={onLog}
			>
				<DateIcon day={session.plannedOn} />
				<span className="grow">
					<span className="strong">{session.name}</span>
					<span className="muted small line-block">{meta}</span>
				</span>
				{session.workoutCount > 0 ? (
					<span className="tag tag-ok">{t("athlete.status.logged")}</span>
				) : (
					<span className="accent">{t("home.logPlanned")}</span>
				)}
			</button>
		</li>
	);
}

export function WorkoutRow({ workout }: { workout: WorkoutSummary }) {
	const { t } = useTranslation();
	const meta = [
		formatDay(workout.performedOn),
		t("common.blocks", { count: workout.blockCount }),
		workout.durationMinutes === null
			? null
			: formatMinutes(workout.durationMinutes),
	]
		.filter(Boolean)
		.join(" · ");
	return (
		<li>
			<Link
				to="/workouts/$workoutId"
				params={{ workoutId: workout.id }}
				className="list-item"
			>
				<span className="list-icon" aria-hidden="true">
					{workout.templateId ? "◫" : "＋"}
				</span>
				<span className="grow">
					<span className="strong">{workout.name}</span>
					<span className="muted small line-block">{meta}</span>
				</span>
				<span className="muted" aria-hidden="true">
					›
				</span>
			</Link>
		</li>
	);
}

export function HomePage() {
	const { t } = useTranslation();
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const me = useMe();
	const workouts = useQuery({
		queryKey: [...keys.workouts, 1],
		queryFn: () => api.workouts({ perPage: 50 }),
	});
	const planned = useQuery({
		queryKey: [...keys.plannedSessions, "mine"],
		queryFn: () => api.plannedSessions({ perPage: 10 }),
	});
	const [choosingTemplate, setChoosingTemplate] = useState(false);
	const [draft, setDraft] = useState<Draft | null>(null);
	const [menuOpen, setMenuOpen] = useState(false);
	const templates = useQuery({
		queryKey: [...keys.templates, 1],
		queryFn: () => api.templates({ perPage: 100 }),
		enabled: choosingTemplate,
	});

	const start = useMutation({
		mutationFn: api.createWorkout,
		onSuccess: (workout) => {
			void queryClient.invalidateQueries({ queryKey: keys.workouts });
			void queryClient.invalidateQueries({ queryKey: keys.plannedSessions });
			void navigate({
				to: "/workouts/$workoutId",
				params: { workoutId: workout.id },
			});
		},
	});

	const items = workouts.data?.items ?? [];
	const now = new Date();
	const week = weekDays(
		now,
		items.map((w) => w.performedOn),
	);
	const done = week.filter((d) => d.hasWorkout).length;

	return (
		<main className="screen">
			<header className="bar mobile-only">
				<Logo width={46} />
				<div className="menu">
					<button
						type="button"
						className="icon-button"
						aria-label={t("account.menu")}
						aria-expanded={menuOpen}
						onClick={() => setMenuOpen((v) => !v)}
					>
						{me.data?.name.charAt(0).toUpperCase() ?? "·"}
					</button>
					{menuOpen ? (
						<div className="menu-panel">
							<AccountPanel />
						</div>
					) : null}
				</div>
			</header>

			<div>
				<p className="muted small">{formatLongDay(now)}</p>
				<h1 className="display page-title">
					{t("home.greeting", { name: me.data?.name ?? "" })}
				</h1>
			</div>

			<div className="home-grid">
				<div className="home-side">
					{planned.data && planned.data.items.length > 0 ? (
						<section aria-labelledby="planned-title" className="stack-tight">
							<div className="row">
								<h2 id="planned-title" className="display section-title">
									{t("home.planned")}
								</h2>
								<span className="grow" />
								<span className="muted small">
									{t("home.plannedCount", { count: planned.data.total })}
								</span>
							</div>
							<ul className="card list">
								{planned.data.items.map((session) => (
									<PlannedRow
										key={session.id}
										session={session}
										onLog={() =>
											setDraft({
												name: session.name,
												templateId: session.id,
												planned: session,
											})
										}
									/>
								))}
							</ul>
						</section>
					) : null}
					<section className="card stack-tight" aria-labelledby="start-title">
						<h2 id="start-title" className="display section-title">
							{t("home.logWorkout")}
						</h2>
						<button
							type="button"
							className="btn btn-primary"
							onClick={() => setDraft({ name: t("home.freeWorkoutName") })}
						>
							{t("home.freeWorkout")}
						</button>
						<button
							type="button"
							className="btn"
							onClick={() => setChoosingTemplate(true)}
						>
							{t("home.fromTemplate")}
						</button>
					</section>

					<section aria-labelledby="week-title" className="stack-tight">
						<div className="row">
							<h2 id="week-title" className="display section-title">
								{t("home.thisWeek")}
							</h2>
							<span className="grow" />
							<span className="muted small">
								{t("common.workouts", { count: done })}
							</span>
						</div>
						<ol className="week">
							{week.map((day) => (
								<li
									key={day.day}
									className={[
										"day",
										day.hasWorkout ? "worked" : "",
										day.isToday ? "today" : "",
									].join(" ")}
									aria-label={
										day.hasWorkout
											? t("home.dayWithWorkout", {
													day: formatLongDay(day.date),
												})
											: formatLongDay(day.date)
									}
								>
									{day.label}
								</li>
							))}
						</ol>
					</section>
				</div>

				<section aria-labelledby="recent-title" className="stack-tight">
					<h2 id="recent-title" className="display section-title">
						{t("home.recent")}
					</h2>
					{workouts.isError ? (
						<ErrorText>{t("home.loadFailed")}</ErrorText>
					) : null}
					{workouts.isSuccess && items.length === 0 ? (
						<Empty>{t("home.empty")}</Empty>
					) : (
						<ul className="card list">
							{items.slice(0, 5).map((w) => (
								<WorkoutRow key={w.id} workout={w} />
							))}
						</ul>
					)}
				</section>
			</div>

			{choosingTemplate ? (
				<Sheet
					title={t("home.chooseTemplate")}
					onClose={() => setChoosingTemplate(false)}
				>
					<h2 className="display sheet-title">{t("home.chooseTemplate")}</h2>
					<div className="sheet-body">
						{templates.isSuccess && templates.data.items.length === 0 ? (
							<Empty>
								{t("home.noTemplate")}{" "}
								<Link to="/templates/new">{t("home.createFirstTemplate")}</Link>
							</Empty>
						) : (
							<ul className="card list">
								{templates.data?.items.map((template) => (
									<li key={template.id}>
										<button
											type="button"
											className="list-item"
											onClick={() => {
												setChoosingTemplate(false);
												setDraft({
													name: template.name,
													templateId: template.id,
												});
											}}
										>
											<span className="grow">
												<span className="strong">{template.name}</span>
												<span className="muted small line-block">
													{t("common.blocks", { count: template.blockCount })}
												</span>
											</span>
											<span className="accent">{t("common.choose")}</span>
										</button>
									</li>
								))}
							</ul>
						)}
					</div>
				</Sheet>
			) : null}
			{draft ? (
				<Sheet
					title={t("workoutForm.newTitle")}
					onClose={() => {
						start.reset();
						setDraft(null);
					}}
				>
					<h2 className="display sheet-title">{t("workoutForm.newTitle")}</h2>
					<div className="sheet-body">
						{draft.planned ? (
							<p className="muted small">
								{t("home.plannedFrom", {
									name: draft.planned.name,
									day: formatDay(draft.planned.plannedOn),
								})}
							</p>
						) : null}
						<WorkoutForm
							title={t("workoutForm.newTitle")}
							submitLabel={t("workoutForm.create")}
							withNote={false}
							initial={{
								name: draft.name,
								performedOn: today(),
								durationMinutes: null,
								note: null,
							}}
							pending={start.isPending}
							error={
								start.isError
									? errorMessage(start.error, {
											fallback: "createWorkoutFailed",
										})
									: null
							}
							onCancel={() => {
								start.reset();
								setDraft(null);
							}}
							onSubmit={(values) => {
								const body: CreateWorkoutInput = {
									name: values.name,
									performedOn: values.performedOn,
								};
								if (values.durationMinutes !== null) {
									body.durationMinutes = values.durationMinutes;
								}
								if (draft.templateId) {
									body.templateId = draft.templateId;
								}
								start.mutate(body);
							}}
						/>
					</div>
				</Sheet>
			) : null}
		</main>
	);
}
