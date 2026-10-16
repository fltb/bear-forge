import {moduleMeta} from './module-meta.ts';
import {ambientBindings} from './ambient-bindings.ts';
import type {SourceOrigins} from './source-origins.ts';
import { lexicalBindings } from './lexical.ts';
import { captureSourceRanges, captureLinkedSourceRanges } from './source-metadata.ts';
import {markCallableOrigins,finalizeCallableOrigins,materializeCallableOrigins} from './source-origins.ts';
import { bundleProgram } from './bundle.ts';
import { createRequire } from 'node:module';
import { admitSource } from './admission.ts';
import { createHash } from 'node:crypto';
import { parseSync, transformSync, transformFromAstSync } from '@babel/core';
import type { CompiledProgram } from '@bear-forge/contracts/loading';
import type { PortShape } from '@bear-forge/contracts/core';
import { lowerAccessors, lowerMethods } from './accessors.ts';
import { factorySource, programFactory } from './factories.ts';
import { generatedGlobals } from './generated-globals.ts';
import { typecheckEntry, typecheckSource } from './typecheck.ts';
import { namespaceUsage } from './context.ts';
import { lexicalCaptures } from './captures.ts';
import { guardedOperations, runtimeHelpers } from './operations.ts';
import { lowerSyntax, nameBindings, lexicalNewTarget } from './lowering.ts';
const require = createRequire(import.meta.url);
const compiler = require('@effectful/core/v2/compiler');
const convert = require('@effectful/core/v2/presets/debugger').default;
const types = require('@babel/types');
const generate = require('@babel/generator').generate;
const traversal = require('@babel/traverse').default;
export type Artifact = {
  format: 1;
  abi: 'effectful-v2-main-3';
  code: string;
  digest: string;
  exportName: string;
  contextLayout: 'lexical-cells';
  namespaceKeys: string[] | null;
  metadata: {
    sourceDigest: string;
    sourceFiles: [string, string][];
    policy: string;
    typescript: string;
    babel: string;
    effectful: string;
  };
  sourceMap: unknown;
};
export function compileJavaScript<S, P extends { [K in keyof P]: PortShape }, R>(source: string, exportName = 'program'): CompiledProgram<S, P, R> {
  const admission = admitSource(source, 'program.js', 'standalone');
  const origins:SourceOrigins={text:'',ranges:[],segments:[],remap:[]};
  const marked=markCallableOrigins(source,'program.js',origins);
  finalizeCallableOrigins(origins);
  const ambient = transformSync(marked, {
    filename:'program.js',sourceType:'module',configFile:false,babelrc:false,sourceMaps:true,
    plugins:[ambientBindings],
  });
  if(typeof ambient?.code!=='string')throw Error('Global binding adaptation produced no code');
  const standalone = transformSync(ambient.code, {
    filename:'program.js',sourceType:'module',configFile:false,babelrc:false,sourceMaps:true,
    ...(ambient.map ? {inputSourceMap:ambient.map as any} : {}),
    plugins:[require('@babel/plugin-transform-modules-commonjs')],
  });
  if(typeof standalone?.code!=='string')throw Error('Standalone module adaptation produced no code');
  const annotated=transformSync(standalone.code,{
    filename:'program.js',sourceType:'module',configFile:false,babelrc:false,sourceMaps:true,
    ...(standalone.map ? {inputSourceMap:standalone.map as any} : {}),plugins:[()=>materializeCallableOrigins(origins)],
  });
  if(typeof annotated?.code!=='string')throw Error('Standalone source annotation produced no code');
  return emit<S, P, R>(annotated.code, exportName, annotated.map, origins, admission.hasTopLevelAwait);
}
/** Finish the continuation stage in its own activation so its input ASTs and
 * Babel traversal scopes are no longer retained during factory generation. */
