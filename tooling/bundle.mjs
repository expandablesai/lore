// Bundles server entries for container images.
// Node's type stripping does not apply under node_modules, so workspace
// packages (@lore/*) resolve to JIT .ts sources through pnpm symlinks and
// cannot be imported by plain `node dist/index.js` inside an image.
// esbuild compiles workspace deps in; npm deps stay external (installed in image).
import { build } from 'esbuild';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const alias = Object.fromEntries(
  ['db', 'core', 'mcp', 'proxy', 'ui'].map((name) => [
    `@lore/${name}`,
    path.join(root, 'packages', name, 'src', 'index.ts'),
  ]),
);

const shared = {
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node24',
  packages: 'external',
  alias,
  sourcemap: true,
};

for (const app of ['api', 'worker']) {
  await build({
    ...shared,
    entryPoints: [path.join(root, 'apps', app, 'src', 'index.ts')],
    outfile: path.join(root, 'apps', app, 'dist', 'index.js'),
  });
  console.log(`bundled apps/${app} -> dist/index.js`);
}
