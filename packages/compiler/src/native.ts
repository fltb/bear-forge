import { transformSync, transformFromAstSync } from '@babel/core';
import { createRequire } from 'node:module';
import { typecheckEntry } from './typecheck.ts';
import { programFactory } from './factories.ts';
import { generatedGlobals } from './generated-globals.ts';
import { bundleProgram } from './bundle.ts';
import { lowerSyntax, nameBindings } from './lowering.ts';
import { lowerAccessors } from './accessors.ts';
import { guardedOperations, runtimeHelpers } from './operations.ts';
import { captureLinkedSourceRanges, nativeArrowKinds, registerNativeSources } from './source-metadata.ts';
const require = createRequire(import.meta.url),
  types = require('@babel/types');
/** Native build keeps original async/await and performs no continuation conversion. */
export async function compileNativeEntry(entry: string, exportName = 'program') {
  await typecheckEntry(entry);
  const bundle = await bundleProgram(entry);
  const source = bundle.code;
  const named = transformSync(source, { configFile: false, babelrc: false, ast: true,
    sourceType: 'module', parserOpts: { tokens: true, allowAwaitOutsideFunction: bundle.hasTopLevelAwait }, plugins: [()=>captureLinkedSourceRanges(bundle.origins), nameBindings] })!;
  const lowered = lowerSyntax(source, undefined, named.ast);
  const options = { configFile: false as const, babelrc: false as const, ast: true, cloneInputAst: false };
  const kinds = transformFromAstSync(lowered.ast!, source, { ...options, plugins: [nativeArrowKinds] })!;
  const accessors = transformFromAstSync(kinds.ast!, source, { ...options, plugins: [runtimeHelpers, lowerAccessors] })!;
  const code = transformFromAstSync(accessors.ast!, source, { ...options, plugins: [guardedOperations] })!;
  const charge = () => types.expressionStatement(types.callExpression(types.identifier('__tick'), []));
  const converted = transformFromAstSync(code.ast!, source, {
    ...options,
    compact: false,
    plugins: [() => ({
      visitor: {
        Loop(path: any) {
          const body = path.get('body');
          if (body.isBlockStatement()) body.unshiftContainer('body', charge());else body.replaceWith(types.blockStatement([charge(), body.node]));
        },
        Function(path: any) {
          const entries = [charge()];
          if (path.node.extra?.bearSourceRange) {
            const args = path.isArrowFunctionExpression()
              ? types.arrayExpression(path.node.params.map((parameter: any) => {
                if (!types.isIdentifier(parameter)) throw path.buildCodeFrameError('Native entry parameters were not lowered');
                return types.cloneNode(parameter);
              })) : types.identifier('arguments');
            entries.push(types.expressionStatement(types.callExpression(
              types.memberExpression(types.identifier('__bearOps'), types.identifier('nativeEntry')), [args])));
          }
          if (path.node.body.type === 'BlockStatement') path.node.body.body.unshift(...entries);else path.node.body = types.blockStatement([...entries, types.returnStatement(path.node.body)]);
        }
      }
    })]
  })!;
  // Immutable source is shared by the loaded artifact, outside every instance.
  const identifiers = new Set<string>();
  types.traverseFast(converted.ast!, (node: any) => { if (types.isIdentifier(node)) identifiers.add(node.name); });
  let sourceName = '__bearNativeSource';
  while (identifiers.has(sourceName)) sourceName += '_';
  const registered = transformFromAstSync(converted.ast!, source, {
    ...options, plugins: [() => registerNativeSources(sourceName), () => generatedGlobals(false,[sourceName])]
  })!.code!;
  return {
    format: 1 as const,
    abi: 'native-main-2',
    policy: 'guarded-operations',
    code: `"use strict";const ${sourceName}=${JSON.stringify(bundle.origins.text+source)};\n` + programFactory(registered, false, bundle.hasTopLevelAwait),
    exportName,
    sourceFiles: bundle.sourceFiles,
    sourceMap: bundle.map
  };
}
