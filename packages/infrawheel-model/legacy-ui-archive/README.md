# Original UI preservation

Original files from NULMARU/infrawheel-lite commit 09c710e are preserved verbatim with `.txt` suffixes so that its Zustand global store and URL hash routing cannot enter the Stock build. These include the 32 original store, URL migration and Lite UI tests. The original 122 engine tests execute in `src/legacy`; the 32 UI tests were run against the upstream checkout during initial review (154 total upstream tests).

To rerun all original tests independently, clone https://github.com/NULMARU/infrawheel-lite.git, checkout 09c710e, run `npm ci && npm test`. Do not point that UI's hash store at Stock's HashRouter. Current Stock UI behavior is separately verified in `docs/release-verification.md`.
