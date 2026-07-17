#!/usr/bin/env bash
set -euo pipefail
VERSION="${1:-1.7.0}"

if [ -d "desktop-app" ] && [ -f "desktop-app/build.gradle" ]; then
  TASK_PREFIX=":desktop-app:"
  MODULE_ROOT="desktop-app"
else
  TASK_PREFIX=""
  MODULE_ROOT="."
fi

./gradlew "${TASK_PREFIX}clean" "${TASK_PREFIX}packageDeb" --stacktrace
mkdir -p "${MODULE_ROOT}/build/release-installers"
DEB=$(find "${MODULE_ROOT}/build/compose/binaries/main" -name '*.deb' -type f | sort | tail -n 1)
cp "$DEB" "${MODULE_ROOT}/build/release-installers/DHC6TrainerDesktop-${VERSION}.deb"
sha256sum "${MODULE_ROOT}"/build/release-installers/* > "${MODULE_ROOT}/build/release-installers/SHA256SUMS.txt"
