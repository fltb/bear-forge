import { createRequire } from 'node:module';
import { transformSync, transformFromAstSync } from '@babel/core';
import { optionalCalls } from './optional.ts';
import { runtimeHelpers } from './operations.ts';
import { iteratorRegions } from './iterator-regions.ts';
import { classBindings } from './class-bindings.ts';
import { lowerForOf } from './for-of.ts';
const require = createRequire(import.meta.url);
const t = require('@babel/types');
/** Both execution paths lower precisely the same source constructs before
 * inserting operation guards. Native execution retains native async/await. */
const syntaxLowering = [
  'class-static-block', 'private-property-in-object', 'private-methods', 'class-properties', 'classes', 'parameters',
  'template-literals',
  'nullish-coalescing-operator',
].map(name => require('@babel/plugin-transform-' + name)).concat(optionalCalls);

/** Keep semantic identity while Babel expands class syntax. These fields only
 * exist on compiler-owned AST nodes; source programs cannot supply them. */
type ClassCounts = { source: number; lowered: number; superSource: number; superRequested: number; superLowered: number; bindings: number; initializedBindings: number };
function markClasses(counts: ClassCounts) {
  return { pre(this: any) {
    // Use Babel's helper protocol, never names inferred from emitted source.
    const previous = this.file.get('helperGenerator');
    let creatingClassHelper = false;
    this.file.set('helperGenerator', (name: string) => {
      if (name === 'createClass' && !creatingClassHelper) {
        creatingClassHelper = true;
        let helper;
        try { helper = this.file.addHelper(name); } finally { creatingClassHelper = false; }
        helper.extra = { ...helper.extra, bearCreateClass: true };
        return helper;
      }
      if (name !== 'callSuper') return previous?.(name);
      counts.superRequested++;
      const marker = this.file.scope.generateUidIdentifier('superCall');
      marker.extra = { bearSuperCall: true };
      return marker;
    });
  }, visitor: { Program(path: any) {
    path.traverse({ 'CallExpression|OptionalCallExpression'(path: any) {
      if (t.isSuper(path.node.callee)) {
        counts.superSource++;
      }
      const callee = path.node.callee;
      if (t.isSuper(callee) || (t.isMemberExpression(callee) || t.isOptionalMemberExpression(callee)) && t.isSuper(callee.object)) {
        // Explicit super spreads use iterators, including super.method(...x).
        // Normalize before helpers can replace them with array-like forwarding.
        if (path.node.arguments.some((argument: any) => t.isSpreadElement(argument))) path.node.arguments = [t.spreadElement(t.arrayExpression(path.node.arguments))];
      }
    }, Class(path: any) {
      counts.source++;
      if (path.node.superClass && !path.node.body.body.some((method: any) => t.isClassMethod(method) && method.kind === 'constructor')) {
        counts.superSource++; // The default derived constructor forwards once.
      }
      path.node._bearClassConstructor = true;
      path.node._bearSourceRange = path.node.extra?.bearSourceRange;
      for (const method of path.node.body.body) {
        if(t.isClassPrivateMethod(method)) method.body.extra={...method.body.extra,
          bearPrivateMethod:{name:'#'+method.key.id.name,kind:method.kind,extra:method.extra}};
        if (t.isClassProperty(method) && method.computed) method.key = t.callExpression(
          t.memberExpression(t.identifier('__bearOps'), t.identifier('propertyKey')), [method.key]);
        if (!t.isClassMethod(method)) continue;
        if (method.kind === 'constructor') {
          method._bearClassConstructor = true;
          method._bearSourceRange = path.node.extra?.bearSourceRange;
        }
        else {
          method._bearClassMethod = method.kind;
          method._bearSourceRange = method.extra?.bearSourceRange;
          // Capture the actual property key once at class evaluation, before
          // Babel lifts computed keys into the class-creation closure.
          if (method.computed) method.key = t.callExpression(
            t.memberExpression(t.identifier('__bearOps'), t.identifier('propertyKey')), [method.key]);
        }
      }
    } });
  } } };
}

