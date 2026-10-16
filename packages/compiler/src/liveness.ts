import { createRequire } from 'node:module';
const t = createRequire(import.meta.url)('@babel/types');

type Flow = { edges: Set<number>; slots: Set<number>; states: Set<number>; unknown: boolean };

/** Whether a statement may reach its lexical successor. Unknown statements
 * conservatively fall through; no value/condition evaluation is attempted. */
function fallsThrough(node: any): boolean {
  if (t.isReturnStatement(node) || t.isThrowStatement(node) || t.isContinueStatement(node) || t.isBreakStatement(node)) return false;
  if (t.isBlockStatement(node)) return node.body.every(fallsThrough);
  if (t.isIfStatement(node)) return fallsThrough(node.consequent) || !node.alternate || fallsThrough(node.alternate);
  return true;
}

/** Release only values unread on every continuation, exception and return path.
 * Captured cells remain intact. Scope-changing handlers are kept conservatively;
 * unknown transitions disable release only at boundaries that can reach them. */
export function releaseDeadLocals(registration: any, depth: number, stateDepths: number[], protectedSlots: Set<number>) {
  const args = registration.node.arguments;
  if (!depth || args[8].value & 16 || stateDepths.some(d => d !== depth)) return;
  const handler = registration.get('arguments.9');
  if (!handler.isFunctionExpression()) return;
  const [frame, vars, parameter] = handler.node.params.map((p: any) => p.name);
  let machine: any, unsafe = false;
  handler.traverse({noScope:true,
    SwitchStatement(path: any) { if (machine) unsafe = true; else machine = path; },
    AssignmentExpression(path: any) {
      const {left} = path.node;
      if (t.isMemberExpression(left) && t.isIdentifier(left.object, {name: frame}) && t.isIdentifier(left.property, {name: '$'})) unsafe = true;
    }
  });
  if (unsafe || !machine) return;
  const cases = machine.get('cases').filter((p: any) => t.isNumericLiteral(p.node.test));
  function inspect(branch: any, frameName: string, varsName: string): Flow {
    const flow: Flow = {edges: new Set(), slots: new Set(), states: new Set(), unknown: false};
    branch.traverse({noScope:true,
      Function() { flow.unknown = true; },
      MemberExpression(path: any) {
        const n = path.node;
        if (!t.isIdentifier(n.object, {name: varsName})) return;
        if (n.computed && t.isNumericLiteral(n.property) && n.property.value >= 0) {
          // Slot zero links the enclosing environment; this pass never clears it.
          if (n.property.value > 0) flow.slots.add(n.property.value);
        } else flow.unknown = true;
      },
      AssignmentExpression(path: any) {
        const {left, right} = path.node;
        if (!t.isMemberExpression(left) || !t.isIdentifier(left.object, {name: frameName})) return;
        if (t.isIdentifier(left.property, {name: '$'})) flow.unknown = true;
        if (t.isIdentifier(left.property, {name: 'goto'}) || t.isIdentifier(left.property, {name: 'state'})) {
          if (!t.isNumericLiteral(right)) flow.unknown = true;
          else (left.property.name === 'goto' ? flow.edges : flow.states).add(right.value);
        }
      }
    });
    return flow;
  }
  const merge = (into: Flow, from: Flow) => {
    for (const edge of from.edges) into.edges.add(edge);
    for (const slot of from.slots) into.slots.add(slot);
    for (const state of from.states) into.states.add(state);
    into.unknown ||= from.unknown;
  };
  const dispatches: ((state: number) => Flow)[] = [];
  for (const index of [10, 11]) {
    const dispatch = registration.get(`arguments.${index}`);
    if (dispatch.isNullLiteral()) continue;
    if (!dispatch.isFunctionExpression()) return;
    const body = dispatch.get('body.body');
    if (body.length !== 1 || !body[0].isSwitchStatement()) return;
    const [dispatchFrame, dispatchVars] = dispatch.node.params.map((p: any) => p.name);
    const selector = body[0].node.discriminant;
    if (!t.isMemberExpression(selector) || !t.isIdentifier(selector.object, {name: dispatchFrame}) || !t.isIdentifier(selector.property, {name: 'state'})) return;
    const branches = body[0].get('cases'), table = new Map<number, Flow>();
    let fallback: Flow | undefined, next: Flow | undefined;
    for (let i = branches.length - 1; i >= 0; i--) {
      const branch = branches[i], flow = inspect(branch, dispatchFrame, dispatchVars);
      if (next && branch.node.consequent.every(fallsThrough)) merge(flow, next);
      if (branch.node.test === null) fallback = flow;
      else if (t.isNumericLiteral(branch.node.test)) table.set(branch.node.test.value, flow);
      else return;
      next = flow;
    }
    // Missing dispatch coverage is not evidence that an abrupt path terminates.
    dispatches.push(state => table.get(state) ?? fallback ?? {edges: new Set(), slots: new Set(), states: new Set(), unknown: true});
  }
  const graph = new Map<number, Flow>();
  for (let i = 0; i < cases.length; i++) {
    const branch = cases[i], flow = inspect(branch, frame, vars);
    if (i + 1 < cases.length && branch.node.consequent.every(fallsThrough)) flow.edges.add(cases[i + 1].node.test.value);
    flow.states.add(branch.node.test.value);
    // A throw or external return can enter the dispatcher at any state reached
    // inside this case, including generated fall-through state assignments.
    for (const state of [...flow.states]) for (const dispatch of dispatches) merge(flow, dispatch(state));
    graph.set(branch.node.test.value, flow);
  }
  // Direct synchronous helpers let the state machine keep an await inside an
  // if branch. Follow only the lexical path to that await when selecting its
  // exception state; a sibling branch's state assignments have not executed.
  function awaitStates(last: any, branch: any): Set<number> | undefined {
    const ancestors = [];
    for (let path = last; path !== branch; path = path.parentPath) ancestors.push(path);
    let states = new Set<number>([branch.node.test.value]);
    const advance = (path: any) => {
      const node = path.node;
      const expression = t.isExpressionStatement(node) ? node.expression : node;
      if (t.isAssignmentExpression(expression) && t.isMemberExpression(expression.left)
        && t.isIdentifier(expression.left.object, {name: frame})
        && t.isIdentifier(expression.left.property, {name: 'state'})) {
        if (!t.isNumericLiteral(expression.right)) return false;
        states = new Set([expression.right.value]);
        return true;
      }
      const flow = inspect(path, frame, vars);
      if (flow.unknown) return false;
      for (const state of flow.states) states.add(state);
      return true;
    };
    for (const child of ancestors.reverse()) {
      const parent = child.parentPath;
      if (parent.isSwitchCase() || parent.isBlockStatement()) {
        const siblings = parent.get(parent.isSwitchCase() ? 'consequent' : 'body');
        for (const sibling of siblings) {if (sibling === child) break; if (!advance(sibling)) return undefined;}
      } else if (parent.isIfStatement()) {if (!advance(parent.get('test'))) return undefined;}
      else return undefined;
    }
    return states;
  }
  for (const branch of cases) {
    const awaits: any[] = [];
    branch.traverse({noScope:true, Function(path: any) {path.skip();}, ReturnStatement(path: any) {awaits.push(path);}});
    for (const last of awaits) {
      const previous = last.getPrevSibling()?.node;
      const call = last?.node.argument;
      if (!last?.isReturnStatement() || !t.isCallExpression(call) || !t.isIdentifier(call.callee, {name: frame + 'awt'}) || call.arguments.length !== 1 || !t.isIdentifier(call.arguments[0], {name: parameter})) continue;
      if (!t.isExpressionStatement(previous) || !t.isAssignmentExpression(previous.expression)) continue;
      const {left, right} = previous.expression;
      if (!t.isMemberExpression(left) || !t.isIdentifier(left.object, {name: frame}) || !t.isIdentifier(left.property, {name: 'goto'}) || !t.isNumericLiteral(right)) continue;
      const live = new Set(protectedSlots), seen = new Set<number>(), pending = [right.value];
      let unknown = false;
      // Await rejection uses the suspended state's exception route, whereas normal
      // fulfillment enters goto. Its catch/finally reads must survive too.
      const suspendedStates = awaitStates(last, branch);
      if (!suspendedStates) continue;
      for (const state of suspendedStates) for (const dispatch of dispatches) {
        const flow = dispatch(state);
        for (const slot of flow.slots) live.add(slot);
        pending.push(...flow.edges);
        unknown ||= flow.unknown;
      }
      while (!unknown && pending.length) {
        const state = pending.pop()!;
        if (seen.has(state)) continue;
        seen.add(state);
        const node = graph.get(state);
        if (!node || node.unknown) { unknown = true; break; }
        for (const slot of node.slots) live.add(slot);
        pending.push(...node.edges);
      }
      if (unknown) continue;
      const clears = [];
      for (let slot = 1; slot < args[6].value; slot++) {
        if (!live.has(slot)) clears.push(t.expressionStatement(t.assignmentExpression('=', t.memberExpression(t.identifier(vars), t.numericLiteral(slot), true), t.unaryExpression('void', t.numericLiteral(0)))));
      }
      last.insertBefore(clears);
    }
  }
}
