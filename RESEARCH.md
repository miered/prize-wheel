# Wheel Spinner Market Research (Oct 2026)

## Sites evaluated

| Site | Ads / paywall | Standout features | Pain points |
|---|---|---|---|
| **wheelofnames.com** | Ads (closable per session). No paywall. | Weights, images, center logo, background image, 150+ sounds, Unsplash images, Google Sheets import, multi-wheel, cloud save + short links, OBS/Streamlabs source, 10,000-spin randomness audit, 65 languages | Ads; feature-dense UI; cloud features push toward an account |
| **seatingchartmaker.app/wheel-of-names** | No ads, no sign-up | Whole wheel stored in the URL (share = copy link), inline per-slice syntax `[color:gold, size:2x]`, slice size = odds, presets, Quick/Normal/Long spin, light/dark/system, 6 themes plus a custom theme, full screen, embed code, offline, edits apply live | Share link capped at about 2,000 characters; no spin history |
| **spinwheelify.com** | Not stated | Presets (Yes/No, coin, dice, truth-or-dare), CSV import, shuffle/sort, image entries, remove winners, multi-wheel "Spin All", mobile apps | Thin on settings detail; spin time and sounds aren't documented |
| **pickerwheel.com** | Ads on free tier. Premium is $5.50/mo | Normal, Elimination and Accumulation modes; weights; labels; mystery wheel; spin speed and 1–30 s duration; manual stop; results list and score summary; confetti; read-aloud; AI entry ideas | Heavy paywall (HD images, custom colors, logo, ad-free); busy UI |
| **spinthelist.com** | Not stated | Cryptographic RNG with a public audit; `Alice:3` weight syntax; dedupe/trim; JSON import/export; spin history with timestamps and CSV export; QR code; present mode; Spin All ranked order; Twitch/Discord entry collection; brackets; keyboard shortcuts | Lots of sections (brackets, pickers, templates) |
| **wheeldecide.com** | Not stated | Comma weight list, color themes, hex colors, wheel diameter, spin duration, remove-after-landing, iframe embed | Dated UI; 100-entry cap; saving requires login |
| **uplup.com** | No ads (per review) | Spin duration 1–15 s, confetti and cheering, full screen, winner tracking, CSV upload, handles big lists | Saving needs an account |
| **ClassTools.net** | Ads; premium £9.99+/6 mo | Colors and themes; part of a classroom suite | Ads, dated UI |

Sources: wheelofnames.com, seatingchartmaker.app, spinwheelify.com, pickerwheel.com, spinthelist.com, wheeldecide.com, uplup.com/blog/best-random-name-picker-tools.

## What users actually need for a prize giveaway

1. Paste a list and spin. No account, no ads, no popups.
2. **Fair, verifiable randomness.** A cryptographic RNG, with the winner chosen before the animation runs.
3. **Remove the winner** (ask or automatic) so nobody wins twice.
4. **Results log** with timestamps that can be exported, as proof of the draw.
5. **Weights** for extra entries (for example, someone who shared the post gets ×3).
6. Branding: a title, a color theme, and a center logo.
7. Presentation: full-screen/present mode, satisfying ticks, a fanfare and confetti.
8. Sharing without a server: wheel state in the URL, plus autosave in the browser.

## What we deliberately leave out (to stay simple)

- Accounts, cloud storage, AI generators, brackets, multiple wheels, and social integrations. These add UI weight and mostly serve the ad or paywall model.

## Feature set for our wheel

| Feature | Inspired by |
|---|---|
| One-per-line entries with a live-redrawing wheel; emoji supported | seatingchartmaker, wheelofnames |
| `Name *3` weight syntax; slice size matches the odds | spinthelist, seatingchartmaker |
| Shuffle, sort, dedupe, clear, with an undo button | spinthelist |
| Import from .txt/.csv; JSON backup and restore | spinwheelify, spinthelist |
| Presets (Yes/No, coin, dice, 1–10, A–Z, prize sample) | seatingchartmaker, spinwheelify |
| `crypto.getRandomValues`; winner picked first, then animated to land on it | spinthelist |
| Spin duration slider | pickerwheel, wheeldecide |
| Remove winner: ask / auto / never | everyone |
| Results history with timestamps; CSV export; copy | spinthelist, pickerwheel |
| Tick sound plus fanfare (generated, no audio files), mute | wheelofnames |
| Confetti toggle | pickerwheel, uplup |
| Palettes plus custom hex colors; light/dark/auto | seatingchartmaker, wheeldecide |
| Center logo upload | wheelofnames |
| Mystery mode (hide names until the wheel stops) | pickerwheel, spinthelist |
| Present / full-screen mode | seatingchartmaker, spinthelist |
| Share link (state in the URL); autosave to the browser | seatingchartmaker |
| Keyboard: Space to spin, F for full screen, Esc to close | spinthelist |
| Single file, zero dependencies, works offline, no tracking | — |
