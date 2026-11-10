import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ErrorText } from "@/components/ui";
import { api, keys } from "@/lib/api/endpoints";
import { errorMessage } from "@/lib/api/errors";

/** One switch per coach of the athlete; hidden while they have none. */
export function ShareWithCoaches({ workoutId }: { workoutId: string }) {
	const { t } = useTranslation();
	const queryClient = useQueryClient();
	const coaches = useQuery({
		queryKey: [...keys.coaches, 1],
		queryFn: () => api.coaches({ perPage: 100 }),
	});
	const hasCoach = (coaches.data?.items.length ?? 0) > 0;
	const shares = useQuery({
		queryKey: keys.workoutShares(workoutId),
		queryFn: () => api.workoutShares(workoutId),
		enabled: hasCoach,
	});
	const toggle = useMutation({
		mutationFn: ({ coachId, share }: { coachId: string; share: boolean }) =>
			share
				? api.shareWorkout(workoutId, coachId)
				: api.unshareWorkout(workoutId, coachId),
		onSettled: () =>
			queryClient.invalidateQueries({
				queryKey: keys.workoutShares(workoutId),
			}),
	});

	if (!hasCoach) {
		return null;
	}
	const shared = new Set(shares.data?.items.map((s) => s.coachId));
	return (
		<section className="card stack-tight" aria-labelledby="share-title">
			<h2 id="share-title" className="display section-title">
				{t("share.title")}
			</h2>
			<p className="muted small">{t("share.intro")}</p>
			<ul className="list share-list">
				{coaches.data?.items.map((coach) => {
					const on = shared.has(coach.id);
					return (
						<li key={coach.id} className="list-item">
							<span className="list-icon" aria-hidden="true">
								{coach.name.charAt(0).toUpperCase()}
							</span>
							<span className="grow">
								<span className="strong">{coach.name}</span>
								<span className="muted small line-block">
									{on ? t("share.shared") : t("share.notShared")}
								</span>
							</span>
							<button
								type="button"
								role="switch"
								aria-checked={on}
								aria-label={t("share.shareWith", { name: coach.name })}
								className={on ? "tag tag-orange tag-button" : "tag tag-button"}
								disabled={!shares.isSuccess || toggle.isPending}
								onClick={() => toggle.mutate({ coachId: coach.id, share: !on })}
							>
								{on ? "✓" : "＋"}
							</button>
						</li>
					);
				})}
			</ul>
			{toggle.isError ? (
				<ErrorText>
					{errorMessage(toggle.error, { fallback: "shareFailed" })}
				</ErrorText>
			) : null}
		</section>
	);
}
