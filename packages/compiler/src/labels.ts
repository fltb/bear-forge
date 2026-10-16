import { transformSync } from '@babel/core';

/** Consecutive labels name the same statement. Canonicalize those aliases
 * before bundling; references in nested functions belong to separate scopes. */
export function normalizeLabels(source: string, filename: string): string {
  let changed = false;
  const result = transformSync(source, {
    filename, sourceType: 'module', configFile: false, babelrc: false,
    parserOpts: { plugins: ['typescript'] },
    sourceMaps: 'inline',
    plugins: [() => ({ visitor: {
      LabeledStatement(path: any) {
        if (!path.get('body').isLabeledStatement()) return;
        const canonical = path.node.label.name;
        const aliases = new Set<string>();
        let statement = path.node;
        while (statement.type === 'LabeledStatement') {
          aliases.add(statement.label.name);
          statement = statement.body;
        }
        path.traverse({
          Function(inner: any) { inner.skip(); },
          'BreakStatement|ContinueStatement'(jump: any) {
            if (jump.node.label && aliases.has(jump.node.label.name)) jump.node.label.name = canonical;
          }
        });
        path.node.body = statement;
        changed = true;
      }
    } })]
  });
  if (typeof result?.code !== 'string') throw new Error('Label normalization produced no source');
  return changed ? result.code : source;
}
