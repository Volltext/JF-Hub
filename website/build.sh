#!/bin/sh
# Stellt die Website in einem Ordner zusammen (Standard: _site), so wie GitHub Pages sie ausliefert.
#   DEMO_URL  Adresse der öffentlichen Demo (optional; ohne sie zeigt die Seite Ersatz-Links)
#   SITE_URL  Adresse der Website selbst, für Vorschaubilder beim Teilen (optional)
# Lokal ansehen:  website/build.sh && python3 -m http.server -d _site 8000
set -eu
cd "$(dirname "$0")/.."
out="${1:-_site}"
demo="${DEMO_URL:-}"
site="${SITE_URL:-}"
if [ -n "$demo" ] && ! printf '%s' "$demo" | grep -Eq '^https?://[A-Za-z0-9.-]+(:[0-9]+)?(/[A-Za-z0-9._~/-]*)?$'; then
  echo "DEMO_URL muss eine Adresse wie https://demo.example.org sein, nicht: $demo" >&2
  exit 1
fi
if [ -n "$site" ] && ! printf '%s' "$site" | grep -Eq '^https?://[A-Za-z0-9.-]+(:[0-9]+)?(/[A-Za-z0-9._~/-]*)?$'; then
  echo "SITE_URL ungültig: $site" >&2
  exit 1
fi
site="${site%/}"
rm -rf "$out"
mkdir -p "$out/images"
cp website/index.html website/style.css website/site.js "$out/"
cp app/public/favicon.svg "$out/"
cp docs/images/hero.png docs/images/logo.png docs/images/app-*.png "$out/images/"
sed -i.bak -e "s#__DEMO_URL__#${demo}#g" -e "s#__SITE_URL__#${site}#g" "$out/index.html"
rm -f "$out/index.html.bak"
echo "Website in $out/ ($(ls "$out/images" | wc -l | tr -d ' ') Bilder, Demo: ${demo:-keine})"
