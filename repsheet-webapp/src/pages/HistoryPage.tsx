import { useInfiniteQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Empty, ErrorText } from "@/components/ui";
import { api, keys } from "@/lib/api/endpoints";
import { WorkoutRow } from "@/pages/HomePage";

const PER_PAGE = 20;

export function HistoryPage() {
	const { t } = useTranslation();
	const workouts = useInfiniteQuery({
		queryKey: [...keys.workouts, "history"],
		queryFn: ({ pageParam }) =>
			api.workouts({ page: pageParam, perPage: PER_PAGE }),
		initialPageParam: 1,
		getNextPageParam: (last) =>
			last.page * last.perPage < last.total ? last.page + 1 : undefined,
	});
	const items = workouts.data?.pages.flatMap((p) => p.items) ?? [];
	const total = workouts.data?.pages[0]?.total ?? 0;

	return (
		<main className="screen">
			<header className="bar">
				<h1 className="display page-title">{t("nav.history")}</h1>
				<span className="muted small">
					{t("common.workouts", { count: total })}
				</span>
			</header>
			{workouts.isError ? (
				<ErrorText>{t("history.loadFailed")}</ErrorText>
			) : null}
			{workouts.isSuccess && items.length === 0 ? (
				<Empty>{t("history.empty")}</Empty>
			) : null}
			{items.length > 0 ? (
				<ul className="card list list-grid">
					{items.map((w) => (
						<WorkoutRow key={w.id} workout={w} />
					))}
				</ul>
			) : null}
			{workouts.hasNextPage ? (
				<button
					type="button"
					className="btn"
					disabled={workouts.isFetchingNextPage}
					onClick={() => void workouts.fetchNextPage()}
				>
					{t("history.loadMore")}
				</button>
			) : null}
		</main>
	);
}
