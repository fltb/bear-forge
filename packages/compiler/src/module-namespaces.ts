import { createRequire } from 'node:module';
const t = createRequire(import.meta.url)('@babel/types');
const operation=(name:string,args:any[])=>t.callExpression(t.memberExpression(t.identifier('__bearOps'),t.identifier(name)),args);

/** Give indirect named exports explicit imported local bindings before any
 * printing. Babel's ExportSpecifier printer compares identifier names even
 * when both export names are string literals, losing a differing alias. The
 * normalized form retains live bindings and never emits that ambiguous pair. */
export function namedReexportBindings(){
  return {visitor:{ExportNamedDeclaration(path:any){
    const node=path.node;
    if(!node.source||node.exportKind==='type'||!node.specifiers.length||
      !node.specifiers.every((specifier:any)=>t.isExportSpecifier(specifier)&&specifier.exportKind!=='type'))return;
    const imports:any[]=[],exports:any[]=[];
    for(const specifier of node.specifiers){
      const local=path.scope.generateUidIdentifier('reexport');
      imports.push(t.importSpecifier(t.cloneNode(local),t.cloneNode(specifier.local)));
      exports.push(t.exportSpecifier(t.cloneNode(local),t.cloneNode(specifier.exported)));
    }
    const declaration=t.importDeclaration(imports,t.cloneNode(node.source));
    declaration.attributes=node.attributes?.map((attribute:any)=>t.cloneNode(attribute,true));
    path.replaceWithMultiple([declaration,t.exportNamedDeclaration(null,exports)]);
  }}};
}

/** Default expressions initialize a lexical snapshot binding at evaluation.
 * Make it explicit before Rollup can replace the implicit binding with var.
 * Function/class declarations keep their own instantiation semantics. */
export function defaultExportBindings(){
  return {visitor:{ExportDefaultDeclaration(path:any){
    if(t.isDeclaration(path.node.declaration))return;
    const binding=path.scope.generateUidIdentifier('defaultExport');
    path.replaceWithMultiple([
      t.variableDeclaration('const',[t.variableDeclarator(t.cloneNode(binding),path.node.declaration)]),
      t.exportNamedDeclaration(null,[t.exportSpecifier(t.cloneNode(binding),t.identifier('default'))]),
    ]);
  }}};
}

/** Mark semantic namespace imports before linking. Admission has already
 * rejected author access to __bearOps; markers are compiler-owned and consumed
 * before emission. This avoids guessing linker variable names or matching
 * arbitrary author Object.freeze expressions. */
export function markModuleNamespaces(register: (source: string, attributes:Record<string,string>) => number) {
  const attributes=(path:any):Record<string,string>=>Object.fromEntries((path.node.attributes??[]).map((item:any)=>[item.key.name??item.key.value,item.value.value]));
  return {visitor:{
    ImportDeclaration(path:any){
      if(path.node.importKind==='type')return;
      const token=register(path.node.source.value,attributes(path));
      const namespace=path.node.specifiers.find((item:any)=>t.isImportNamespaceSpecifier(item));
      if(namespace)path.insertAfter(t.expressionStatement(operation('moduleNamespaceMarker',[t.cloneNode(namespace.local),t.numericLiteral(token)])));
    },
    ExportAllDeclaration(path:any){
      if(path.node.exportKind==='type')return;
      register(path.node.source.value,attributes(path));
    },
    ExportNamedDeclaration(path:any){
      if(path.node.exportKind==='type')return;
      if(path.node.source){
        register(path.node.source.value,attributes(path));
      }
      const namespace=path.node.specifiers.find((item:any)=>t.isExportNamespaceSpecifier(item));
      if(!namespace)return;
      const local=path.scope.generateUidIdentifier('namespace');
      const imported=t.importDeclaration([t.importNamespaceSpecifier(t.cloneNode(local))],t.cloneNode(path.node.source));
      imported.attributes=path.node.attributes;
      path.replaceWithMultiple([imported,t.exportNamedDeclaration(null,[t.exportSpecifier(t.cloneNode(local),namespace.exported)])]);
    },
  }};
}

/** Consume namespace provenance and adapt its live binding table. Validate the
 * pinned linker's emitted shape; unsupported output is an error, never a guessed
 * object or silently different module. */
export function materializeModuleNamespaces(){
  return {visitor:{Program(program:any){
    program.scope.crawl();const declarations=new Set<any>();
    program.traverse({CallExpression(path:any){
      const callee=path.node.callee;
      if(!t.isMemberExpression(callee)||callee.computed||!t.isIdentifier(callee.object,{name:'__bearOps'})||
        !t.isIdentifier(callee.property))return;
      if(callee.property.name!=='moduleNamespaceMarker')return;
      const [reference,token]=path.node.arguments;
      if(path.node.arguments.length!==2||!t.isNumericLiteral(token)||!t.isIdentifier(reference)||!path.parentPath.isExpressionStatement())
        throw path.buildCodeFrameError('Namespace marker lost its binding reference');
      const binding=path.scope.getBinding(reference.name);
      if(!binding?.path.isVariableDeclarator())throw path.buildCodeFrameError('Namespace marker lost its declaration');
      declarations.add(binding.path);path.parentPath.remove();
    }});
    for(const path of declarations){
      const initializer=path.node.init;
      if(!t.isCallExpression(initializer)||!t.isMemberExpression(initializer.callee)||initializer.callee.computed||
        !t.isIdentifier(initializer.callee.object,{name:'Object'})||!t.isIdentifier(initializer.callee.property,{name:'freeze'})||
        initializer.arguments.length!==1||!t.isObjectExpression(initializer.arguments[0]))
        throw path.buildCodeFrameError('Namespace linker binding table changed');
      const members=initializer.arguments[0].properties,readers=[];
      for(const member of members){
        if(t.isObjectProperty(member)&&!member.computed&&t.isIdentifier(member.key,{name:'__proto__'})&&t.isNullLiteral(member.value))continue;
        if(member.computed&&!t.isStringLiteral(member.key)&&!t.isNumericLiteral(member.key))throw path.buildCodeFrameError('Namespace linker emitted a nonliteral export name');
        const name=t.isIdentifier(member.key)?member.key.name:t.isNumericLiteral(member.key)?String(member.key.value):member.key.value;
        if(typeof name!=='string')throw path.buildCodeFrameError('Namespace export name is not a string');
        let reader;
        if(t.isObjectProperty(member))reader=t.arrowFunctionExpression([],member.value);
        else if(t.isObjectMethod(member)&&member.kind==='get'&&!member.params.length)reader=t.arrowFunctionExpression([],member.body);
        else throw path.buildCodeFrameError('Namespace linker emitted an unsupported binding');
        // Computed keys preserve __proto__ as an ordinary export name.
        readers.push(t.objectProperty(t.stringLiteral(name),reader,true));
      }
      path.node.init=operation('moduleNamespace',[t.objectExpression(readers)]);
    }
  }}};
}
