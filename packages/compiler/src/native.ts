import { transformSync } from '@babel/core';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import { typecheckEntry } from './typecheck.ts';
import { programFactory } from './factories.ts';
import { sourceAdmission } from './compile.ts';
const require = createRequire(import.meta.url),
  types = require('@babel/types');
/** Native build keeps original async/await and performs no continuation conversion. */
export async function compileNativeEntry(entry: string, exportName = 'program') {
  await typecheckEntry(entry);
  const bundle = await build({
    entryPoints: [entry],
    bundle: true,
    write: false,
    format: 'cjs',
    platform: 'neutral',
    target: 'es2020',
    packages: 'bundle',
    sourcemap: 'external',
    outfile: 'program.js',
    logLevel: 'silent',
    plugins: [sourceAdmission]
  });
  const code = bundle.outputFiles!.find(f => f.path.endsWith('.js'))!.text;
  const charge = () => types.expressionStatement(types.callExpression(types.identifier('__tick'), []));
  const converted = transformSync(code, {
    configFile: false,
    babelrc: false,
    compact: false,
    plugins: [() => ({
      visitor: {
        Loop(path: any) {
          const body = path.get('body');
          if (body.isBlockStatement()) body.unshiftContainer('body', charge());else body.replaceWith(types.blockStatement([charge(), body.node]));
        },
        Function(path: any) {
          if (path.node.body.type === 'BlockStatement') path.node.body.body.unshift(charge());else path.node.body = types.blockStatement([charge(), types.returnStatement(path.node.body)]);
        }
      }
    })]
  })!.code!;
  return {
    format: 1 as const,
    abi: 'native-main-2',
    code: programFactory(converted, false),
    exportName,
    sourceMap: JSON.parse(bundle.outputFiles!.find(f => f.path.endsWith('.map'))!.text)
  };
}
