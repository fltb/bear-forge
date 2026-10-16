import { createRequire } from 'node:module';
import { releaseDeadLocals } from './liveness.ts';
import { synchronousLocals } from './factories.ts';
const t = createRequire(import.meta.url)('@babel/types');

type FunctionInfo = {
  path: any;
  depth: number;
  stateDepths: number[];
  captures: Map<string, number[]>;
  writes: Map<string, number[]>;
  children: Set<string>;
  scopeTransitions: boolean;
};

/** Convert Effectful's lexical slot arrays to shared variable cells. Closures
 * receive a projection of those cells, never the parent activation record.
 * Function bodies are still ordinary generated JS, not interpreted ASTs. */
export function lexicalCaptures() {
  return {
    visitor: {
      Program: {
        enter(program: any) {
          const scopes = new Map<string, number>();
          const functions = new Map<string, FunctionInfo>();
          program.traverse({noScope:true, VariableDeclarator(path: any) {
            const { id, init } = path.node;
            if (!t.isIdentifier(id)) return;
            if (t.isArrayExpression(init) && init.elements.length === 3 && t.isNumericLiteral(init.elements[2])) {
              scopes.set(id.name, init.elements[2].value);
            }
            if (!t.isCallExpression(init) || !t.isMemberExpression(init.callee) || init.callee.property.name !== 'fun' || init.arguments.length !== 15) return;
            functions.set(id.name, { path: path.get('init'), depth: init.arguments[12].value,
              stateDepths: [], captures: new Map(), writes: new Map(), children: new Set(), scopeTransitions: false });
          }});
          const add = (info: FunctionInfo, path: number[], write = false) => {
            const key = path.join('.');
            const paths = write ? info.writes : info.captures;
            if (paths.has(key)) return false;
            paths.set(key, path); return true;
          };
          function slot(node: any, name: string): number[] | null {
            if (t.isIdentifier(node, { name })) return [];
            if (!t.isMemberExpression(node) || !node.computed || !t.isNumericLiteral(node.property)) return null;
            const parent = slot(node.object, name);
            return parent && parent.every(x => x === 0) ? [...parent, node.property.value] : null;
          }
          for (const info of functions.values()) {
            const args = info.path.node.arguments;
            for (const state of args[13].elements) {
              const scope = state.elements[2];
              const depth = t.isIdentifier(scope) ? scopes.get(scope.name) : undefined;
              info.stateDepths.push(depth ?? info.depth);
              if (t.isIdentifier(scope) && depth === undefined || depth !== undefined && depth !== info.depth)
                info.scopeTransitions = true;
            }
            for (const index of [9, 10, 11]) {
              const handler = info.path.get(`arguments.${index}`);
              if (!handler.isFunctionExpression()) continue;
              const vars = handler.node.params[1].name;
              const frame = handler.node.params[0].name;
              const changes: { path: any; delta: number; pop: boolean }[] = [];
              handler.traverse({noScope:true,AssignmentExpression(path: any) {
                const {left,right}=path.node;
                if(!t.isMemberExpression(left)||!t.isIdentifier(left.object,{name:frame})||!t.isIdentifier(left.property,{name:'$'}))return;
                if(t.isArrayExpression(right)&&t.isIdentifier(right.elements[0],{name:vars}))changes.push({path,delta:1,pop:false});
                else if(t.isMemberExpression(right)&&t.isIdentifier(right.object,{name:vars})&&t.isNumericLiteral(right.property,{value:0}))changes.push({path,delta:-1,pop:true});
              }});
              if (changes.length) info.scopeTransitions = true;
              function depthAt(path: any): number[] {
                const branch=path.findParent((p:any)=>p.isSwitchCase());
                const state=branch?.node.test;
                const base=t.isNumericLiteral(state)?info.stateDepths[state.value]??info.depth:info.depth;
                const local=changes.filter(c=>c.path.findParent((p:any)=>p.isSwitchCase())===branch);
                // Synthetic scope-pop states are labelled with their destination
                // lexical scope by Effectful. Their entry still holds its child.
                let depths=new Set([base+(local[0]?.pop?1:0)]);
                for(const c of local){
                  if(c.path.node.end>path.node.start)continue;
                  const conditional=c.path.findParent((p:any)=>p.isIfStatement()||p.isConditionalExpression());
                  const shifted=[...depths].map(d=>d+c.delta);
                  depths=new Set(conditional?[...depths,...shifted]:shifted);
                }
                return [...depths];
              }
              handler.traverse({noScope:true,
                MemberExpression(path: any) {
                  const chain = slot(path.node, vars);
                  if (!chain?.length || chain.at(-1) === 0 || info.depth === 0) return;
                  for (const depth of depthAt(path)) {
                    const target=depth-(chain.length-1);
                    if(target<info.depth){
                      const capture=[...Array(info.depth-1-target).fill(0),chain.at(-1)!];
                      add(info,capture);
                      // A slot's object can be mutated without rebinding the slot.
                      // Only assignment targets update the private Cell itself.
                      let targetPath=path;
                      while(targetPath.parentPath?.isArrayPattern() || targetPath.parentPath?.isObjectPattern() ||
                        targetPath.parentPath?.isRestElement() || targetPath.parentPath?.isObjectProperty() && targetPath.parentPath.parentPath?.isObjectPattern() ||
                        targetPath.parentPath?.isAssignmentPattern() && targetPath.key==='left')targetPath=targetPath.parentPath;
                      const parent=targetPath.parentPath;
                      if(parent?.isAssignmentExpression() && targetPath.key==='left' || parent?.isUpdateExpression() ||
                        (parent?.isForInStatement() || parent?.isForOfStatement()) && targetPath.key==='left')add(info,capture,true);
                    }
                  }
                },
                CallExpression(path: any) {
                  if (t.isIdentifier(path.node.callee) && functions.has(path.node.callee.name)) info.children.add(path.node.callee.name);
                }
              });
            }
          }
          // A closure can need a binding solely to construct a nested closure.
          // Propagate those demands to a fixed point before emitting factories.
          let changed = true;
          while (changed) {
            changed = false;
            for (const info of functions.values()) {
              if (!info.depth) continue;
              for (const name of info.children) for (const write of [false,true]) {
                const child=functions.get(name)!;
                for (const path of (write?child.writes:child.captures).values()) {
                  const target=child.depth-path.length;
                  if(target<info.depth)changed=add(info,[...Array(info.depth-1-target).fill(0),path.at(-1)!],write)||changed;
                }
              }
            }
          }
          for (const info of functions.values()) {
            const protectedSlots = new Set<number>();
            const capturedAtAnyDepth = new Set<number>();
            for (const name of info.children) for (const path of functions.get(name)!.captures.values()) {
              capturedAtAnyDepth.add(path.at(-1)!);
              if (functions.get(name)!.depth - path.length === info.depth) protectedSlots.add(path.at(-1)!);
            }
            const writtenSlots = new Set<number>();
            const writtenAtAnyDepth = new Set<number>();
            for (const name of info.children) for (const path of functions.get(name)!.writes.values()) {
              writtenAtAnyDepth.add(path.at(-1)!);
              if (functions.get(name)!.depth - path.length === info.depth) writtenSlots.add(path.at(-1)!);
            }
            // The owning synchronous invocation finishes before any external
            // snapshot. Only descendant writes can change these cells afterwards.
            // Scope transitions reuse slot numbers at multiple depths: exclude
            // every index written at any depth, even when that is conservative.
            info.path.node.bearReadonlyCapturedLocals = synchronousLocals(info.path.node.arguments[8].value)
              ? [...(info.scopeTransitions ? capturedAtAnyDepth : protectedSlots)]
                .filter(slot=>!(info.scopeTransitions ? writtenAtAnyDepth : writtenSlots).has(slot)) : [];
            releaseDeadLocals(info.path, info.depth, info.stateDepths, protectedSlots);
            // A private compiler annotation consumed by staticFactories.
            info.path.node.bearCaptures = [...info.captures.values()];
            // With no nested closure factories, no local cell can escape its
            // activation independently. Runtime may group those cell values;
            // captured ancestors still use their existing independent cells.
            info.path.node.bearUncapturedLocals = info.children.size === 0;
            // A flat activation without child factories has no escaping local
            // cell identity. Its own slots can hold values directly; ancestor
            // slots remain cells. Keep the grouped-cell representation for
            // scope transitions whose local/ancestor depth is more involved.
            const rawLocals = info.children.size === 0 && !info.scopeTransitions;
            info.path.node.bearRawLocals = rawLocals;
            // A flat function may create closures without every local escaping.
            // Use the same transitive capture set that protects live bindings;
            // only those root slots require shared cell identities.
            const capturedLocals = !info.scopeTransitions ? [...protectedSlots] : undefined;
            info.path.node.bearCapturedLocals = capturedLocals;
            const groupedLocals = info.scopeTransitions ? {cells: [...capturedAtAnyDepth], transient: synchronousLocals(info.path.node.arguments[8].value), readonly: info.path.node.bearReadonlyCapturedLocals} : undefined;
            info.path.node.bearGroupedLocals = groupedLocals;
            for (const index of [9, 10, 11]) {
              const handler = info.path.get(`arguments.${index}`);
              if (!handler.isFunctionExpression()) continue;
              const vars = handler.node.params[1].name;
              const frame = handler.node.params[0].name;
              handler.traverse({noScope:true,
                MemberExpression: { exit(path: any) {
                  const chain = slot(path.node, vars);
                  if (!chain?.length || chain.at(-1) === 0) return;
                  if (capturedLocals && chain.length === 1 && !protectedSlots.has(chain[0]!)) return;
                  path.replaceWith(t.memberExpression(path.node, t.identifier('value')));
                  path.skip();
                } },
                AssignmentExpression: { exit(path: any) {
                  const { left, right } = path.node;
                  if (!t.isMemberExpression(left) || !t.isIdentifier(left.object, { name: frame }) || !t.isIdentifier(left.property, { name: '$' }) || !t.isArrayExpression(right)) return;
                  path.node.right = t.callExpression(t.memberExpression(t.identifier('effects'), t.identifier('scope')),
                    [right,groupedLocals ? t.valueToNode(groupedLocals) : t.booleanLiteral(info.children.size === 0)]);
                } }
              });
            }
          }
        }
      }
    }
  };
}
