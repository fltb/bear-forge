import {createRequire} from 'node:module';
const t=createRequire(import.meta.url)('@babel/types');
const op=(name:string,args:any[])=>t.callExpression(t.memberExpression(t.identifier('__bearOps'),t.identifier(name)),args);

/** Preserve the source binding name before a binding assignment becomes a
 * property target. Class static initialization can observe this name even when
 * the subsequent immutable write throws. */
export function preserveAssignmentName(node:any):void{
  const binding=t.isVariableDeclarator(node)?node.id:node.left;
  if(!t.isIdentifier(binding)||!t.isVariableDeclarator(node)&&!t.isAssignmentPattern(node)&&
    !(t.isAssignmentExpression(node)&&['=','&&=','||=','??='].includes(node.operator)))return;
  const value=t.isVariableDeclarator(node)?node.init:node.right;
  if((t.isFunctionExpression(value)||t.isArrowFunctionExpression(value)||t.isClassExpression(value))&&!value.id)
    value.extra={...value.extra,bearInferredName:binding.name};
}

/** Rollup treats writes to imported bindings as build errors. Native ESM
 * instead evaluates the expression and throws at PutValue. Explicit accessor
 * references preserve that point, including destructuring and suspended RHSs.
 * Accessors are ordinary compiled code, with no host callbacks or hidden state. */
export function importWrites(){
  function imported(path:any,name:string):any{
    const binding=path.scope.getBinding(name);
    return binding?.kind==='module'&&binding.path.isImportSpecifier()||
      binding?.kind==='module'&&binding.path.isImportDefaultSpecifier()||
      binding?.kind==='module'&&binding.path.isImportNamespaceSpecifier()?binding:undefined;
  }
  function reference(identifier:any,write:boolean):any{
    const methods=[t.objectMethod('get',t.identifier('value'),[],t.blockStatement([t.returnStatement(t.cloneNode(identifier))]))];
    if(write){
      const value=t.identifier('value');
      methods.push(t.objectMethod('set',t.identifier('value'),[value],t.blockStatement([
        t.expressionStatement(op('immutableWrite',[t.cloneNode(value),t.booleanLiteral(true)])),
      ])));
    }
    return t.memberExpression(t.objectExpression(methods),t.identifier('value'));
  }
  function target(node:any,path:any):any{
    if(t.isIdentifier(node))return imported(path,node.name)?reference(node,true):node;
    if(t.isMemberExpression(node)){
      if(t.isIdentifier(node.object)&&imported(path,node.object.name)?.path.isImportNamespaceSpecifier())
        node.object=reference(node.object,false);
      return node;
    }
    if(t.isArrayPattern(node)){node.elements=node.elements.map((item:any)=>item&&target(item,path));return node;}
    if(t.isObjectPattern(node)){
      for(const item of node.properties){
        if(t.isRestElement(item))item.argument=target(item.argument,path);
        else{item.value=target(item.value,path);item.shorthand=false;}
      }
      return node;
    }
    if(t.isRestElement(node)){node.argument=target(node.argument,path);return node;}
    if(t.isAssignmentPattern(node)){node.left=target(node.left,path);return node;}
    return node;
  }
  return {visitor:{
    AssignmentExpression:{exit(path:any){
      path.node.left=target(path.node.left,path);
    }},
    UpdateExpression:{exit(path:any){path.node.argument=target(path.node.argument,path);}},
    ForXStatement:{exit(path:any){if(!t.isVariableDeclaration(path.node.left))path.node.left=target(path.node.left,path);}},
    UnaryExpression:{exit(path:any){if(path.node.operator==='delete')path.node.argument=target(path.node.argument,path);}},
  }};
}
