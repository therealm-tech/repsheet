import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { BlocksEditor } from "@/components/BlocksEditor";
import { ConfirmButton, ErrorText } from "@/components/ui";
import { api, keys } from "@/lib/api/endpoints";
import { errorMessage } from "@/lib/api/errors";
import {
	type Draft,
	draftFromTemplate,
	draftFromWorkout,
	draftToInput,
	emptyDraft,
} from "@/lib/templates";

export function TemplateEditorPage({
	templateId,
	fromWorkout,
}: {
	templateId?: string;
	fromWorkout?: string;
}) {
	const { t } = useTranslation();
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const [draft, setDraft] = useState<Draft | null>(() =>
		templateId || fromWorkout ? null : emptyDraft(),
	);
	const [error, setError] = useState<string | null>(null);

	const template = useQuery({
		queryKey: keys.template(templateId ?? ""),
		queryFn: () => api.template(templateId ?? ""),
		enabled: Boolean(templateId),
	});
	const workout = useQuery({
		queryKey: keys.workout(fromWorkout ?? ""),
		queryFn: () => api.workout(fromWorkout ?? ""),
		enabled: Boolean(fromWorkout) && !templateId,
	});

	useEffect(() => {
		if (draft !== null) {
			return;
		}
		if (template.data) {
			setDraft(draftFromTemplate(template.data));
		} else if (workout.data) {
			setDraft(draftFromWorkout(workout.data));
		}
	}, [draft, template.data, workout.data]);

	const save = useMutation({
		mutationFn: (current: Draft) => {
			const body = draftToInput(current);
			return templateId
				? api.updateTemplate(templateId, body)
				: api.createTemplate(body);
		},
		onSuccess: (saved) => {
			queryClient.setQueryData(keys.template(saved.id), saved);
			void queryClient.invalidateQueries({ queryKey: keys.templates });
			void navigate({ to: "/templates" });
		},
		onError: (err) => setError(errorMessage(err, { fallback: "saveFailed" })),
	});

	const remove = useMutation({
		mutationFn: () => api.deleteTemplate(templateId ?? ""),
		onSuccess: () => {
			void queryClient.invalidateQueries({ queryKey: keys.templates });
			void navigate({ to: "/templates" });
		},
	});

	if (template.isError || workout.isError) {
		return (
			<main className="screen narrow">
				<ErrorText>{t("templateEditor.loadFailed")}</ErrorText>
				<Link to="/templates">{t("templateEditor.back")}</Link>
			</main>
		);
	}
	if (draft === null) {
		return <main className="screen muted">{t("common.loading")}</main>;
	}

	function submit() {
		if (!draft) {
			return;
		}
		if (!draft.name.trim()) {
			setError(t("errors.templateNameRequired"));
			return;
		}
		setError(null);
		save.mutate(draft);
	}

	return (
		<main className="screen narrow">
			<header className="bar">
				<Link
					to="/templates"
					className="icon-button"
					aria-label={t("templateEditor.back")}
				>
					‹
				</Link>
				<h1 className="display page-title center grow">
					{templateId
						? t("templateEditor.editTitle")
						: t("templateEditor.newTitle")}
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
			<div>
				<label className="label" htmlFor="template-name">
					{t("templateEditor.name")}
				</label>
				<input
					id="template-name"
					className="input"
					placeholder="Push A"
					value={draft.name}
					onChange={(e) => setDraft({ ...draft, name: e.target.value })}
				/>
			</div>
			<div>
				<label className="label" htmlFor="template-note">
					{t("templateEditor.note")}
				</label>
				<textarea
					id="template-note"
					className="input textarea"
					placeholder={t("templateEditor.notePlaceholder")}
					value={draft.note}
					onChange={(e) => setDraft({ ...draft, note: e.target.value })}
				/>
			</div>
			<BlocksEditor
				blocks={draft.blocks}
				onChange={(blocks) => setDraft({ ...draft, blocks })}
			/>
			{error ? <ErrorText>{error}</ErrorText> : null}
			<button
				type="button"
				className="btn btn-primary"
				onClick={submit}
				disabled={save.isPending}
			>
				{t("templateEditor.save")}
			</button>
			{templateId ? (
				<ConfirmButton
					label={t("templateEditor.delete")}
					confirmLabel={t("common.confirmDelete")}
					onConfirm={() => remove.mutate()}
					disabled={remove.isPending}
				/>
			) : null}
		</main>
	);
}
