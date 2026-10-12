#!/bin/sh
set -eu

fail() {
  printf '%s\n' "textify-nginx-entrypoint: $1" >&2
  exit 1
}

is_dns_host() {
  printf '%s\n' "$1" | grep -Eq '^[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*$'
}

validate_port() {
  case "$1" in
    '' | *[!0-9]*)
      fail 'TEXTIFY_API_UPSTREAM has an invalid port.'
      ;;
  esac

  if [ "${#1}" -gt 5 ] || [ "$1" -eq 0 ] || [ "$1" -gt 65535 ]; then
    fail 'TEXTIFY_API_UPSTREAM has an invalid port.'
  fi
}

api_upstream=${TEXTIFY_API_UPSTREAM-}

if [ -z "$api_upstream" ]; then
  fail 'TEXTIFY_API_UPSTREAM must be set to an absolute HTTP(S) origin.'
fi

if ! printf '%s\n' "$api_upstream" | grep -Eq '^https?://([A-Za-z0-9.-]+|\[[0-9A-Fa-f:]+\])(:[0-9]+)?/?$'; then
  fail 'TEXTIFY_API_UPSTREAM must be a credential-free HTTP(S) origin with a host and optional port only.'
fi

case "$api_upstream" in
  */)
    api_upstream=${api_upstream%/}
    ;;
esac

authority=${api_upstream#*://}
case "$authority" in
  \[*\]:*)
    sni_host=${authority#\[}
    sni_host=${sni_host%%\]:*}
    port=${authority##*\]:}
    validate_port "$port"
    if ! printf '%s\n' "$sni_host" | grep -Eq '^[0-9A-Fa-f:]+$'; then
      fail 'TEXTIFY_API_UPSTREAM has an invalid host.'
    fi
    ;;
  \[*\])
    sni_host=${authority#\[}
    sni_host=${sni_host%\]}
    if ! printf '%s\n' "$sni_host" | grep -Eq '^[0-9A-Fa-f:]+$'; then
      fail 'TEXTIFY_API_UPSTREAM has an invalid host.'
    fi
    ;;
  *:*)
    sni_host=${authority%:*}
    port=${authority##*:}
    validate_port "$port"
    if ! is_dns_host "$sni_host"; then
      fail 'TEXTIFY_API_UPSTREAM has an invalid host.'
    fi
    ;;
  *)
    sni_host=$authority
    if ! is_dns_host "$sni_host"; then
      fail 'TEXTIFY_API_UPSTREAM has an invalid host.'
    fi
    ;;
esac

template=/etc/nginx/templates/textify.conf.template
target=/etc/nginx/conf.d/textify.conf
temporary=$(mktemp "${target}.XXXXXX")

trap 'rm -f "$temporary"' EXIT HUP INT TERM
sed \
  -e "s|@TEXTIFY_API_UPSTREAM@|${api_upstream}|g" \
  -e "s|@TEXTIFY_API_SNI_HOST@|${sni_host}|g" \
  "$template" > "$temporary"
mv "$temporary" "$target"
trap - EXIT HUP INT TERM

if ! nginx -t -q; then
  fail 'Rendered Nginx configuration is invalid.'
fi

exec "$@"
