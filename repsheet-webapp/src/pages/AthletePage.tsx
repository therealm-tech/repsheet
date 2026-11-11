import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { AthleteProfileForm, TitledSheet } from "@/components/AthleteProfile";
import { DateIcon } from "@/components/DateIcon";
import { lostAccess, NoLongerCoach } from "@/components/NoLongerCoach";
import { ShareActions } from "@/components/ShareActions";
import { ConfirmButton, Empty, ErrorText, Sheet } from "@/components/ui";
import { WorkoutForm } from "@/components/WorkoutForm";
import { api, keys } from "@/lib/api/endpoints";
import { errorMessage } from "@/lib/api/errors";
import type { Athlete } from "@/lib/api/schemas";
import { formatDay, formatMinutes, today } from "@/lib/dates";
import { useAthletes, useMe } from "@/lib/hooks";
import { plannedStatus, STATUS_TAG } from "@/lib/planned";

/** Renames a profile the caller manages, changes its unit, or deletes it. */
function ProfileSheet({
	athlete,
	onClose,
}: {
	athlete: Athlete;
	onClose: () => void;
}) {
	const { t } = useTranslation();
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const update = useMutation({
		mutationFn: (body: { name: string; weightUnit: Athlete["weightUnit"] }) =>
			api.updateAthlete(athlete.id, body),
		onSuccess: (updated) => {
			queryClient.setQueryData(keys.athlete(athlete.id), updated);
			void queryClient.invalidateQueries({ queryKey: keys.athletes });
			onClose();
		},
	});
	const remove = useMutation({
		mutationFn: () => api.deleteAthlete(athlete.id),
		onSuccess: () => {
			queryClient.removeQueries({ queryKey: keys.athlete(athlete.id) });
			void queryClient.invalidateQueries({ queryKey: keys.athletes });
			void navigate({ to: "/athletes" });
		},
	});
	return (
		<TitledSheet
			title={t("athlete.profileTitle", { name: athlete.name })}
			onClose={onClose}
		>
			<AthleteProfileForm
				initial={athlete}
				submitLabel={t("common.save")}
				pending={update.isPending}
				error={
					update.isError
						? errorMessage(update.error, { fallback: "saveFailed" })
						: null
				}
				onSubmit={(values) => update.mutate(values)}
			/>
			<MergeProfile profile={athlete} onMerged={onClose} />
			{remove.isError ? (
				<ErrorText>
					{errorMessage(remove.error, { fallback: "deleteFailed" })}
				</ErrorText>
			) : null}
			<ConfirmButton
				label={t("athlete.deleteProfile")}
				confirmLabel={t("common.confirmDelete")}
				message={t("athlete.deleteMessage", { name: athlete.name })}
				onConfirm={() => remove.mutate()}
				disabled={remove.isPending}
			/>
		</TitledSheet>
	);
}

/**
 * Merges the profile into the account of the same athlete, among those who
 * added the caller as a coach, then opens that account.
 */
function MergeProfile({
	profile,
	onMerged,
}: {
	profile: Athlete;
	onMerged: () => void;
}) {
	const { t } = useTranslation();
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const selectId = useId();
	const accounts = (useAthletes().data?.items ?? []).filter(
		(athlete) => !athlete.managed,
	);
	const [accountId, setAccountId] = useState("");
	const merge = useMutation({
		mutationFn: (id: string) => api.mergeAthlete(profile.id, id),
		onSuccess: async (account) => {
			onMerged();
			queryClient.setQueryData(keys.athlete(account.id), account);
			await navigate({
				to: "/athletes/$athleteId",
				params: { athleteId: account.id },
			});
			queryClient.removeQueries({ queryKey: keys.athlete(profile.id) });
			for (const queryKey of [
				keys.athletes,
				keys.plannedSessions,
				keys.workouts,
				["performances"],
			]) {
				void queryClient.invalidateQueries({ queryKey });
			}
		},
	});
	if (accounts.length === 0) {
		return null;
	}
	const target = accounts.find((athlete) => athlete.id === accountId);
	return (
		<div className="stack-tight">
			<div>
				<label className="label" htmlFor={selectId}>
					{t("athlete.mergeInto")}
				</label>
				<select
					id={selectId}
					className="input"
					value={accountId}
					onChange={(e) => setAccountId(e.target.value)}
				>
					<option value="">{t("athlete.mergeChoose")}</option>
					{accounts.map((athlete) => (
						<option key={athlete.id} value={athlete.id}>
							{athlete.email
								? `${athlete.name} · ${athlete.email}`
								: athlete.name}
						</option>
					))}
				</select>
			</div>
			{merge.isError ? (
				<ErrorText>
					{errorMessage(merge.error, { fallback: "mergeFailed" })}
				</ErrorText>
			) : null}
			{target ? (
				<ConfirmButton
					label={t("athlete.merge")}
					confirmLabel={t("athlete.confirmMerge")}
					message={t("athlete.mergeMessage", {
						name: profile.name,
						account: target.name,
					})}
					onConfirm={() => merge.mutate(target.id)}
					disabled={merge.isPending}
				/>
			) : null}
		</div>
	);
}

