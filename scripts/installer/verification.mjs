// GitHub's workflow runs the complete wall in independent jobs. The ordinary
// installed command keeps all tests; a partition cannot silently skip locally.
export function verificationTarget(env = process.env) {
  if (env.LARDER_VERIFY_PART === undefined) return ['pnpm', ['run', 'verify:app']]
  if (env.LARDER_VERIFY_PART !== 'foundation' || env.GITHUB_ACTIONS !== 'true' || env.CI !== 'true') {
    throw new Error('A verification partition is valid only in the declared GitHub Verify workflow. Run ordinary rer verify locally.')
  }
  return ['pnpm', ['run', 'verify:foundation']]
}
