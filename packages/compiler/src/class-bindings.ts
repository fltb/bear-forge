import { createRequire } from 'node:module';
const t = createRequire(import.meta.url)('@babel/types');
const op = (name: string, args: any[]) => t.callExpression(t.memberExpression(t.identifier('__bearOps'), t.identifier(name)), args);

/** Reify the class's inner name before Babel extracts keys and fields. Each
 * source occurrence is evaluated at most once per containing activation/block
 * entry or loop-header iteration. Its private cell follows that same lifetime. */
export function classBindings(counts: { bindings: number }) {
  return { visitor: { Program(program: any) {
    // An instance field is an implicit per-instance activation. Expose that
    // activation only where a nested class needs a private name environment.
    program.traverse({ 'ClassProperty|ClassPrivateProperty'(path: any) {
      if (!path.node.value) return;
      let nested = t.isClass(path.node.value);
      path.get('value').traverse({ Function(p: any) { p.skip(); }, Class(p: any) { nested = true; p.skip(); } });
      if (!nested) return;
      path.node.value = t.callExpression(t.arrowFunctionExpression([], t.blockStatement([t.returnStatement(path.node.value)])), []);
    } });
    const blockSlots = new Map<any, any[]>();
    const loopSlots = new Map<any, any[]>();
    const keySlots = new Set<any>();
    function ownerOf(path: any) {
      for (let child = path, parent = path.parentPath; parent; child = parent, parent = parent.parentPath) {
        if (parent.isFunction()) { parent.ensureBlock(); return { owner: parent.get('body'), loop: false }; }
        if (parent.isLoop()) {
          if (child.key === 'body') {
            if (!child.isBlockStatement()) child.replaceWith(t.blockStatement([child.node]));
            return { owner: parent.get('body'), loop: false };
          }
          if ((parent.isForStatement() && ['test', 'update'].includes(child.key)) || parent.isWhileStatement() || parent.isDoWhileStatement())
            return { owner: parent, loop: true };
        }
        if (parent.isBlockStatement() || parent.isProgram()) return { owner: parent, loop: false };
      }
      throw path.buildCodeFrameError('Class binding has no execution scope');
    }
    program.scope.crawl();
    program.traverse({ Class: { exit(path: any) {
      const fields=path.get('body.body').filter((p:any)=>p.isClassProperty()&&p.node.computed);
      if(fields.length){
        const keys=path.scope.generateUidIdentifier('classFieldKeys');keySlots.add(keys);
        const {owner,loop}=ownerOf(path),collection=loop?loopSlots:blockSlots;
        if(!collection.has(owner))collection.set(owner,[]);
        collection.get(owner)!.push(keys);
        fields.forEach((field:any,index:number)=>{
          const marker=field.node.extra?.bearFieldName;if(field.node.extra)delete field.node.extra.bearFieldName;
          const access=()=>t.memberExpression(t.cloneNode(keys),t.numericLiteral(index),true);
          field.node.key=t.assignmentExpression('=',access(),op('propertyKey',[field.node.key]));
          if(marker)field.get('value').traverse({Identifier(p:any){
            if(p.node.extra?.bearFieldName&&p.node.name===marker)p.replaceWith(access());
          }});
        });
      }
      if (!path.node.id) return;
      const binding = path.scope.getBinding(path.node.id.name);
      if (!binding) throw path.buildCodeFrameError('Class lost its name binding');
      const references: any[] = [];
      path.traverse({ Identifier(p: any) {
        if (p.node === path.node.id || p.scope.getBinding(p.node.name) !== binding) return;
        if (p.isReferencedIdentifier() || p.isBindingIdentifier()) references.push(p);
      } });
      if (!references.length) return;
      const cell = path.scope.generateUidIdentifier('classBinding');
      const { owner, loop } = ownerOf(path);
      const collection = loop ? loopSlots : blockSlots;
      if (!collection.has(owner)) collection.set(owner, []);
      collection.get(owner)!.push(cell);
      path.node._bearClassCell = cell;
      for (const method of path.node.body.body) if (t.isClassMethod(method) && method.kind === 'constructor') method._bearClassCell = cell;
      counts.bindings++;
      for (const p of references) {
        const parent = p.parentPath;
        if (parent.isObjectProperty() && parent.node.shorthand && p.key === 'value') {
          parent.node.shorthand = false; parent.node.computed = true;
          parent.node.key = t.stringLiteral(parent.node.key.name);
        }
        const target = p.isBindingIdentifier() || parent.isUpdateExpression();
        p.replaceWith(target ? t.memberExpression(op('lexicalReference', [t.cloneNode(cell)]), t.identifier('value'))
          : op('lexicalRead', [t.cloneNode(cell)]));
      }
    } } });
    const initialize = (slot:any) => keySlots.has(slot)?t.arrayExpression([]):op('lexicalCreate', [t.booleanLiteral(false)]);
    for (const [owner, cells] of blockSlots) owner.unshiftContainer('body', t.variableDeclaration('let',
      cells.map(cell => t.variableDeclarator(t.cloneNode(cell), initialize(cell)))));
    for (const [loop, cells] of loopSlots) {
      const declarations = cells.map(cell => t.variableDeclarator(t.cloneNode(cell), initialize(cell)));
      const resets = cells.map(cell => t.assignmentExpression('=', t.cloneNode(cell), initialize(cell)));
      if (loop.isWhileStatement()) {
        loop.replaceWith(t.forStatement(t.variableDeclaration('let', declarations), loop.node.test,
          t.sequenceExpression(resets), loop.node.body));
      } else if (loop.isDoWhileStatement()) {
        const first = loop.scope.generateUidIdentifier('firstIteration');
        loop.replaceWith(t.forStatement(t.variableDeclaration('let', [t.variableDeclarator(t.cloneNode(first), t.booleanLiteral(true)), ...declarations]),
          t.logicalExpression('||', t.cloneNode(first), loop.node.test),
          t.sequenceExpression([t.assignmentExpression('=', t.cloneNode(first), t.booleanLiteral(false)), ...resets]), loop.node.body));
      } else {
        const init = loop.node.init;
        loop.node.update = t.sequenceExpression([...resets, ...(loop.node.update ? [loop.node.update] : [])]);
        if (!init) loop.node.init = t.variableDeclaration('let', declarations);
        else if (t.isVariableDeclaration(init) && init.kind === 'let') init.declarations.push(...declarations);
        else {
          // Keep var declarations in their original function scope and const
          // initializers in a surrounding lexical block; labels still name for.
          let labelled = loop;
          while (labelled.parentPath.isLabeledStatement()) labelled = labelled.parentPath;
          loop.node.init = t.variableDeclaration('let', declarations);
          labelled.replaceWith(t.blockStatement([t.isVariableDeclaration(init) ? init : t.expressionStatement(init), labelled.node]));
        }
      }
    }
    program.traverse({Identifier(path:any){
      if(path.node.extra?.bearFieldName)throw path.buildCodeFrameError('Class field name lost its owning evaluation');
    }});
    program.scope.crawl();
  } } };
}
