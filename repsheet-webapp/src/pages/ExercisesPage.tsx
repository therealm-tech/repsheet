import { useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { ExercisePicker } from "@/components/ExercisePicker";

export function ExercisesPage() {
	const { t } = useTranslation();
	const navigate = useNavigate();
	return (
		<main className="screen">
			<header className="bar">
				<h1 className="display page-title">{t("nav.exercises")}</h1>
			</header>
			<ExercisePicker
				wide
				actionLabel="›"
				onSelect={(exercise) =>
					void navigate({
						to: "/exercises/$exerciseId",
						params: { exerciseId: exercise.id },
					})
				}
			/>
		</main>
	);
}
