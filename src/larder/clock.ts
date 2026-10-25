// The command timestamp is captured once per atomic attempt.
export const commandTime = () => new Date().toISOString()