/** Babel's computed-key extraction can push a generated let into a loop body
 * although its assignments and captured reads are in the loop header. Move
 * only those compiler-owned declarations into the header's lexical environment. */
function generatedLexicalBindings() {
  return {visitor:{Program:{exit(program:any){
    program.traverse({VariableDeclaration(path:any){
      const generated=path.node.declarations.every((node:any)=>
        !node.loc&&t.isIdentifier(node.id)&&path.scope.hasUid(node.id.name));
      for(const node of path.node.declarations)if(!node.loc&&t.isIdentifier(node.id)&&path.scope.hasUid(node.id.name))
        node.extra={...node.extra,bearGeneratedBinding:true};
      // Class lowering allocates temporary bindings in a loop body using var.
      // Preserve that allocation's iteration scope before closures capture it.
      // Header allocations are subsequently moved by loopHeaderBindings.
      let repeated=false;
      for(let owner=path.parentPath;owner&&!owner.isFunction();owner=owner.parentPath)
        if(owner.isLoop()){repeated=true;break;}
      if(generated&&path.node.kind==='var'&&path.parentPath.isBlockStatement()&&repeated){
        // Scope.push caches the generated var declaration on its containing
        // block. It must not reuse that path after lexical lowering replaces it.
        for(const key of Object.keys(path.parentPath.data))
          if(path.parentPath.data[key]===path)delete path.parentPath.data[key];
        path.node.kind='let';
      }
    }});
  }}}};
}

function loopHeaderBindings() {
  return {visitor:{Program(program:any){
    program.scope.crawl();
    program.traverse({'ForStatement|WhileStatement|DoWhileStatement'(path:any){
      const body=path.get('body');if(!body.isBlockStatement())return;
      const needed=new Set<string>();
      for(const part of path.isForStatement()?['init','test','update']:['test']){
        const header=path.get(part);if(!header.node)continue;
        header.traverse({Identifier(reference:any){
          if(reference.isReferencedIdentifier()||reference.isBindingIdentifier())needed.add(reference.node.name);
        }});
      }
      const moved:any[]=[];
      for(const statement of body.get('body')){
        if(!statement.isVariableDeclaration({kind:'let'})||statement.node.loc)continue;
        const retained=[];
        for(const declaration of statement.node.declarations){
          if(t.isIdentifier(declaration.id)&&!declaration.init&&needed.has(declaration.id.name)&&declaration.extra?.bearGeneratedBinding)moved.push(declaration);
          else retained.push(declaration);
        }
        if(retained.length)statement.node.declarations=retained;else statement.remove();
      }
      if(!moved.length)return;
      if(path.isWhileStatement()){
        path.replaceWith(t.forStatement(t.variableDeclaration('let',moved),path.node.test,null,path.node.body));return;
      }
      if(path.isDoWhileStatement()){
        const first=path.scope.generateUidIdentifier('firstIteration');
        path.replaceWith(t.forStatement(t.variableDeclaration('let',[t.variableDeclarator(t.cloneNode(first),t.booleanLiteral(true)),...moved]),
          t.logicalExpression('||',t.cloneNode(first),path.node.test),
          t.assignmentExpression('=',t.cloneNode(first),t.booleanLiteral(false)),path.node.body));return;
      }
      if(!path.node.init)path.node.init=t.variableDeclaration('let',moved);
      else if(t.isVariableDeclaration(path.node.init,{kind:'let'}))path.node.init.declarations.push(...moved);
      else throw path.buildCodeFrameError('Generated loop-header binding lost its lexical allocation scope');
    }});
    program.scope.crawl();
  }}};
}

