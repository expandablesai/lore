#!/bin/bash
# Generate an Authelia users database containing a literal password digest.
#
# Authelia does NOT expand environment variables inside users_database.yml, so the
# digest has to be written into the file itself. This file is git-ignored; generate
# it on the host that runs the container.
#
# Usage: ./gen-users.sh <username> <password> [outfile]
set -euo pipefail

USER_NAME=${1:?usage: gen-users.sh <username> <password> [outfile]}
PASSWORD=${2:?usage: gen-users.sh <username> <password> [outfile]}
OUT=${3:-users_database.yml}

DIGEST=$(docker run --rm authelia/authelia:4 authelia crypto hash generate pbkdf2 \
  --password "$PASSWORD" --variant sha256 --iterations 100000 | sed -n 's/^Digest: //p')

if [ -z "$DIGEST" ]; then
  echo "failed to generate a pbkdf2 digest" >&2
  exit 1
fi

{
  printf 'users:\n'
  printf '  %s:\n' "$USER_NAME"
  printf '    disabled: false\n'
  printf '    displayname: "%s"\n' "$USER_NAME"
  printf '    password: "%s"\n' "$DIGEST"
  printf '    email: %s@dushyant.com\n' "$USER_NAME"
  printf '    groups:\n'
  printf '      - admins\n'
  printf '      - lore\n'
} > "$OUT"

chmod 0600 "$OUT"
echo "wrote $OUT"
