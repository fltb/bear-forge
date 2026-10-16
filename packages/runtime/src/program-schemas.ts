import { keys } from '@bear-forge/boundary';
import { types } from 'node:util';

const nativeInspection = {getPrototypeOf:Object.getPrototypeOf,getOwnPropertyDescriptor:Object.getOwnPropertyDescriptor,ownKeys:Reflect.ownKeys};
function hasDataFields(value: unknown, names: readonly string[], inspection = nativeInspection): boolean {
  if (value === null || typeof value !== 'object' || types.isProxy(value)) return false;
  const prototype = inspection.getPrototypeOf(value);
  if (prototype !== null && (types.isProxy(prototype) || inspection.getPrototypeOf(prototype) !== null)) return false;
  return names.every(name => {
    const descriptor = inspection.getOwnPropertyDescriptor(value, name);
    return descriptor !== undefined && descriptor.enumerable && 'value' in descriptor;
  });
}

/** Extra author-owned state is permitted; only Core's fields are inspected. */
export function assertProgramModuleShape(value: unknown, inspection = nativeInspection): asserts value is { schemas: unknown; run: Function } {
  if (!hasDataFields(value, ['schemas', 'run'], inspection)
    || typeof inspection.getOwnPropertyDescriptor(value, 'run')!.value !== 'function') throw new TypeError('Invalid ProgramModule');
}

/** Check declaration tables before reading any author-owned schema field. */
export function assertProgramSchemasShape(value: unknown, inspection = nativeInspection): asserts value is {
  setup: unknown;
  result: unknown;
  ports: Record<string, { input: unknown; output: unknown }>;
} {
  if (!hasDataFields(value, ['setup', 'result', 'ports'], inspection)) throw new TypeError('Invalid ProgramSchemas table');
  const ports = inspection.getOwnPropertyDescriptor(value, 'ports')!.value;
  for (const name of keys(ports, inspection)) {
    const declaration = inspection.getOwnPropertyDescriptor(ports, name)!.value;
    const names = keys(declaration, inspection);
    if (!names.includes('input') || !names.includes('output')) throw new TypeError('Invalid port schema declaration');
  }
}
