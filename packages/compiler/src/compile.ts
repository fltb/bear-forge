import { createRequire } from 'node:module';
import { dirname, sep } from 'node:path';
import { readFile } from 'node:fs/promises';
import { admitSource } from './admission.ts';
import { createHash } from 'node:crypto';
import { build } from 'esbuild';
import type { Plugin } from 'esbuild';
import { transformSync } from '@babel/core';
import type { CompiledProgram } from '@bear-forge/contracts/loading';
import type { PortShape } from '@bear-forge/contracts/core';
import { lowerAccessors } from './accessors.ts';
import { factorySource } from './factories.ts';
import { typecheckEntry, typecheckSource } from './typecheck.ts';
const require = createRequire(import.meta.url);
const compiler = require('@effectful/core/v2/compiler');
const convert = require('@effectful/core/v2/presets/debugger').default;
const types = require('@babel/types');
const zodRoot = dirname(require.resolve('zod/package.json'));
if (require('zod/package.json').version !== '4.6.5') throw Error('Zod dependency review is required for this version');
export const sourceAdmission: Plugin = {
  name: 'admission',
  setup(build) {
    build.onLoad({
      filter: /\.[cm]?[jt]s$/
    }, async args => {
      if (args.path.startsWith(zodRoot + sep)) return undefined;
      if (args.path.includes('/node_modules/')) throw Error('Dependency is not admitted: ' + args.path);
      admitSource(await readFile(args.path, 'utf8'), args.path);
      return undefined;
    });
  }
};
export type Artifact = {
  format: 1;
  abi: 'effectful-v2-static-2';
  code: string;
  digest: string;
  exportName: string;
  metadata: {
    sourceDigest: string;
    policy: string;
    typescript: string;
    babel: string;
    effectful: string;
  };
  sourceMap: unknown;
};
export function compileJavaScript<S, P extends { [K in keyof P]: PortShape }, R>(source: string, exportName = 'program'): CompiledProgram<S, P, R> {
  admitSource(source, 'program.js');
  return emit<S, P, R>(source, exportName);
}
function emit<S, P extends { [K in keyof P]: PortShape }, R>(source: string, exportName: string, inputSourceMap?: any): CompiledProgram<S, P, R> {
  const loweredResult = transformSync(source, {
    filename: 'program.js',
    sourceMaps: true,
    ...(inputSourceMap ? {
      inputSourceMap
    } : {}),
    configFile: false,
    babelrc: false,
    compact: false,
    plugins: [require("@babel/plugin-transform-class-properties"), require("@babel/plugin-transform-classes"), require("@babel/plugin-transform-parameters"), require("@babel/plugin-transform-destructuring"), require("@babel/plugin-transform-object-rest-spread"), require("@babel/plugin-transform-shorthand-properties"), require("@babel/plugin-transform-spread"), require("@babel/plugin-transform-template-literals"), require("@babel/plugin-transform-for-of"), require("@babel/plugin-transform-optional-chaining"), require("@babel/plugin-transform-nullish-coalescing-operator")]
  })!;
  const lowered = loweredResult.code!;
  const plugin = compiler.babelPlugin((ast: unknown) => convert(ast));
  const accessorResult = transformSync(lowered, {
    filename: 'program.js',
    sourceMaps: true,
    inputSourceMap: JSON.parse(JSON.stringify(loweredResult.map)),
    configFile: false,
    babelrc: false,
    compact: false,
    plugins: [lowerAccessors]
  })!;
  const accessorCode = accessorResult.code!;
  const result = transformSync(accessorCode, {
    filename: 'program.js',
    sourceMaps: true,
    inputSourceMap: JSON.parse(JSON.stringify(accessorResult.map)),
    configFile: false,
    babelrc: false,
    compact: false,
    plugins: [[plugin, {
      rt: 'effects',
      blackbox: true
    }]]
  });
  if (!result?.code) throw new Error('Compilation produced no code');
  let prefix = '$';
  const staticFactories = () => ({
    visitor: {
      CallExpression(path: any) {
        const node = path.node;
        if (node.callee.type !== 'MemberExpression') return;
        if (node.callee.property.name === 'module') prefix = node.arguments[4].value;
        if (node.callee.property.name !== 'fun' || node.arguments.length !== 14) return;
        const args = node.arguments;
        const name = args[1].value ?? '';
        const callee = args[2].value ?? null;
        const parameters = args[4].elements.map((x: any) => x.value);
        const code = factorySource(name, callee, parameters, args[6].value, args[8].value, prefix);
        const factory = transformSync('const factory=' + code, {
          configFile: false,
          babelrc: false,
          ast: true,
          code: false
        })!.ast!;
        node.arguments.push((factory.program.body[0] as any).declarations[0].init);
      }
    }
  });
  const budget = () => ({
    visitor: {
      Loop(path: any) {
        const body = path.get('body');
        const call = types.expressionStatement(types.callExpression(types.identifier('__tick'), []));
        if (body.isBlockStatement()) body.unshiftContainer('body', call);else body.replaceWith(types.blockStatement([call, body.node]));
      }
    }
  });
  const generated = transformSync(result.code, {
    configFile: false,
    babelrc: false,
    compact: false,
    filename: 'compiled-program.js',
    sourceMaps: true,
    inputSourceMap: JSON.parse(JSON.stringify(result.map)),
    plugins: [staticFactories, budget]
  })!;
  const code = '"use strict";\n' + generated.code!;
  const artifact: Artifact = {
    format: 1,
    abi: 'effectful-v2-static-2',
    code,
    digest: createHash('sha256').update(code).digest('hex'),
    exportName,
    metadata: {
      sourceDigest: createHash('sha256').update(source).digest('hex'),
      policy: 'closed-source-v1',
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
  return emit(bundle.outputFiles!.find(f => f.path.endsWith('.js'))!.text, exportName, JSON.parse(bundle.outputFiles!.find(f => f.path.endsWith('.map'))!.text));
}
export async function compileTypeScript<S, P extends { [K in keyof P]: PortShape }, R>(source: string, exportName = 'program') {
  await typecheckSource(source);
  admitSource(source, 'program.ts');
  const bundle = await build({
    stdin: {
      contents: source,
      loader: 'ts',
      resolveDir: process.cwd(),
      sourcefile: 'program.ts'
    },
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
  return emit<S, P, R>(bundle.outputFiles!.find(f => f.path.endsWith('.js'))!.text, exportName, JSON.parse(bundle.outputFiles!.find(f => f.path.endsWith('.map'))!.text));
}
