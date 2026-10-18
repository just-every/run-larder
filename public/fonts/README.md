# Fonts

| Family | Used for | Files | Licence | Upstream |
| --- | --- | --- | --- | --- |
| Inter | every heading, the wordmark, interface and body text (optical size 14–32 and weight 100–900 axes; headings use the display optical size at 800–900) | `inter/` (Latin and Latin Extended) | SIL Open Font License 1.1, `inter/LICENSE.txt` | https://github.com/rsms/inter |
| JetBrains Mono | commands, code cards and the terminal | `jetbrains-mono/` (Latin; weights 100–800) | SIL Open Font License 1.1, `jetbrains-mono/LICENSE.txt` | https://github.com/JetBrains/JetBrainsMono |

The WOFF2 subsets come from Fontsource's variable distributions (`@fontsource-variable/inter` 5.2.8, the
`opsz` files that carry both axes; `@fontsource-variable/jetbrains-mono` 5.3.0).

`fonts.css` declares both families once. The app's root document and `/setup` link it and preload the Inter
Latin file (`src/base/font-head.ts`); `public/rer-theme.css` imports it, so the sign-in page, the Lobby, the
run site and Base's Run page get the same faces. Do not import this CSS from a component.