function materializeClasses(counts: ClassCounts) {
  const thisBindings = new Map<object, any>();
  return { visitor: {
    Program(program: any) {
      // Babel recreates private method declarations but retains their bodies.
      // Carry callable identity through that owned AST, not generated names.
      const hoisted=new Map<any,any[]>();
      program.traverse({FunctionDeclaration(path:any){
        const node=path.node,metadata=node.body.extra?.bearPrivateMethod;
        if(!metadata)return;
        delete node.body.extra.bearPrivateMethod;
        if(!node.id||!path.inList||!path.parentPath.isBlockStatement()&&!path.parentPath.isProgram())
          throw path.buildCodeFrameError('Private method lowering lost declaration scope');
        const method=t.objectMethod('method',t.identifier('method'),node.params,node.body,false,node.generator,node.async);
        method.extra=metadata.extra;
        const value=t.callExpression(t.memberExpression(t.identifier('__bearOps'),t.identifier('nameMethod')),
          [t.memberExpression(t.objectExpression([method]),t.identifier('method')),t.stringLiteral(metadata.name),t.stringLiteral(metadata.kind)]);
        const list=hoisted.get(path.parentPath)??[];
        list.push(t.variableDeclaration('let',[t.variableDeclarator(t.cloneNode(node.id),value)]));
        hoisted.set(path.parentPath,list);path.remove();
      }});
      for(const [parent,declarations]of hoisted)parent.unshiftContainer('body',declarations);
      program.scope.crawl();
      program.traverse({ CallExpression(path: any) {
        if (!path.node.callee.extra?.bearCreateClass) return;
        const constructor = path.node.arguments[0];
        const node = t.isIdentifier(constructor) ? path.scope.getBinding(constructor.name)?.path.node : constructor;
        const cell = node?._bearClassCell;
        if (!cell) return;
        delete path.node.callee.extra.bearCreateClass;
        counts.initializedBindings++;
        path.replaceWith(t.callExpression(t.memberExpression(t.identifier('__bearOps'), t.identifier('lexicalInitialize')),
          [t.cloneNode(cell), path.node]));
      } });
    },
    CallExpression: { exit(path: any) {
      if (!path.node.callee.extra?.bearSuperCall) return;
      const args = path.node.arguments;
      if (args.length < 2 || args.length > 3) throw path.buildCodeFrameError('Class lowering changed the super helper contract');
      const operation = (name: string, args: any[]) => t.callExpression(
        t.memberExpression(t.identifier('__bearOps'), t.identifier(name)), args);
      let owner = path.getFunctionParent();
      while (owner?.isArrowFunctionExpression()) owner = owner.getFunctionParent();
      if (!owner?.node._bearClassConstructor) throw path.buildCodeFrameError('Class lowering lost super lexical ownership');
      let binding = thisBindings.get(owner.node);
      if (!binding) {
        binding = owner.scope.generateUidIdentifier('thisBinding');
        owner.scope.push({ id: binding, init: t.objectExpression([
          t.objectProperty(t.identifier('initialized'), t.booleanLiteral(false))
        ]) });
        thisBindings.set(owner.node, binding);
      }
      counts.superLowered++;
      // Target V8 selects the current superclass after evaluating arguments.
      // The temporary is an ordinary compiled local, including across IO.
      const argumentsValue = path.scope.generateUidIdentifier('superArguments');
      path.scope.push({ id: t.cloneNode(argumentsValue) });
      path.replaceWith(t.sequenceExpression([
        t.assignmentExpression('=', t.cloneNode(argumentsValue), args[2] ?? t.arrayExpression([])),
        operation('superConstruct', [
          operation('superConstructor', [args[1]]), t.cloneNode(argumentsValue),
          t.metaProperty(t.identifier('new'), t.identifier('target')), t.cloneNode(binding)
        ])
      ]));
    } },
    Function: { exit(path: any) {
    const node = path.node;
    if (node._bearSourceRange) {
      node.extra = { ...node.extra, bearSourceRange: node._bearSourceRange };
      delete node._bearSourceRange;
    }
    if (node._bearClassConstructor) {
      counts.lowered++;
      delete node._bearClassConstructor;
      node.body.body.unshift(t.expressionStatement(t.callExpression(
        t.memberExpression(t.identifier('__bearOps'), t.identifier('classCall')),
        [t.metaProperty(t.identifier('new'), t.identifier('target'))])));
      if (t.isFunctionDeclaration(node)) {
        // Babel's class wrapper uses a function declaration for the constructor.
        // The surrounding class-name binding is immutable, unlike an ordinary
        // function declaration; keep that distinction for methods and captures.
        if (!node.id) throw path.buildCodeFrameError('Class constructor lost its binding');
        const binding = t.cloneNode(node.id);
        path.replaceWith(t.variableDeclaration('const', [t.variableDeclarator(binding, t.toExpression(node))]));
        return;
      }
    }
    if (!node._bearClassMethod) return;
    if (!t.isFunctionExpression(node) || !node.key) throw path.buildCodeFrameError('Class lowering lost method identity');
    const kind = node._bearClassMethod;
    delete node._bearClassMethod;
    const key = node.computed ? node.key : t.stringLiteral(String(node.key.name ?? node.key.value));
    const method = t.objectMethod('method', t.identifier('method'), node.params, node.body, false, node.generator, node.async);
    method.extra = node.extra;
    const callable = t.memberExpression(t.objectExpression([method]), t.identifier('method'));
    path.replaceWith(t.callExpression(t.memberExpression(t.identifier('__bearOps'), t.identifier('nameMethod')),
      [callable, key, t.stringLiteral(kind)]));
  } } } };
}

