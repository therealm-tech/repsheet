import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ExerciseForm } from "@/components/ExerciseForm";
import { ConfirmButton, ErrorText } from "@/components/ui";
import { api, keys } from "@/lib/api/endpoints";
import { errorMessage } from "@/lib/api/errors";
import type { Exercise, UpdateExerciseInput } from "@/lib/api/schemas";
import { useIsSuperAdmin } from "@/lib/hooks";

/** Owners manage their custom exercises; super admins manage the catalog. */
export function canManageExercise(
	exercise: Exercise,
	superAdmin: boolean,
): boolean {
	return exercise.custom || superAdmin;
}

export function ExerciseActions({ exercise }: { exercise: Exercise }) {
	const { t } = useTranslation();
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const superAdmin = useIsSuperAdmin();
	const [editing, setEditing] = useState(false);

	const update = useMutation({
		mutationFn: (body: UpdateExerciseInput) =>
			api.updateExercise(exercise.id, body),
		onSuccess: (updated) => {
			queryClient.setQueryData(keys.exercise(exercise.id), updated);
			// Names appear inside workouts and templates too.
			void queryClient.invalidateQueries({
				predicate: (q) => q.queryKey[0] !== "me",
			});
			setEditing(false);
		},
	});

	const remove = useMutation({
		mutationFn: () => api.deleteExercise(exercise.id),
		onSuccess: () => {
			void queryClient.invalidateQueries({ queryKey: ["exercises"] });
			void navigate({ to: "/exercises" });
		},
	});

	if (!canManageExercise(exercise, superAdmin)) {
		return null;
	}

	if (editing) {
		return (
			<ExerciseForm
				title={t("exerciseForm.editTitle")}
				submitLabel={t("common.save")}
				initial={{
					names: {
						fr: exercise.names.fr ?? "",
						en: exercise.names.en ?? "",
					},
					modes: exercise.modes,
					defaultMode: exercise.defaultMode,
					load: exercise.load,
					equipment: exercise.equipment,
					defaultEquipment: exercise.defaultEquipment,
					unilateral: exercise.unilateral,
					builtIn: !exercise.custom,
				}}
				allowBuiltIn={false}
				catalog={!exercise.custom}
				pending={update.isPending}
				error={
					update.isError
						? errorMessage(update.error, {
								fallback: "updateFailed",
							})
						: null
				}
				onCancel={() => {
					update.reset();
					setEditing(false);
				}}
				onSubmit={({ builtIn: _builtIn, ...values }) => update.mutate(values)}
			/>
		);
	}

	return (
		<div className="stack-tight">
			<div className="row">
				{exercise.custom ? (
					<span className="tag">{t("exercise.customTag")}</span>
				) : (
					<span className="tag tag-orange">{t("exercise.catalogTag")}</span>
				)}
				<span className="grow" />
				<button
					type="button"
					className="btn btn-small"
					onClick={() => setEditing(true)}
				>
					{t("common.edit")}
				</button>
			</div>
			<ConfirmButton
				label={t("exercise.delete")}
				confirmLabel={t("common.confirmDelete")}
				message={
					exercise.custom
						? t("exercise.deleteCustomMessage")
						: t("exercise.deleteCatalogMessage")
				}
				onConfirm={() => remove.mutate()}
				disabled={remove.isPending}
			/>
			{remove.isError ? (
				<ErrorText>
					{errorMessage(remove.error, {
						fallback: "deleteFailed",
					})}
				</ErrorText>
			) : null}
		</div>
	);
}
