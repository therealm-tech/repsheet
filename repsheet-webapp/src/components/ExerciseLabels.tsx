import { useMutation, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { ErrorText } from "@/components/ui";
import { api, keys } from "@/lib/api/endpoints";
import type { Exercise } from "@/lib/api/schemas";
import { useExerciseLabels } from "@/lib/hooks";

const MAX_LABELS = 10;
const MAX_LABEL_LENGTH = 30;

export function LabelBadges({ labels }: { labels: string[] }) {
	if (labels.length === 0) {
		return null;
	}
	return (
		<span className="label-badges">
			{labels.map((label) => (
				<span key={label} className="tag tag-label">
					{label}
				</span>
			))}
		</span>
	);
}

/** The caller's own labels on an exercise, which nobody else sees. */
export function ExerciseLabelsEditor({ exercise }: { exercise: Exercise }) {
	const { t } = useTranslation();
	const queryClient = useQueryClient();
	const suggestionsId = useId();
	const [draft, setDraft] = useState("");
	const known = useExerciseLabels();
	const save = useMutation({
		mutationFn: (labels: string[]) =>
			api.replaceExerciseLabels(exercise.id, labels),
		onSuccess: ({ labels }) => {
			queryClient.setQueryData<Exercise>(keys.exercise(exercise.id), (old) =>
				old ? { ...old, labels } : old,
			);
			void queryClient.invalidateQueries({ queryKey: ["exercises"] });
			void queryClient.invalidateQueries({ queryKey: keys.exerciseLabels });
			setDraft("");
		},
	});
	const suggestions = (known.data?.items ?? [])
		.map((label) => label.name)
		.filter((name) => !exercise.labels.includes(name));

	const add = (event: FormEvent) => {
		event.preventDefault();
		const label = draft.trim();
		if (label) {
			save.mutate([...exercise.labels, label]);
		}
	};

	return (
		<section className="stack-tight" aria-label={t("labels.title")}>
			{exercise.labels.length > 0 ? (
				<ul className="label-badges">
					{exercise.labels.map((label) => (
						<li key={label} className="tag tag-label">
							{label}
							<button
								type="button"
								className="tag-remove"
								aria-label={t("labels.remove", { label })}
								disabled={save.isPending}
								onClick={() =>
									save.mutate(exercise.labels.filter((l) => l !== label))
								}
							>
								×
							</button>
						</li>
					))}
				</ul>
			) : null}
			{exercise.labels.length < MAX_LABELS ? (
				<form className="row" onSubmit={add}>
					<input
						className="input grow"
						list={suggestionsId}
						maxLength={MAX_LABEL_LENGTH}
						aria-label={t("labels.new")}
						placeholder={t("labels.new")}
						value={draft}
						onChange={(e) => setDraft(e.target.value)}
					/>
					<datalist id={suggestionsId}>
						{suggestions.map((name) => (
							<option key={name} value={name} />
						))}
					</datalist>
					<button
						type="submit"
						className="btn btn-ghost btn-small"
						disabled={save.isPending || !draft.trim()}
					>
						{t("labels.add")}
					</button>
				</form>
			) : null}
			{save.isError ? <ErrorText>{t("labels.saveFailed")}</ErrorText> : null}
		</section>
	);
}
