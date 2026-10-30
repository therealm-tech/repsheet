import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { BlockCard, PlannedBlockCard } from "@/components/BlockCard";
import { BlockSheet, type BlockSheetMode } from "@/components/BlockSheet";
import { ConfirmButton, ErrorText, Sheet } from "@/components/ui";
import { WorkoutForm } from "@/components/WorkoutForm";
import { api, keys } from "@/lib/api/endpoints";
import { errorMessage } from "@/lib/api/errors";
import type { UpdateWorkoutInput } from "@/lib/api/schemas";
import { formatDay, formatMinutes } from "@/lib/dates";
import { useUnit } from "@/lib/hooks";

export function WorkoutPage({ workoutId }: { workoutId: string }) {
	const { t } = useTranslation();
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const unit = useUnit();
	const [sheet, setSheet] = useState<BlockSheetMode | null>(null);
	const [editing, setEditing] = useState(false);
	const workout = useQuery({
		queryKey: keys.workout(workoutId),
		queryFn: () => api.workout(workoutId),
	});
	const templateId = workout.data?.templateId ?? null;
	const template = useQuery({
		queryKey: keys.template(templateId ?? ""),
		queryFn: () => api.template(templateId ?? ""),
		enabled: templateId !== null,
	});

	const update = useMutation({
		mutationFn: (body: UpdateWorkoutInput) =>
			api.updateWorkout(workoutId, body),
		onSuccess: (updated) => {
			queryClient.setQueryData(keys.workout(workoutId), updated);
			void queryClient.invalidateQueries({ queryKey: keys.workouts });
			// A new date changes which earlier sessions the comparisons use.
			void queryClient.invalidateQueries({ queryKey: ["performances"] });
			setEditing(false);
		},
	});

	const remove = useMutation({
		mutationFn: () => api.deleteWorkout(workoutId),
		onSuccess: () => {
			void queryClient.invalidateQueries({ queryKey: keys.workouts });
			void navigate({ to: "/" });
		},
	});

	if (workout.isPending) {
		return <main className="screen muted">{t("common.loading")}</main>;
	}
	if (workout.isError) {
		return (
			<main className="screen">
				<ErrorText>{t("workout.notFound")}</ErrorText>
				<Link to="/">{t("common.backHome")}</Link>
			</main>
		);
	}

	const w = workout.data;
	const loggedTemplateBlocks = new Set(
		w.blocks.map((b) => b.templateBlockId).filter(Boolean),
	);
	const planned = (template.data?.blocks ?? []).filter(
		(b) => !loggedTemplateBlocks.has(b.id),
	);
	const meta = [
		formatDay(w.performedOn),
		w.durationMinutes === null ? null : formatMinutes(w.durationMinutes),
	]
		.filter(Boolean)
		.join(" · ");

	return (
		<main className="screen with-fab">
			<header className="bar">
				<Link to="/" className="icon-button" aria-label={t("common.backHome")}>
					✕
				</Link>
				<button
					type="button"
					className="workout-title"
					aria-label={t("workout.editNamed", { name: w.name, meta })}
					onClick={() => setEditing(true)}
				>
					<span className="strong truncate">{w.name}</span>
					<span className="muted small">{meta}</span>
				</button>
				<button
					type="button"
					className="btn btn-primary btn-small desktop-only"
					onClick={() => setSheet({ kind: "new" })}
				>
					{t("workout.addBlock")}
				</button>
				<button
					type="button"
					className="icon-button"
					aria-label={t("workout.edit")}
					onClick={() => setEditing(true)}
				>
					✎
				</button>
			</header>

			<div className="workout-layout">
				<div className="workout-blocks">
					{w.blocks.length === 0 && planned.length === 0 ? (
						<p className="empty">{t("workout.empty")}</p>
					) : null}

					{w.blocks.map((block) => (
						<BlockCard
							key={block.id}
							block={block}
							workoutId={w.id}
							unit={unit}
							onOpen={() => setSheet({ kind: "edit", block })}
						/>
					))}
					{planned.map((block, i) => (
						<PlannedBlockCard
							key={block.id}
							block={block}
							index={w.blocks.length + i + 1}
							onOpen={() => setSheet({ kind: "new", templateBlock: block })}
						/>
					))}
				</div>

				<div className="workout-aside">
					{w.note ? <p className="workout-note">{w.note}</p> : null}
					<div className="stack-tight workout-actions">
						<Link
							to="/templates/new"
							search={{ fromWorkout: w.id }}
							className="btn"
						>
							{t("workout.createTemplate")}
						</Link>
						<ConfirmButton
							label={t("workout.delete")}
							confirmLabel={t("common.confirmDelete")}
							onConfirm={() => remove.mutate()}
							disabled={remove.isPending}
						/>
					</div>
				</div>
			</div>

			<div className="fab mobile-only">
				<button
					type="button"
					className="btn btn-primary btn-fab"
					onClick={() => setSheet({ kind: "new" })}
				>
					{t("workout.addBlock")}
				</button>
			</div>

			{editing ? (
				<Sheet title={t("workout.edit")} onClose={() => setEditing(false)}>
					<h2 className="display sheet-title">{t("workout.edit")}</h2>
					<div className="sheet-body">
						<WorkoutForm
							title={t("workout.edit")}
							submitLabel={t("common.save")}
							withNote
							initial={w}
							pending={update.isPending}
							error={
								update.isError
									? errorMessage(update.error, { fallback: "updateFailed" })
									: null
							}
							onCancel={() => {
								update.reset();
								setEditing(false);
							}}
							onSubmit={(values) => update.mutate(values)}
						/>
					</div>
				</Sheet>
			) : null}

			{sheet ? (
				<BlockSheet
					workoutId={w.id}
					mode={sheet}
					onClose={() => setSheet(null)}
				/>
			) : null}
		</main>
	);
}
