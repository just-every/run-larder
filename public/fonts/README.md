# Fonts

| Family | Used for | Files | Licence | Upstream |
| --- | --- | --- | --- | --- |
| Inter | every heading, the wordmark, interface and body text (optical size 14–32 and weight 100–900 axes; headings use the display optical size at 800–900) | `inter/` (Latin and Latin Extended) | SIL Open Font License 1.1, `inter/LICENSE.txt` | https://github.com/rsms/inter |
| JetBrains Mono | commands, code cards and the terminal | `jetbrains-mono/` (Latin; weights 100–800) | SIL Open Font License 1.1, `jetbrains-mono/LICENSE.txt` | https://github.com/JetBrains/JetBrainsMono |

The WOFF2 subsets come from Fontsource's variable distributions (`@fontsource-variable/inter` 5.2.8, the
`opsz` files that carry both axes; `@fontsource-variable/jetbrains-mono` 5.3.0).

`public/rer-theme.css` declares both families once, so the installer serves them too. `fonts.css` carries the
rest of Larder's look that Base's theme grammar keeps out of the theme: the form controls' font, Larder's own
tokens and the run site's palette, and the rules for Base's sign-in, `/setup`, Lobby and Run pages. The app's
root document and `/setup` link it before the theme and preload the Inter Latin file (`src/base/font-head.ts`);
the Lobby, Base's Run pages and the run site link it before the theme too, and the sign-in pages add it after
their own style. Do not import this CSS from a component.
