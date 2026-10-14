export class Problem extends Error {
  constructor(public code: string, message: string, public details: unknown = null, public status = 409) { super(message) }
}
export const fail = (code: string, message: string, details: unknown = null): never => { throw new Problem(code, message, details) }
export const forbidden = (message = 'Your current role cannot perform this action.'): never => { throw new Problem('FORBIDDEN', message, null, 403) }