function lowerContinuation(source: string, inputSourceMap?: any, origins?:SourceOrigins, hasTopLevelAwait = false) {
  // Intermediate stages exchange ASTs; only continuation and final emission
  // need generated text/maps. Avoid retaining unused intermediate outputs.
  const namedResult = transformSync(source, {
    filename: 'program.js', code: false, sourceMaps: true, ast: true, sourceType: 'module',
    // Removing ESM import/export syntax must not turn an AwaitExpression into
    // an identifier/tag. Carry the original AST fact instead of guessing from
    // emitted source.
    parserOpts: { tokens: true, allowAwaitOutsideFunction: hasTopLevelAwait }, configFile: false, babelrc: false,
    ...(inputSourceMap ? { inputSourceMap } : {}), plugins: [origins?()=>captureLinkedSourceRanges(origins):captureSourceRanges, nameBindings,()=>moduleMeta('bear-forge:program')]
  })!;
  const loweredResult = lowerSyntax(source, inputSourceMap, namedResult.ast);
  // Continuation lowering uses the same strict module activation as admission.
  loweredResult.ast!.program.sourceType = 'module';
  const plugin = compiler.babelPlugin((ast: unknown) => convert(ast));
  const accessorResult = transformFromAstSync(loweredResult.ast!, source, {
    cloneInputAst: false, ast: true, code: false,
    filename: 'program.js',
    sourceMaps: true,
    ...(inputSourceMap ? { inputSourceMap } : {}),
    configFile: false,
    babelrc: false,
    compact: false,
    plugins: [runtimeHelpers, lowerAccessors, () => ({ visitor: {
      Identifier(path: any) {
        if (path.node.name !== 'exports' || path.scope.getBinding('exports')) return;
        if (path.isReferencedIdentifier() || path.parentPath.isAssignmentExpression() && path.parentPath.node.left === path.node) path.node.name = '__bearExports';
      }
    } })]
  })!;
  const operationsResult = transformFromAstSync(accessorResult.ast!, source, {
    cloneInputAst: false,
    configFile: false, babelrc: false, sourceMaps: true, ast: true, code: false,
    ...(inputSourceMap ? { inputSourceMap } : {}),
    plugins: [lexicalBindings, lexicalNewTarget, lowerMethods, [guardedOperations, {allocations: true}]]
  })!;
  // Module evaluation has its own async completion even though Babel represents
  // the compilation unit as File rather than an AsyncFunction node.
  operationsResult.ast!.extra = {...operationsResult.ast!.extra, bearAsyncModule:hasTopLevelAwait};
  const result = transformFromAstSync(operationsResult.ast!, source, {
    // The operation AST is exclusively owned by this stage and never reused.
    // Let continuation lowering consume it instead of cloning the entire tree.
    cloneInputAst: false,
    filename: 'program.js',
    sourceMaps: true,
    ...(inputSourceMap ? { inputSourceMap } : {}),
    configFile: false,
    babelrc: false,
    compact: false,
    plugins: [[plugin, {
      rt: 'effects',
      blackbox: true,
      // Author dependencies communicate with the host only through declared
      // IO. The upstream debugger preset otherwise captures bundler globals.
      closureVars: [],
      expLooseNext: false
    }]]
  });
  if (!result?.code) throw new Error('Compilation produced no code');
  return { code: result.code, map: result.map };
}
function emit<S, P extends { [K in keyof P]: PortShape }, R>(source: string, exportName: string, inputSourceMap?: any, origins?:SourceOrigins, hasTopLevelAwait = false, sourceFiles: [string,string][] = []): CompiledProgram<S, P, R> {
  const result = lowerContinuation(source, inputSourceMap, origins, hasTopLevelAwait);
  let prefix = '$';
  const budgetFaultCheck = () => types.ifStatement(types.memberExpression(types.memberExpression(types.memberExpression(types.identifier('effects'), types.identifier('State')), types.identifier('context')), types.identifier('__budgetExceeded')), types.throwStatement(types.newExpression(types.identifier('Error'), [types.stringLiteral('budget exceeded')])));
  const staticFactories = () => ({
    visitor: {
      ReferencedIdentifier(path: any) {
        if (!['module', '__bearModule', 'exports', '__bearExports', 'globalThis'].includes(path.node.name) || path.scope.getBinding(path.node.name)) return;
        const field = ['module','__bearModule'].includes(path.node.name) ? 'cjs' : ['exports', '__bearExports'].includes(path.node.name) ? 'initialExports' : 'globals';
        path.replaceWith(types.memberExpression(types.memberExpression(types.memberExpression(types.identifier('effects'), types.identifier('State')), types.identifier('context')), types.identifier(field)));
      },
      AssignmentExpression(path: any) {
        if (path.node.left.type === 'Identifier' && ['exports', '__bearExports'].includes(path.node.left.name) && !path.scope.getBinding(path.node.left.name)) {
          path.node.left = types.memberExpression(types.memberExpression(types.memberExpression(types.identifier('effects'), types.identifier('State')), types.identifier('context')), types.identifier('initialExports'));
        }
      },
      Program: { exit(path: any) {
        // No later Babel visitor needs bindings from these generated factories.
        // Insert them after all scope-dependent rewrites and budget checks.
        types.traverseFast(path.node, (node: any) => {
          if (!types.isCallExpression(node)) return;
          if (node.callee.type !== 'MemberExpression') return;
          if (node.callee.property.name === 'module') {
            prefix = node.arguments[4].value;
            node.arguments.push(types.stringLiteral((origins?.text??'')+source));
          }
          if (node.callee.property.name !== 'fun' || node.arguments.length !== 15) return;
          const args = node.arguments;
          const name = args[1].value ?? '';
          const callee = args[2].value ?? null;
          const parameters = args[4].elements.map((x: any) => x.value);
          const code = factorySource(name, callee, parameters, args[6].value, args[8].value, prefix, node.bearCaptures, node.bearUncapturedLocals, node.bearRawLocals, node.bearCapturedLocals, node.bearGroupedLocals);
          // Factory text is already generated JavaScript. Parsing supplies its AST;
          // running a transform would create redundant traversal scopes for every
          // inserted factory and retain them throughout the outer transformation.
          const factory = parseSync('const factory=' + code, {
            configFile: false,
            babelrc: false
          })!;
          types.traverseFast(factory, (child: any) => {
            if (types.isCatchClause(child)) child.body.body.unshift(budgetFaultCheck());
          });
          const sourceRange = node.arguments.pop();
          node.arguments.push((factory.program.body[0] as any).declarations[0].init, sourceRange);
        });
      } }
    }
  });
  const budget = () => ({
    visitor: {
      CatchClause(path: any) {
        // An exhausted execution must unwind past generated exception machinery.
        // Otherwise the continuation dispatcher can repeatedly catch its own budget fault.
        path.get('body').unshiftContainer('body', budgetFaultCheck());
      },
      Loop(path: any) {
        const body = path.get('body');
        const call = types.expressionStatement(types.callExpression(types.identifier('__tick'), []));
        if (body.isBlockStatement()) body.unshiftContainer('body', call);else body.replaceWith(types.blockStatement([call, body.node]));
      }
    }
  });
  const {Program:factoryVisitor,...bindingVisitors}=staticFactories().visitor;
  const ast = transformSync(result.code, {
    configFile: false,
    babelrc: false,
    compact: false,
    code: false,
    ast: true,
    filename: 'compiled-program.js',
    sourceType: 'module',
    sourceMaps: true,
    inputSourceMap: JSON.parse(JSON.stringify(result.map)),
    plugins: [()=>({visitor:bindingVisitors}), budget, () => generatedGlobals(true)]
  })!.ast;
  // Capture/factory passes and printing do not need source lexical scopes.
  // Release caches only for this exclusively-owned tree, never global caches
  // that may belong to another compiler consumer. Keep all AST metadata/maps.
  types.traverseFast(ast, (node: any) => {
    traversal.cache.path.delete(node);
    traversal.cache.scope.delete(node);
  });
  // Captures and liveness inspect explicit continuation slots, not source
  // lexical bindings. Avoid rebuilding Babel scopes for those generated trees.
  traversal(ast,{noScope:true,...lexicalCaptures().visitor});
  traversal(ast,{noScope:true,Program:factoryVisitor});
  types.traverseFast(ast, (node:any)=>{
    traversal.cache.path.delete(node);traversal.cache.scope.delete(node);
  });
  const generated = generate(ast, {
    comments: true, compact: false, sourceMaps: true,
    sourceFileName: 'compiled-program.js', inputSourceMap: result.map
  }, result.code);
  const code = programFactory(generated.code!, true);
  const artifact: Artifact = {
    format: 1,
    abi: 'effectful-v2-main-3',
    code,
    digest: createHash('sha256').update(code).digest('hex'),
    exportName,
    contextLayout: 'lexical-cells',
    namespaceKeys: namespaceUsage(source),
    metadata: {
      sourceDigest: createHash('sha256').update(source).digest('hex'),
      sourceFiles,
      policy: 'guarded-operations',
      typescript: require('typescript/package.json').version,
      babel: require('@babel/core/package.json').version,
      effectful: require('@effectful/core/package.json').version
    },
    sourceMap: generated.map
  };
  return {
    kind: 'controlled-program',
    content: new TextEncoder().encode(JSON.stringify(artifact))
  } as CompiledProgram<S, P, R>;
}
export async function compileEntry<S, P extends { [K in keyof P]: PortShape }, R>(entry: string, exportName = 'program'): Promise<CompiledProgram<S, P, R>> {
  await typecheckEntry(entry);
  const bundle = await bundleProgram(entry);
  return emit<S, P, R>(bundle.code, exportName, bundle.map, bundle.origins, bundle.hasTopLevelAwait, bundle.sourceFiles);
}
export async function compileTypeScript<S, P extends { [K in keyof P]: PortShape }, R>(source: string, exportName = 'program') {
  await typecheckSource(source);
  const bundle = await bundleProgram('program.ts', source);
  return emit<S, P, R>(bundle.code, exportName, bundle.map, bundle.origins, bundle.hasTopLevelAwait, bundle.sourceFiles);
}
