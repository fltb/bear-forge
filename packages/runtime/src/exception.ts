import { types } from 'node:util';

const errorNames = new Map<object, string>([
  [Error.prototype, 'Error'], [TypeError.prototype, 'TypeError'],
  [RangeError.prototype, 'RangeError'], [SyntaxError.prototype, 'SyntaxError'],
  [ReferenceError.prototype, 'ReferenceError'], [EvalError.prototype, 'EvalError'],
  [URIError.prototype, 'URIError'], [AggregateError.prototype, 'AggregateError']
]);

/** Diagnostics must not invoke a thrown value's coercion, getters or proxy
 * traps. Native Error branding is internal-slot based; descriptor reads on
 * those actual objects cannot invoke an author accessor. Other objects remain
 * opaque. Never read stack: its lazy formatter can execute application code. */
export function exceptionMessage(value: unknown, inspection: Pick<ObjectConstructor,'getOwnPropertyDescriptor'|'getPrototypeOf'> = Object): string {
  if (value === null || typeof value !== 'object' && typeof value !== 'function') return String(value);
  if (types.isProxy(value) || !types.isNativeError(value)) return typeof value === 'function' ? 'Thrown function' : 'Thrown object';
  const nameProperty = inspection.getOwnPropertyDescriptor(value, 'name');
  const messageProperty = inspection.getOwnPropertyDescriptor(value, 'message');
  const prototype = inspection.getPrototypeOf(value);
  const prototypeName = prototype && !types.isProxy(prototype) && inspection.getOwnPropertyDescriptor(prototype, 'name');
  const name = nameProperty && 'value' in nameProperty && typeof nameProperty.value === 'string'
    ? nameProperty.value : errorNames.get(prototype) ?? (prototypeName && 'value' in prototypeName && typeof prototypeName.value === 'string' ? prototypeName.value : 'Error');
  const message = messageProperty && 'value' in messageProperty && typeof messageProperty.value === 'string'
    ? messageProperty.value : '';
  return name === '' ? message : message === '' ? name : `${name}: ${message}`;
}