export function lowerSyntax(source: string, inputSourceMap?: any, inputAst?: any) {
  const counts = { source: 0, lowered: 0, superSource: 0, superRequested: 0, superLowered: 0, bindings: 0, initializedBindings: 0 };
  const parameterOptions = {
    filename: 'program.js', configFile: false, babelrc: false, ast: true, code: false, sourceMaps: true, sourceType: 'module' as const,
    ...(inputSourceMap ? { inputSourceMap } : {}),
    plugins: [runtimeHelpers, require('@babel/plugin-transform-parameters'), lowerForOf, require('../../../vendor/babel-destructuring/index.js').default]
  };
  // Loop heads must retain TDZ information before destructuring is expanded.
  // Both transformations finish before class metadata is attached: initializer
  // cloning must not discard the class transform's ownership annotations.
  // Finish resource lowering before iteration/destructuring consumes loop heads.
  const resourceOptions={...parameterOptions,plugins:[runtimeHelpers,()=>({visitor:{Program(path:any){
    // A linked execution unit has no ESM declarations. Its lifetime is one
    // initialization activation; retain lexical bindings inside its cleanup.
    if(path.node.body.some((node:any)=>t.isVariableDeclaration(node)&&['using','await using'].includes(node.kind))
      &&!path.node.body.some((node:any)=>t.isImportDeclaration(node)||t.isExportDeclaration(node)))
      path.node.body=[t.blockStatement(path.node.body)];
  }}}),require('../../../vendor/babel-resource-management/index.js').default,()=>({visitor:{Program:{exit(path:any){path.scope.crawl();}}}})]};
  const resources=inputAst?transformFromAstSync(inputAst,source,{...resourceOptions,cloneInputAst:false})!
    :transformSync(source,resourceOptions)!;
  const parameters = transformFromAstSync(resources.ast!, source, { ...parameterOptions, cloneInputAst: false })!;
  const lowered = transformFromAstSync(parameters.ast!, source, {
    filename: 'program.js', configFile: false, babelrc: false, sourceMaps: true, ast: true, code: false, sourceType: 'module' as const,
    ...(inputSourceMap ? { inputSourceMap } : {}),
    cloneInputAst: false, assumptions: { noClassCalls: true }, plugins: [runtimeHelpers, () => classBindings(counts), () => markClasses(counts), ...syntaxLowering, generatedLexicalBindings]
  })!;
  // No print/reparse or AST clone before consuming class identity: either would
  // discard Babel's original ClassMethod node fields after toExpression.
  const result = transformFromAstSync(lowered.ast!, source, {
    filename: 'program.js', configFile: false, babelrc: false, sourceMaps: true, ast: true, code: false,
    ...(inputSourceMap ? { inputSourceMap } : {}),
    cloneInputAst: false, plugins: [loopHeaderBindings, iteratorRegions, () => materializeClasses(counts)]
  })!;
  if (counts.bindings !== counts.initializedBindings) throw new Error('Class lowering lost inner binding initialization');
  if (counts.source !== counts.lowered) throw new Error('Class lowering lost constructor identity');
  if (counts.superSource !== counts.superRequested || counts.superRequested !== counts.superLowered) throw new Error('Class lowering lost super call identity');
  return result;
}

