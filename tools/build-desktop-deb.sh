#!/usr/bin/env bash
set -euo pipefail
VERSION="${1:-1.6.9}"
./gradlew :desktop-app:clean :desktop-app:packageDeb --stacktrace
mkdir -p desktop-app/build/release-installers
DEB=$(find desktop-app/build/compose/binaries/main -name '*.deb' -type f | sort | tail -n 1)
cp "$DEB" "desktop-app/build/release-installers/DHC6TrainerDesktop-${VERSION}.deb"
sha256sum desktop-app/build/release-installers/* > desktop-app/build/release-installers/SHA256SUMS.txt
