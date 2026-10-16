import {createRequire} from 'node:module';
const t=createRequire(import.meta.url)('@babel/types');

/** Route every free ESM global binding through the owning Instance. This pass
 * runs on admitted source before helpers or module linking introduce bindings. */
export function ambientBindings(){
  const operation=(name:string,args:any[])=>t.callExpression(t.memberExpression(
    t.identifier('__bearOps'),t.identifier(name)),args);
  const reference=(name:string)=>operation('globalReference',[t.stringLiteral(name)]);
  const target=(name:string)=>t.memberExpression(operation('globalTarget',[reference(name)]),t.identifier('value'));
  // The instance global object is the capability whitelist. Preserve ordinary
  // unresolved-reference semantics: typeof missing is "undefined", while a
  // direct read or write throws instead of reaching the Node global object.
  // The first pass sees author syntax only. __bearOps is introduced by this
  // pass, while arguments is an implicit function binding in ECMAScript.
  const internal=new Set(['arguments','__bearOps']);
  const free=(path:any)=>!internal.has(path.node.name)&&
    !path.parentPath?.isExportSpecifier()&&!path.parentPath?.isImportSpecifier()&&
    !path.parentPath?.isImportDefaultSpecifier()&&!path.parentPath?.isImportNamespaceSpecifier()&&
    !path.scope.getBinding(path.node.name);
  const assignmentTarget=(path:any):void=>{
    if(path.isIdentifier()){
      if(free(path))path.replaceWith(target(path.node.name));
      return;
    }
    if(path.isAssignmentPattern()){assignmentTarget(path.get('left'));return;}
    if(path.isRestElement()){assignmentTarget(path.get('argument'));return;}
    if(path.isArrayPattern())for(const element of path.get('elements'))if(element.node)assignmentTarget(element);
    if(path.isObjectPattern())for(const property of path.get('properties')){
      if(property.isRestElement())assignmentTarget(property.get('argument'));
      else assignmentTarget(property.get('value'));
    }
  };
  return {visitor:{
    Program:{exit(path:any){
      // Admission accepts unknown names so ordinary ESM ReferenceError/typeof
      // semantics remain available. Every such source reference must have been
      // routed through the Instance before module linking can add bindings.
      path.traverse({ReferencedIdentifier(reference:any){
        if(internal.has(reference.node.name)||reference.scope.getBinding(reference.node.name))return;
        throw reference.buildCodeFrameError('Unlowered instance global '+reference.node.name);
      }});
    }},
    AssignmentExpression(path:any){assignmentTarget(path.get('left'));},
    UpdateExpression(path:any){assignmentTarget(path.get('argument'));},
    ForInStatement(path:any){if(!path.get('left').isVariableDeclaration())assignmentTarget(path.get('left'));},
    ForOfStatement(path:any){if(!path.get('left').isVariableDeclaration())assignmentTarget(path.get('left'));},
    UnaryExpression(path:any){
      if(path.node.operator!=='typeof')return;
      const argument=path.get('argument');
      if(argument.isIdentifier()&&free(argument))path.replaceWith(operation('globalTypeof',[reference(argument.node.name)]));
    },
    ReferencedIdentifier(path:any){
      if(!free(path))return;
      path.replaceWith(operation('globalRead',[t.stringLiteral(path.node.name)]));
    }
  }};
}
