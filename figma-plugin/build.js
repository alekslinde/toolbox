// figma-plugin/build.js
const esbuild = await import('esbuild');
const path = await import('path');

const root = process.cwd();

await esbuild.build({
  entryPoints: [path.join(root, 'figma-plugin/src/code.ts')],
  bundle: true,
  outfile: path.join(root, 'figma-plugin/dist/code.js'),
  platform: 'browser',
  target: 'es2017',
  tsconfig: path.join(root, 'figma-plugin/tsconfig.json'),
});

await esbuild.build({
  entryPoints: [path.join(root, 'figma-plugin/src/ui.ts')],
  bundle: true,
  outfile: path.join(root, 'figma-plugin/dist/ui.js'),
  platform: 'browser',
  target: 'es2017',
  tsconfig: path.join(root, 'figma-plugin/tsconfig.json'),
});

console.log('Figma plugin built → figma-plugin/dist/');
