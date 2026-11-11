import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ErrorText } from "@/components/ui";
import { api } from "@/lib/api/endpoints";
import { errorMessage } from "@/lib/api/errors";
import { tokenStore } from "@/lib/auth";
import { LoginPage } from "@/pages/LoginPage";

/**
 * Where a coach's invitation link lands: sign up into the profile, or log in
 * to attach it; an account already logged in attaches it in one tap.
 */
export function InvitePage({ token }: { token: string }) {
	const { t } = useTranslation();
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	// Read once: logging in from this page sets a token before the invitation
	// is accepted, and must not swap the form for the button mid-way.
	const [signedIn] = useState(() => tokenStore.get() !== null);
	const invitation = useQuery({
		queryKey: ["invitation", token],
		queryFn: () => api.invitation(token),
	});
	const accept = useMutation({
		mutationFn: () => api.acceptInvitation(token),
		onSuccess: () => {
			queryClient.clear();
			void navigate({ to: "/" });
		},
	});

	if (invitation.isPending) {
		return <main className="auth muted">{t("common.loading")}</main>;
	}
	if (invitation.isError) {
		return (
			<main className="auth">
				<ErrorText>{t("invite.expired")}</ErrorText>
				<Link to="/login">{t("login.login")}</Link>
			</main>
		);
	}
	if (!signedIn) {
		return <LoginPage invite={{ token, invitation: invitation.data }} />;
	}
	return (
		<main className="auth">
			<p className="invite-hello">
				{t("invite.hello", { coach: invitation.data.coachName })}
			</p>
			{accept.isError ? (
				<ErrorText>
					{errorMessage(accept.error, { fallback: "saveFailed" })}
				</ErrorText>
			) : null}
			<button
				type="button"
				className="btn btn-primary"
				disabled={accept.isPending}
				onClick={() => accept.mutate()}
			>
				{t("invite.accept")}
			</button>
		</main>
	);
}