/** Arrow new.target belongs to the nearest ordinary function. Lower it to an
 * ordinary lexical binding so the existing cell capture/fork machinery owns it,
 * rather than treating an arrow invocation as a constructor activation. Run
 * after parameter lowering so the binding precedes default-parameter effects. */
export function lexicalNewTarget() {
  return { visitor: { Program(path: any) {
    const bindings = new Map<object, any>();
    path.traverse({ MetaProperty(path: any) {
      if (path.node.meta.name !== 'new' || path.node.property.name !== 'target') return;
      let owner = path.getFunctionParent();
      if (!owner?.isArrowFunctionExpression()) return;
      do { owner = owner.getFunctionParent(); } while (owner?.isArrowFunctionExpression());
      if (!owner) throw path.buildCodeFrameError('new.target has no lexical function');
      let binding = bindings.get(owner.node);
      if (!binding) {
        binding = owner.scope.generateUidIdentifier('newTarget');
        owner.scope.push({ id: binding, init: t.metaProperty(t.identifier('new'), t.identifier('target')) });
        bindings.set(owner.node, binding);
      }
      path.replaceWith(t.cloneNode(binding));
    } });
  } } };
}

/** Record named evaluation before parameter/destructuring transforms erase it. */
export function nameBindings() {
  const t = require('@babel/types');
  return { visitor: {
    ClassExpression(path: any) {
      if (path.node.id) return;
      const parent=path.parentPath.node;
      let name:any=t.stringLiteral('');
      const binding=t.isVariableDeclarator(parent)&&parent.init===path.node?parent.id
        : (t.isAssignmentPattern(parent)||t.isAssignmentExpression(parent)&&['=','&&=','||=','??='].includes(parent.operator))&&parent.right===path.node?parent.left:null;
      if(t.isIdentifier(binding))name=t.stringLiteral(binding.name);
      else if((t.isObjectProperty(parent)||t.isClassProperty(parent))&&parent.value===path.node){
        if(parent.computed){
          const key=path.parentPath.scope.generateUidIdentifier('className');
          if(t.isClassProperty(parent)){
            parent.extra={...parent.extra,bearFieldName:key.name};
            name=t.cloneNode(key);name.extra={bearFieldName:true};
          }else{
            path.parentPath.scope.push({id:t.cloneNode(key)});
            parent.key=t.assignmentExpression('=',t.cloneNode(key),t.callExpression(
              t.memberExpression(t.identifier('__bearOps'),t.identifier('propertyKey')),[parent.key]));
            name=t.cloneNode(key);
          }
        }else if(t.isClassProperty(parent)||(parent.key.name??parent.key.value)!=='__proto__')name=t.stringLiteral(String(parent.key.name??parent.key.value));
      }
      if(typeof path.node.extra?.bearInferredName==='string'){
        name=t.stringLiteral(path.node.extra.bearInferredName);delete path.node.extra.bearInferredName;
      }
      path.node.body.body.unshift(t.staticBlock([t.expressionStatement(t.callExpression(
        t.memberExpression(t.identifier('__bearOps'),t.identifier('nameClass')),[t.thisExpression(),name]))]));
    },
    'FunctionExpression|ArrowFunctionExpression'(path: any) {
      if (path.node.id) return;
      const parent = path.parentPath.node;
      const binding = parent.type === 'VariableDeclarator' && parent.init === path.node ? parent.id
        : (parent.type === 'AssignmentPattern' || parent.type === 'AssignmentExpression' && ['=', '&&=', '||=', '??='].includes(parent.operator)) && parent.right === path.node ? parent.left : null;
      const recorded=path.node.extra?.bearInferredName;
      if (!t.isIdentifier(binding)&&typeof recorded!=='string') return;
      if(typeof recorded==='string')delete path.node.extra.bearInferredName;
      path.replaceWith(t.callExpression(t.memberExpression(t.identifier('__bearOps'), t.identifier('nameFunction')), [path.node, t.stringLiteral(recorded??binding.name)]));
    }
  } };
}
