import {createRequire} from 'node:module';
const t=createRequire(import.meta.url)('@babel/types');
const hostMetadataFields=Reflect.ownKeys(import.meta).filter((key):key is string=>{
  if(typeof key!=='string')throw new TypeError('Unsupported symbolic host module metadata');
  return key!=='url';
});

/** One lazily allocated metadata object per source module. The binding and
 * object belong to the module activation; its initial URL is compiled data.
 * Laziness allows a hoisted export to read metadata in a dependency cycle
 * before evaluation reaches this module's declarations. */
export function moduleMeta(url:string){
  return {visitor:{Program(program:any){
    const references:any[]=[];
    program.traverse({MetaProperty(path:any){
      if(path.node.meta.name==='import'&&path.node.property.name==='meta')references.push(path);
    }});
    if(!references.length)return;
    const value=program.scope.generateUidIdentifier('moduleMeta');
    const read=program.scope.generateUidIdentifier('readModuleMeta');
    // Node supplies these fields from the host module loader. They are not
    // program state and cannot be silently synthesized as undefined. A write
    // installs an ordinary own data property, so program-owned overrides stay
    // within the Instance and remain copyable.
    const externalFields=hostMetadataFields.flatMap(key=>{
      const field=t.identifier(key),assigned=t.identifier('assigned');
      return [
        t.objectMethod('get',t.cloneNode(field),[],t.blockStatement([
          t.throwStatement(t.newExpression(t.identifier('TypeError'),[
            t.stringLiteral('Undeclared host metadata import.meta.'+key)
          ]))
        ])),
        t.objectMethod('set',t.cloneNode(field),[t.cloneNode(assigned)],t.blockStatement([
          t.expressionStatement(t.callExpression(t.memberExpression(t.identifier('Object'),t.identifier('defineProperty')),[
            t.thisExpression(),t.stringLiteral(key),t.objectExpression([
              t.objectProperty(t.identifier('value'),t.cloneNode(assigned)),
              t.objectProperty(t.identifier('writable'),t.booleanLiteral(true)),
              t.objectProperty(t.identifier('enumerable'),t.booleanLiteral(true)),
              t.objectProperty(t.identifier('configurable'),t.booleanLiteral(true))
            ])
          ]))
        ]))
      ];
    });
    for(const path of references)path.replaceWith(t.callExpression(t.cloneNode(read),[]));
    program.unshiftContainer('body',[
      t.variableDeclaration('var',[t.variableDeclarator(t.cloneNode(value))]),
      t.functionDeclaration(t.cloneNode(read),[],t.blockStatement([
        t.returnStatement(t.logicalExpression('||',t.cloneNode(value),t.assignmentExpression('=',t.cloneNode(value),
          t.objectExpression([
            t.objectProperty(t.identifier('__proto__'),t.nullLiteral()),
            ...externalFields,
            t.objectProperty(t.identifier('url'),t.stringLiteral(url))
          ]))))
      ]))
    ]);
    program.scope.crawl();
  }}};
}
