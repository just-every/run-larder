import run from '../run.json'

/** Where the run site's links go: the Run page, the hosted demo, the on-site docs and the public source. */
export const links = {
  home: '/',
  run: '/run',
  demo: 'https://demo.run-larder.com/',
  docs: '/docs',
  contract: '/contract',
  source: run.repository,
  licence: `${run.repository}/blob/main/LICENSE`,
}
