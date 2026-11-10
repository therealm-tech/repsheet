import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { type FormEvent, useState } from "react";
import { useTranslation } from "react-i18next";
import { ConfirmButton, Empty, ErrorText } from "@/components/ui";
import { api, keys } from "@/lib/api/endpoints";
import { errorMessage } from "@/lib/api/errors";
import type { LinkedAccount } from "@/lib/api/schemas";
import { formatShortInstant } from "@/lib/dates";

function AccountLine({ account }: { account: LinkedAccount }) {
	const { t } = useTranslation();
	return (
		<>
			<span className="list-icon" aria-hidden="true">
				{account.name.charAt(0).toUpperCase()}
			</span>
			<span className="grow">
				<span className="strong">{account.name}</span>
				<span className="muted small line-block truncate">
					{account.email} ·{" "}
					{t("coaching.since", { date: formatShortInstant(account.linkedAt) })}
				</span>
			</span>
		</>
	);
}

function Athletes() {
	const { t } = useTranslation();
	const athletes = useQuery({
		queryKey: [...keys.athletes, 1],
		queryFn: () => api.athletes({ perPage: 100 }),
	});
	const items = athletes.data?.items ?? [];
	return (
		<section className="stack-tight" aria-labelledby="athletes-title">
			<h2 id="athletes-title" className="display section-title">
				{t("coaching.athletesTitle")}
			</h2>
			{athletes.isError ? (
				<ErrorText>{t("coaching.loadFailed")}</ErrorText>
			) : null}
			{athletes.isSuccess && items.length === 0 ? (
				<Empty>{t("coaching.athletesEmpty")}</Empty>
			) : null}
			{items.length > 0 ? (
				<>
					<p className="muted small">{t("coaching.athletesIntro")}</p>
					<ul className="card list">
						{items.map((athlete) => (
							<li key={athlete.id}>
								<Link
									to="/coaching/athletes/$athleteId"
									params={{ athleteId: athlete.id }}
									className="list-item"
								>
									<AccountLine account={athlete} />
									<span className="muted" aria-hidden="true">
										›
									</span>
								</Link>
							</li>
						))}
					</ul>
				</>
			) : null}
		</section>
	);
}

function Coaches() {
	const { t } = useTranslation();
	const queryClient = useQueryClient();
	const [email, setEmail] = useState("");
	const coaches = useQuery({
		queryKey: [...keys.coaches, 1],
		queryFn: () => api.coaches({ perPage: 100 }),
	});
	const add = useMutation({
		mutationFn: api.addCoach,
		onSuccess: () => {
			setEmail("");
			void queryClient.invalidateQueries({ queryKey: keys.coaches });
		},
	});
	const remove = useMutation({
		mutationFn: api.removeCoach,
		onSuccess: () => {
			void queryClient.invalidateQueries({ queryKey: keys.coaches });
			void queryClient.invalidateQueries({ queryKey: ["workoutShares"] });
		},
	});
	const items = coaches.data?.items ?? [];

	function submit(event: FormEvent) {
		event.preventDefault();
		if (email.trim()) {
			add.mutate(email.trim());
		}
	}

	return (
		<section className="stack-tight" aria-labelledby="coaches-title">
			<h2 id="coaches-title" className="display section-title">
				{t("coaching.coachesTitle")}
			</h2>
			<p className="muted small">{t("coaching.coachesIntro")}</p>
			{coaches.isError ? (
				<ErrorText>{t("coaching.loadFailed")}</ErrorText>
			) : null}
			{coaches.isSuccess && items.length === 0 ? (
				<Empty>{t("coaching.coachesEmpty")}</Empty>
			) : null}
			{items.length > 0 ? (
				<ul className="card list">
					{items.map((coach) => (
						<li key={coach.id} aria-label={coach.name}>
							<div className="list-item">
								<AccountLine account={coach} />
							</div>
							<ConfirmButton
								label={t("coaching.remove")}
								confirmLabel={t("coaching.removeNamed", { name: coach.name })}
								message={t("coaching.removeMessage", { name: coach.name })}
								onConfirm={() => remove.mutate(coach.id)}
								disabled={remove.isPending}
							/>
						</li>
					))}
				</ul>
			) : null}
			{remove.isError ? (
				<ErrorText>
					{errorMessage(remove.error, { fallback: "deleteFailed" })}
				</ErrorText>
			) : null}
			<form className="stack-tight" onSubmit={submit}>
				<label className="label" htmlFor="coach-email">
					{t("coaching.coachEmail")}
				</label>
				<input
					id="coach-email"
					className="input"
					type="email"
					autoComplete="off"
					placeholder="name@example.com"
					value={email}
					onChange={(e) => {
						add.reset();
						setEmail(e.target.value);
					}}
				/>
				{add.isError ? (
					<ErrorText>
						{errorMessage(add.error, { fallback: "saveFailed" })}
					</ErrorText>
				) : null}
				<button
					type="submit"
					className="btn btn-primary"
					disabled={add.isPending || !email.trim()}
				>
					{t("coaching.addCoach")}
				</button>
			</form>
		</section>
	);
}

export function CoachingPage() {
	const { t } = useTranslation();
	const athletes = useQuery({
		queryKey: [...keys.athletes, 1],
		queryFn: () => api.athletes({ perPage: 100 }),
	});
	const coachFirst = (athletes.data?.items.length ?? 0) > 0;
	return (
		<main className="screen narrow">
			<header className="bar">
				<Link to="/" className="icon-button" aria-label={t("common.backHome")}>
					‹
				</Link>
				<h1 className="display page-title center grow">
					{t("coaching.title")}
				</h1>
				<span className="icon-spacer" />
			</header>
			{coachFirst ? (
				<>
					<Athletes />
					<Coaches />
				</>
			) : (
				<>
					<Coaches />
					<Athletes />
				</>
			)}
		</main>
	);
}