/** Creates a one-time link that turns the profile into the athlete's account, and hands it out. */
function InviteCard({ athlete }: { athlete: Athlete }) {
	const { t } = useTranslation();
	const coachName = useMe().data?.name ?? "";
	const [link, setLink] = useState<string | null>(null);
	const create = useMutation({
		mutationFn: () => api.createInvitation(athlete.id),
		onSuccess: ({ token }) =>
			setLink(`${window.location.origin}/invite/${token}`),
	});
	return (
		<section className="invite-card" aria-labelledby="invite-title">
			<h2 id="invite-title" className="strong">
				{t("invite.cardTitle", { name: athlete.name })}
			</h2>
			<p className="muted small">{t("invite.cardIntro")}</p>
			{create.isError ? (
				<ErrorText>
					{errorMessage(create.error, { fallback: "saveFailed" })}
				</ErrorText>
			) : null}
			<button
				type="button"
				className="btn btn-ghost btn-small"
				disabled={create.isPending}
				onClick={() => create.mutate()}
			>
				{t("invite.create")}
			</button>
			{link ? (
				<TitledSheet
					title={t("invite.sheetTitle", { name: athlete.name })}
					onClose={() => setLink(null)}
				>
					<p className="muted small">
						{t("invite.sheetIntro", { name: athlete.name })}
					</p>
					<code className="link-box">{link}</code>
					<ShareActions
						text={t("invite.message", { coach: coachName, link })}
					/>
					<p className="muted small">{t("invite.validity")}</p>
				</TitledSheet>
			) : null}
		</section>
	);
}

/**
 * One athlete, as their coach sees them: the sessions planned for them, and
 * the workouts they shared, or all those of a profile the coach manages.
 */
