import { useQueries } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Empty, ErrorText } from "@/components/ui";
import { api, keys } from "@/lib/api/endpoints";
import type { LinkedAccount, PlannedSessionSummary } from "@/lib/api/schemas";
import { formatDay, formatShortInstant, today } from "@/lib/dates";
import { useAthletes } from "@/lib/hooks";
import { outlook, plannedStatus, STATUS_TAG } from "@/lib/planned";

type AthleteRowProps = {
	athlete: LinkedAccount;
	sessions: PlannedSessionSummary[] | undefined;
	failed: boolean;
};

function AthleteRow({ athlete, sessions, failed }: AthleteRowProps) {
	const { t } = useTranslation();
	const now = today();
	const { next, last } = outlook(sessions ?? [], now);
	let detail: string | null = null;
	let tag: { className: string; label: string } | null = null;
	if (failed) {
		detail = t("athlete.loadFailed");
	} else if (next) {
		const status = plannedStatus(next, now);
		detail = t("athletes.next", {
			day: formatDay(next.plannedOn),
			name: next.name,
		});
		tag = {
			className: STATUS_TAG[status],
			label: t(`athlete.status.${status}`),
		};
	} else if (sessions) {
		detail = last
			? t("athletes.last", {
					day: formatDay(last.plannedOn),
					status: t(`athlete.status.${plannedStatus(last, now)}`),
				})
			: t("athletes.since", { date: formatShortInstant(athlete.linkedAt) });
		tag = { className: "tag tag-orange", label: t("athletes.nothingPlanned") };
	}
	return (
		<Link
			to="/athletes/$athleteId"
			params={{ athleteId: athlete.id }}
			className="list-item"
		>
			<span className="list-icon" aria-hidden="true">
				{athlete.name.charAt(0).toUpperCase()}
			</span>
			<span className="grow">
				<span className="strong">{athlete.name}</span>
				{detail ? (
					<span className="muted small line-block truncate">{detail}</span>
				) : null}
			</span>
			{tag ? <span className={tag.className}>{tag.label}</span> : null}
		</Link>
	);
}

/** A coach's athletes, each with the next session planned for them or a flag that none is. */
export function AthletesPage() {
	const { t } = useTranslation();
	const athletes = useAthletes();
	const items = athletes.data?.items ?? [];
	const sessions = useQueries({
		queries: items.map((athlete) => ({
			queryKey: [...keys.plannedSessions, athlete.id],
			queryFn: () =>
				api.plannedSessions({ athleteId: athlete.id, perPage: 50 }),
		})),
	});

	return (
		<main className="screen narrow">
			<header className="bar">
				<span className="icon-spacer" />
				<h1 className="display page-title center grow">
					{t("athletes.title")}
				</h1>
				<span className="icon-spacer" />
			</header>
			{athletes.isError ? (
				<ErrorText>{t("athletes.loadFailed")}</ErrorText>
			) : null}
			{athletes.isSuccess && items.length === 0 ? (
				<Empty>{t("athletes.empty")}</Empty>
			) : null}
			{items.length > 0 ? (
				<>
					<ul className="card list">
						{items.map((athlete, index) => (
							<li key={athlete.id}>
								<AthleteRow
									athlete={athlete}
									sessions={sessions[index]?.data?.items}
									failed={sessions[index]?.isError ?? false}
								/>
							</li>
						))}
					</ul>
					<p className="muted small">{t("athletes.intro")}</p>
				</>
			) : null}
		</main>
	);
}
