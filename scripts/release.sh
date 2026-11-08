#!/usr/bin/env bash
# Cuts a release: bumps the committed version of the API and the webapp, or of
# the Helm chart with --chart, commits, tags, and asks before pushing. CI
# publishes from the tag.
set -euo pipefail

usage() {
	cat <<'USAGE'
Usage: scripts/release.sh [--dry-run] VERSION
       scripts/release.sh [--dry-run] --chart [--app-version APP_VERSION] VERSION

Bumps the Cargo workspace and the webapp to VERSION, commits, creates the
annotated tag vVERSION, then asks before pushing (pushing publishes).

With --chart, releases the Helm chart instead: sets `version` in
charts/repsheet/Chart.yaml to VERSION and `appVersion` to APP_VERSION,
regenerates the chart README, updates the `helm install` command of the root
README (stable releases only), commits, creates the annotated tag
chart-VERSION, then asks before pushing.

When the repository already carries the target versions, the current commit
is tagged as is.

Options:
  --chart                    release the Helm chart rather than the application
  --app-version APP_VERSION  application release the chart deploys (needs
                             --chart); defaults to the latest stable vX.Y.Z tag
  --dry-run                  print what would change, change nothing
  -h, --help                 show this help

Examples:
  scripts/release.sh 0.2.0
  scripts/release.sh 0.2.0-rc1
  scripts/release.sh --dry-run 1.0.0
  scripts/release.sh --chart 0.2.0
  scripts/release.sh --chart --app-version 0.1.0 0.1.1
USAGE
}

die() {
	echo "error: $*" >&2
	exit 1
}

# GNU and BSD sed disagree on `-i`.
sed_in_place() {
	local file="$1"
	shift
	sed "$@" "$file" >"$file.tmp" && mv "$file.tmp" "$file"
}

dry_run=false
chart=false
version=""
app_version=""

while [ $# -gt 0 ]; do
	case "$1" in
	--dry-run) dry_run=true ;;
	--chart) chart=true ;;
	--app-version)
		[ $# -gt 1 ] || die "--app-version needs a value"
		app_version="$2"
		shift
		;;
	-h | --help)
		usage
		exit 0
		;;
	-*) die "unknown option: $1 (see --help)" ;;
	*)
		[ -z "$version" ] || die "only one VERSION is accepted"
		version="$1"
		;;
	esac
	shift
done

semver='^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$'
[ -n "$version" ] || die "VERSION is required (see --help)"
[[ "$version" =~ $semver ]] || die "VERSION must be semver, got '$version'"
[ -z "$app_version" ] || $chart || die "--app-version only applies to --chart"

cd "$(git rev-parse --show-toplevel)"

default_branch="$(git symbolic-ref --short refs/remotes/origin/HEAD 2>/dev/null | sed 's|^origin/||')"
default_branch="${default_branch:-main}"
branch="$(git rev-parse --abbrev-ref HEAD)"

if $chart; then
	tag="chart-$version"
	subject="chart: release $version"
else
	tag="v$version"
	subject="release $version"
fi

[ -z "$(git status --porcelain)" ] || die "working tree is not clean"
[ "$branch" = "$default_branch" ] || die "releases are cut from $default_branch, not $branch"
git fetch --quiet --tags origin "$default_branch"
[ "$(git rev-list --count "HEAD..origin/$default_branch")" -eq 0 ] ||
	die "$branch is behind origin/$default_branch: pull first"
! git rev-parse --quiet --verify "refs/tags/$tag" >/dev/null || die "tag $tag already exists"

chart_yaml=charts/repsheet/Chart.yaml
install_cmd='helm install repsheet oci://ghcr\.io/therealm-tech/charts/repsheet --version '

if $chart; then
	if [ -z "$app_version" ]; then
		app_version="$(git tag --list 'v*' | grep -v -- - | sort -V | tail -n 1 | sed 's/^v//')"
		[ -n "$app_version" ] || die "no stable vX.Y.Z tag to deploy: pass --app-version"
	fi
	[[ "$app_version" =~ $semver ]] || die "APP_VERSION must be semver, got '$app_version'"
	git rev-parse --quiet --verify "refs/tags/v$app_version^{commit}" >/dev/null ||
		die "no release tag v$app_version: --app-version must name a released application"
	command -v helm-docs >/dev/null || die "helm-docs is needed to regenerate the chart README"
	grep -q "^$install_cmd" README.md || die "README.md has no 'helm install' command to update"
	current="$(sed -n 's/^version: *//p' "$chart_yaml")"
	current_app="$(sed -n 's/^appVersion: *"\{0,1\}\([^"]*\)"\{0,1\}$/\1/p' "$chart_yaml")"
else
	current="$(sed -n 's/^version = "\(.*\)"$/\1/p' Cargo.toml | head -n 1)"
fi

if $dry_run; then
	echo "current version: $current"
	echo "target version:  $version"
	if $chart; then
		echo "current appVersion: $current_app"
		echo "target appVersion:  $app_version"
	fi
	echo "commit subject:  $subject"
	echo "tag:             $tag"
	exit 0
fi

if $chart; then
	sed_in_place "$chart_yaml" -e "s/^version:.*/version: $version/" -e "s/^appVersion:.*/appVersion: \"$app_version\"/"
	# Same invocation as the helm-docs pre-commit hook, so the output is identical.
	helm-docs --chart-search-root charts
	files=("$chart_yaml" charts/repsheet/README.md)
	if [[ "$version" != *-* ]]; then
		sed_in_place README.md -e "s|^\($install_cmd\)[^ ]*|\1$version|"
		files+=(README.md)
	fi
else
	cargo set-version --workspace "$version"
	(cd repsheet-webapp && npm version "$version" --no-git-tag-version --allow-same-version >/dev/null)
	files=(Cargo.toml Cargo.lock repsheet-webapp/package.json repsheet-webapp/package-lock.json)
fi
git add "${files[@]}"

if git diff --cached --quiet; then
	echo "the repository already carries $version: tagging the current commit"
else
	git commit --quiet --message "$subject"
fi
git tag --annotate "$tag" --message "$subject"
echo "tagged $tag"

push_cmd="git push --atomic origin $branch $tag"
if [ -t 0 ]; then
	printf 'push %s and %s to origin? this publishes the release. [y/N] ' "$branch" "$tag"
	read -r reply
	case "$reply" in
	y | Y | yes)
		$push_cmd
		exit 0
		;;
	esac
fi
echo "not pushed. publish later with: $push_cmd"