export function AthletePage({ athleteId }: { athleteId: string }) {
	const { t } = useTranslation();
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const [planning, setPlanning] = useState(false);
	const [managing, setManaging] = useState(false);
	const athlete = useQuery({
		queryKey: keys.athlete(athleteId),
		queryFn: () => api.athlete(athleteId),
	});
	const sessions = useQuery({
		queryKey: [...keys.plannedSessions, athleteId],
		queryFn: () => api.plannedSessions({ athleteId, perPage: 50 }),
	});
	const shared = useQuery({
		queryKey: keys.sharedWorkouts(athleteId),
		queryFn: () => api.workouts({ athleteId, perPage: 50 }),
	});

	const create = useMutation({
		mutationFn: api.createPlannedSession,
		onSuccess: (session) => {
			queryClient.setQueryData(keys.plannedSession(session.id), session);
			void queryClient.invalidateQueries({ queryKey: keys.plannedSessions });
			void navigate({
				to: "/athletes/$athleteId/sessions/$sessionId",
				params: { athleteId, sessionId: session.id },
			});
		},
	});

	if ([athlete, sessions, shared].some((q) => lostAccess(q.error))) {
		return <NoLongerCoach />;
	}
	const now = today();
	const planned = sessions.data?.items ?? [];
	const workouts = shared.data?.items ?? [];
	const managed = athlete.data?.managed ?? false;

	return (
		<main className="screen narrow">
			<header className="bar">
				<Link
					to="/athletes"
					className="icon-button"
					aria-label={t("athlete.backToAthletes")}
				>
					‹
				</Link>
				<h1 className="display page-title center grow truncate">
					{athlete.data?.name ?? ""}
				</h1>
				{managed ? (
					<button
						type="button"
						className="icon-button"
						aria-label={t("athlete.manage", { name: athlete.data?.name })}
						onClick={() => setManaging(true)}
					>
						⋯
					</button>
				) : (
					<span className="icon-spacer" />
				)}
			</header>
			{managed ? (
				<span className="tag tag-ghost center-self">
					{t("athlete.managed")}
				</span>
			) : null}
			<button
				type="button"
				className="btn btn-primary"
				onClick={() => setPlanning(true)}
			>
				{t("athlete.planSession")}
			</button>

			<section className="stack-tight" aria-labelledby="planned-title">
				<h2 id="planned-title" className="display section-title">
					{t("athlete.planned")}
				</h2>
				{sessions.isError ? (
					<ErrorText>{t("athlete.loadFailed")}</ErrorText>
				) : null}
				{sessions.isSuccess && planned.length === 0 ? (
					<Empty>{t("athlete.plannedEmpty")}</Empty>
				) : null}
				{planned.length > 0 ? (
					<ul className="card list">
						{planned.map((session) => {
							const status = plannedStatus(session, now);
							return (
								<li key={session.id}>
									<Link
										to="/athletes/$athleteId/sessions/$sessionId"
										params={{ athleteId, sessionId: session.id }}
										className="list-item"
									>
										<DateIcon day={session.plannedOn} />
										<span className="grow">
											<span className="strong">{session.name}</span>
											<span className="muted small line-block">
												{formatDay(session.plannedOn)} ·{" "}
												{t("common.blocks", { count: session.blockCount })}
											</span>
										</span>
										<span className={STATUS_TAG[status]}>
											{t(`athlete.status.${status}`)}
										</span>
									</Link>
								</li>
							);
						})}
					</ul>
				) : null}
			</section>

			<section className="stack-tight" aria-labelledby="shared-title">
				<h2 id="shared-title" className="display section-title">
					{managed ? t("athlete.done") : t("athlete.shared")}
				</h2>
				{shared.isError ? (
					<ErrorText>{t("athlete.loadFailed")}</ErrorText>
				) : null}
				{shared.isSuccess && workouts.length === 0 ? (
					<Empty>
						{managed ? t("athlete.doneEmpty") : t("athlete.sharedEmpty")}
					</Empty>
				) : null}
				{workouts.length > 0 ? (
					<ul className="card list">
						{workouts.map((workout) => (
							<li key={workout.id}>
								<Link
									to="/athletes/$athleteId/workouts/$workoutId"
									params={{ athleteId, workoutId: workout.id }}
									className="list-item"
								>
									<DateIcon day={workout.performedOn} />
									<span className="grow">
										<span className="strong">{workout.name}</span>
										<span className="muted small line-block">
											{[
												formatDay(workout.performedOn),
												t("common.blocks", { count: workout.blockCount }),
												workout.durationMinutes === null
													? null
													: formatMinutes(workout.durationMinutes),
											]
												.filter(Boolean)
												.join(" · ")}
										</span>
									</span>
									{managed ? null : (
										<span className="tag">{t("athlete.sharedTag")}</span>
									)}
								</Link>
							</li>
						))}
					</ul>
				) : null}
			</section>

			{managed && athlete.data ? <InviteCard athlete={athlete.data} /> : null}

			{managing && athlete.data ? (
				<ProfileSheet
					athlete={athlete.data}
					onClose={() => setManaging(false)}
				/>
			) : null}

			{planning ? (
				<Sheet
					title={t("plannedSession.newTitle", {
						name: athlete.data?.name ?? "",
					})}
					onClose={() => {
						create.reset();
						setPlanning(false);
					}}
				>
					<h2 className="display sheet-title">
						{t("plannedSession.newTitle", { name: athlete.data?.name ?? "" })}
					</h2>
					<div className="sheet-body">
						<WorkoutForm
							title={t("plannedSession.newTitle", {
								name: athlete.data?.name ?? "",
							})}
							submitLabel={t("plannedSession.create")}
							withNote
							withDuration={false}
							notePlaceholder={t("plannedSession.notePlaceholder")}
							initial={{
								name: "",
								performedOn: today(),
								durationMinutes: null,
								note: null,
							}}
							pending={create.isPending}
							error={
								create.isError
									? errorMessage(create.error, { fallback: "saveFailed" })
									: null
							}
							onCancel={() => {
								create.reset();
								setPlanning(false);
							}}
							onSubmit={(values) =>
								create.mutate({
									athleteId,
									plannedOn: values.performedOn,
									name: values.name,
									note: values.note,
								})
							}
						/>
					</div>
				</Sheet>
			) : null}
		</main>
	);
}
