import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {deploymentSpec} from './delivery/base/spec.mjs';
const root = process.cwd();
const config = JSON.parse(await readFile(new URL('../packaging.json', import.meta.url), 'utf8'));
const expected = JSON.stringify(await deploymentSpec(root, config.artifact.specInputs), null, 2) + '\n';
const file = new URL('../management/integration/deployment-spec.json', import.meta.url);
if (process.argv.includes('--check')) {
  if (await readFile(file, 'utf8') !== expected) throw Error('Deployment specification is stale. Run pnpm delivery:spec after the real build.');
  console.log('Deployment specification matches the real build and source policy.');
} else {
  await mkdir(new URL('../management/integration/', import.meta.url), {recursive: true});
  await writeFile(file, expected);
  console.log('Wrote management/integration/deployment-spec.json');
}
