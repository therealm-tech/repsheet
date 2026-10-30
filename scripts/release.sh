#!/usr/bin/env bash
# Cuts a release: bumps the committed version of the API and the webapp,
# commits, tags, and asks before pushing. CI publishes from the tag.
set -euo pipefail

usage() {
	cat <<'USAGE'
Usage: scripts/release.sh [--dry-run] VERSION

Bumps the Cargo workspace and the webapp to VERSION, commits, creates the
annotated tag vVERSION, then asks before pushing (pushing publishes).

Options:
  --dry-run   print what would change, change nothing
  -h, --help  show this help

Examples:
  scripts/release.sh 0.2.0
  scripts/release.sh 0.2.0-rc1
  scripts/release.sh --dry-run 1.0.0
USAGE
}

die() {
	echo "error: $*" >&2
	exit 1
}

dry_run=false
version=""

while [ $# -gt 0 ]; do
	case "$1" in
	--dry-run) dry_run=true ;;
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

cd "$(git rev-parse --show-toplevel)"

default_branch="$(git symbolic-ref --short refs/remotes/origin/HEAD 2>/dev/null | sed 's|^origin/||')"
default_branch="${default_branch:-main}"
branch="$(git rev-parse --abbrev-ref HEAD)"
tag="v$version"
subject="release $version"

[ -z "$(git status --porcelain)" ] || die "working tree is not clean"
[ "$branch" = "$default_branch" ] || die "releases are cut from $default_branch, not $branch"
git fetch --quiet --tags origin "$default_branch"
[ "$(git rev-list --count "HEAD..origin/$default_branch")" -eq 0 ] ||
	die "$branch is behind origin/$default_branch: pull first"
! git rev-parse --quiet --verify "refs/tags/$tag" >/dev/null || die "tag $tag already exists"

current="$(sed -n 's/^version = "\(.*\)"$/\1/p' Cargo.toml | head -n 1)"

if $dry_run; then
	echo "current version: $current"
	echo "target version:  $version"
	echo "commit subject:  $subject"
	echo "tag:             $tag"
	exit 0
fi

cargo set-version --workspace "$version"
(cd repsheet-webapp && npm version "$version" --no-git-tag-version >/dev/null)
git add Cargo.toml Cargo.lock repsheet-webapp/package.json repsheet-webapp/package-lock.json

git commit --quiet --message "$subject"
git tag --annotate "$tag" --message "$subject"
echo "committed and tagged $tag"

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
