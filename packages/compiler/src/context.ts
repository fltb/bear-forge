import { transformSync } from '@babel/core';

/** Export namespace data is only a continuation root if author code can use it
 * after initialization. A computed/escaping namespace conservatively retains all. */
export function namespaceUsage(source: string): string[] | null {
  const keys = new Set<string>();
  let all = false;
  transformSync(source, { sourceType: 'module', parserOpts:{allowAwaitOutsideFunction:true}, configFile: false, babelrc: false, code: false, plugins: [() => ({visitor: {
    ReferencedIdentifier(path: any) {
      const name=path.node.name,binding=path.scope.getBinding(name);
      if (!['module', 'exports'].includes(name) || binding || !path.getFunctionParent()) return;
      let base = path;
      if (path.node.name === 'module') {
        const parent = path.parentPath;
        if (!parent.isMemberExpression() || parent.node.object !== path.node || (parent.node.computed ? parent.node.property.value : parent.node.property.name) !== 'exports') { all = true; return; }
        base = parent;
      }
      const member = base.parentPath;
      if (!member.isMemberExpression() || member.node.object !== base.node) { all = true; return; }
      const key = member.node.computed ? member.node.property.type === 'StringLiteral' ? member.node.property.value : null : member.node.property.name;
      if (key === null) all = true; else keys.add(key);
    }
  }})] });
  return all ? null : [...keys].sort();
}
