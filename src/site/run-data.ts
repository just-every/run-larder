import { runPricing } from '../base/run-pricing'
import type { RunData } from '../base/run-site'
import run from './run.json'

/** Seed identity and repository, with the shared chooser's pricing. */
const data: RunData = { ...run, pricing: runPricing }
export default data
