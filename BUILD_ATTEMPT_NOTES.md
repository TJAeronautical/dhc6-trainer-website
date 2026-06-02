# Build attempt notes

I attempted to build the desktop installers in the sandbox with:

```bash
./gradlew :desktop-app:packageDistributionForCurrentOS --no-daemon --stacktrace
```

The build could not continue because the Gradle wrapper tried to download Gradle 8.14.4 from `services.gradle.org`, and this sandbox has no external network access.

Also, installer formats are platform-specific:

- Windows EXE/MSI should be built on Windows.
- macOS DMG should be built on macOS.
- Linux DEB should be built on Linux.

This patch therefore adds the website download page, expected download links, release manifest location, and build/staging scripts. Run the scripts on your Windows project machine to produce the real installers and copy them into the website.
