import { build } from 'esbuild';

await build({
  entryPoints: ['src/index.ts', 'src/db/migrate.ts'],
  outdir: 'dist',
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  sourcemap: true,
  plugins: [
    {
      // Keep npm dependencies external; bundle the TypeScript-source workspace packages.
      name: 'externalize-deps',
      setup(b) {
        b.onResolve({ filter: /^[^./]/ }, (args) =>
          args.path.startsWith('@snyder/') ? undefined : { path: args.path, external: true },
        );
      },
    },
  ],
});
