import {
	keepPreviousData,
	useMutation,
	useQuery,
	useQueryClient,
} from "@tanstack/react-query";
import { Link, Navigate } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
	ConfirmButton,
	Empty,
	ErrorText,
	RoleTag,
	Segmented,
} from "@/components/ui";
import { api, keys } from "@/lib/api/endpoints";
import { errorMessage } from "@/lib/api/errors";
import type { Role, User } from "@/lib/api/schemas";
import { formatShortInstant } from "@/lib/dates";
import { useDebounced, useMe } from "@/lib/hooks";

const PER_PAGE = 20;

function AccountRow({ account, isSelf }: { account: User; isSelf: boolean }) {
	const { t } = useTranslation();
	const queryClient = useQueryClient();
	const refresh = () =>
		void queryClient.invalidateQueries({ queryKey: keys.users });
	const changeRole = useMutation({
		mutationFn: (role: Role) => api.updateUserRole(account.id, role),
		onSuccess: refresh,
	});
	const remove = useMutation({
		mutationFn: () => api.deleteUser(account.id),
		onSuccess: refresh,
	});
	const error = changeRole.isError
		? errorMessage(changeRole.error, {
				fallback: "roleChangeFailed",
			})
		: remove.isError
			? errorMessage(remove.error, {
					fallback: "deleteFailed",
				})
			: null;

	return (
		<li className="account" aria-label={account.email}>
			<div className="row">
				<span className="grow">
					<span className="strong">{account.name}</span>
					{isSelf ? (
						<span className="muted small"> {t("accounts.you")}</span>
					) : null}
					<span className="muted small line-block truncate">
						{account.email}
					</span>
					<span className="muted small line-block">
						{t("accounts.joined", {
							date: formatShortInstant(account.createdAt),
						})}
					</span>
				</span>
				<RoleTag value={account.role} />
			</div>
			{isSelf ? null : (
				<div className="stack-tight">
					<Segmented
						label={t("accounts.roleOf", { name: account.name })}
						value={account.role}
						onChange={(role) => changeRole.mutate(role)}
						options={[
							{ value: "user", label: t("roles.user") },
							{ value: "superAdmin", label: t("roles.superAdmin") },
						]}
					/>
					<ConfirmButton
						label={t("accounts.delete")}
						confirmLabel={t("accounts.deleteNamed", { name: account.name })}
						message={t("accounts.deleteMessage")}
						onConfirm={() => remove.mutate()}
						disabled={remove.isPending}
					/>
				</div>
			)}
			{error ? <ErrorText>{error}</ErrorText> : null}
		</li>
	);
}

export function AccountsPage() {
	const { t } = useTranslation();
	const me = useMe();
	const [query, setQuery] = useState("");
	const [page, setPage] = useState(1);
	const q = useDebounced(query.trim(), 250);
	const isAdmin = me.data?.role === "superAdmin";
	const users = useQuery({
		queryKey: [...keys.users, q, page],
		queryFn: () => api.users({ q, page, perPage: PER_PAGE }),
		enabled: isAdmin,
		placeholderData: keepPreviousData,
	});

	if (me.isPending) {
		return <main className="screen muted">{t("common.loading")}</main>;
	}
	const current = me.data;
	if (!current || !isAdmin) {
		return <Navigate to="/" />;
	}

	const total = users.data?.total ?? 0;
	const pages = Math.max(1, Math.ceil(total / PER_PAGE));
	const items = users.data?.items ?? [];

	return (
		<main className="screen narrow">
			<header className="bar">
				<Link to="/" className="icon-button" aria-label={t("common.backHome")}>
					‹
				</Link>
				<h1 className="display page-title center grow">
					{t("account.accounts")}
				</h1>
				<span className="icon-spacer" />
			</header>
			<input
				className="input"
				type="search"
				placeholder={t("accounts.searchPlaceholder")}
				aria-label={t("accounts.search")}
				value={query}
				onChange={(e) => {
					setQuery(e.target.value);
					setPage(1);
				}}
			/>
			<p className="muted small">{t("accounts.count", { count: total })}</p>
			{users.isError ? <ErrorText>{t("accounts.loadFailed")}</ErrorText> : null}
			{users.isSuccess && items.length === 0 ? (
				<Empty>{t("accounts.empty")}</Empty>
			) : null}
			{items.length > 0 ? (
				<ul className="card list">
					{items.map((account) => (
						<AccountRow
							key={account.id}
							account={account}
							isSelf={account.id === current.id}
						/>
					))}
				</ul>
			) : null}
			{pages > 1 ? (
				<div className="row">
					<button
						type="button"
						className="btn btn-small"
						disabled={page <= 1}
						onClick={() => setPage(page - 1)}
					>
						{t("common.previous")}
					</button>
					<span className="grow center muted small">
						{t("common.page", { page, pages })}
					</span>
					<button
						type="button"
						className="btn btn-small"
						disabled={page >= pages}
						onClick={() => setPage(page + 1)}
					>
						{t("common.next")}
					</button>
				</div>
			) : null}
		</main>
	);
}
