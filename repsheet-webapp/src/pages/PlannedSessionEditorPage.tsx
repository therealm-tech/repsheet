import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { BlocksEditor } from "@/components/BlocksEditor";
import { lostAccess, NoLongerCoach } from "@/components/NoLongerCoach";
import { ErrorText } from "@/components/ui";
import { api, keys } from "@/lib/api/endpoints";
import { errorMessage } from "@/lib/api/errors";
import { today } from "@/lib/dates";
import {
	type Draft,
	draftFromTemplate,
	draftToInput,
	emptyDraft,
} from "@/lib/templates";

interface PlanDraft extends Draft {
	plannedOn: string;
}

/**
 * Plans a session for an athlete, or edits one: the template editor's blocks
 * with a day, no rest, and the catalog exercises the athlete can use.
 */
export function PlannedSessionEditorPage({
	athleteId,
	sessionId,
}: {
	athleteId: string;
	sessionId?: string;
}) {
	const { t } = useTranslation();
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const [draft, setDraft] = useState<PlanDraft | null>(() =>
		sessionId ? null : { ...emptyDraft(), plannedOn: today() },
	);
	const [error, setError] = useState<string | null>(null);
	const athlete = useQuery({
		queryKey: keys.athlete(athleteId),
		queryFn: () => api.athlete(athleteId),
	});
	const session = useQuery({
		queryKey: keys.plannedSession(sessionId ?? ""),
		queryFn: () => api.plannedSession(sessionId ?? ""),
		enabled: Boolean(sessionId),
	});

	useEffect(() => {
		if (draft === null && session.data) {
			setDraft({
				...draftFromTemplate(session.data),
				plannedOn: session.data.plannedOn,
			});
		}
	}, [draft, session.data]);

	const save = useMutation({
		mutationFn: ({ plannedOn, ...current }: PlanDraft) => {
			const body = { ...draftToInput(current), plannedOn };
			return sessionId
				? api.updatePlannedSession(sessionId, body)
				: api.createPlannedSession({ ...body, athleteId });
		},
		onSuccess: (saved) => {
			queryClient.setQueryData(keys.plannedSession(saved.id), saved);
			void queryClient.invalidateQueries({ queryKey: keys.plannedSessions });
			void navigate({
				to: "/coaching/athletes/$athleteId/sessions/$sessionId",
				params: { athleteId, sessionId: saved.id },
			});
		},
		onError: (err) => setError(errorMessage(err, { fallback: "saveFailed" })),
	});

	if (lostAccess(athlete.error) || lostAccess(session.error)) {
		return <NoLongerCoach />;
	}
	if (draft === null) {
		return <main className="screen muted">{t("common.loading")}</main>;
	}

	function submit() {
		if (!draft) {
			return;
		}
		if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.plannedOn)) {
			setError(t("errors.dateRequired"));
			return;
		}
		if (!draft.name.trim()) {
			setError(t("errors.sessionNameRequired"));
			return;
		}
		setError(null);
		save.mutate(draft);
	}

	const back = sessionId
		? ({
				to: "/coaching/athletes/$athleteId/sessions/$sessionId",
				params: { athleteId, sessionId },
			} as const)
		: ({ to: "/coaching/athletes/$athleteId", params: { athleteId } } as const);

	return (
		<main className="screen narrow">
			<header className="bar">
				<Link {...back} className="icon-button" aria-label={t("coaching.back")}>
					‹
				</Link>
				<h1 className="display page-title center grow truncate">
					{sessionId
						? t("plannedSession.editTitle")
						: t("plannedSession.newTitle", { name: athlete.data?.name ?? "" })}
				</h1>
				<button
					type="button"
					className="tag tag-orange tag-button"
					onClick={submit}
					disabled={save.isPending}
				>
					{t("common.ok")}
				</button>
			</header>
			<div className="row form-pair">
				<div className="grow">
					<label className="label" htmlFor="plan-date">
						{t("plannedSession.date")}
					</label>
					<input
						id="plan-date"
						className="input"
						type="date"
						value={draft.plannedOn}
						onChange={(e) => setDraft({ ...draft, plannedOn: e.target.value })}
					/>
				</div>
				<div className="grow">
					<label className="label" htmlFor="plan-name">
						{t("templateEditor.name")}
					</label>
					<input
						id="plan-name"
						className="input"
						placeholder="Upper push"
						value={draft.name}
						onChange={(e) => setDraft({ ...draft, name: e.target.value })}
					/>
				</div>
			</div>
			<div>
				<label className="label" htmlFor="plan-note">
					{t("templateEditor.note")}
				</label>
				<textarea
					id="plan-note"
					className="input textarea"
					placeholder={t("templateEditor.notePlaceholder")}
					value={draft.note}
					onChange={(e) => setDraft({ ...draft, note: e.target.value })}
				/>
			</div>
			<BlocksEditor
				blocks={draft.blocks}
				onChange={(blocks) => setDraft({ ...draft, blocks })}
				withRest={false}
				builtInOnly
			/>
			{error ? <ErrorText>{error}</ErrorText> : null}
			<button
				type="button"
				className="btn btn-primary"
				onClick={submit}
				disabled={save.isPending}
			>
				{t("plannedSession.save")}
			</button>
		</main>
	);
}
