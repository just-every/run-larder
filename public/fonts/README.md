# Fonts

Bricolage Grotesque (headings, interface and body) and Source Serif 4 (the
data lines on printed cards) are self-hosted under the SIL Open Font License
1.1, in `bricolage/LICENSE.txt` and `source-serif/LICENSE.txt`. The Latin and
Latin Extended WOFF2 subsets come from Fontsource's variable distributions
(`@fontsource-variable/bricolage-grotesque` 5.3.0, optical size and weight;
`@fontsource-variable/source-serif-4` 5.3.1, weight). Upstream:
https://github.com/ateliertriay/bricolage and https://github.com/adobe-fonts/source-serif.

`fonts.css` declares both families once. The app's root document and `/setup`
link it and preload the primary Bricolage Latin file (`src/base/font-head.ts`);
`public/rer-theme.css` imports it, so the sign-in page, the Lobby and the run
site get the same faces. Do not import this CSS from a component. Body stacks
use `--font-body`; printed card data uses `--font-print`.
