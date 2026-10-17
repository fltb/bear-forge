import { copy } from '@bear-forge/boundary';
import { Records } from './records.ts';
import { RecordReadSchema } from '@bear-forge/contracts/capture';
import type { InstanceCapture, InstanceRecord } from '@bear-forge/contracts/capture';
import type { PortShape } from '@bear-forge/contracts/core';
import type { Controller } from './instance.ts';
import { ok, fail } from './instance.ts';
export function createCapture<S, P extends { [K in keyof P]: PortShape }, R>(controllers: Map<string, Controller<S, P, R>>,
  // Provider construction only: card snapshots may physically share private
  // leaves across boundaries while each public record retains its own graph.
  copyRecords: (records: InstanceRecord<S, P, R>[]) => InstanceRecord<S, P, R>[] = copy
): InstanceCapture<S, P, R> {
  const released = new Set<string>();
  return {
    async read(id, input) {
      const controller = controllers.get(id);
      if (!controller?.records) return fail('records_not_found');
      let args;
      try {
        args = RecordReadSchema.parse(input);
      } catch {
        return fail('invalid_argument');
      }
      if (args.after !== null && args.after >= controller.records.length) return fail('invalid_argument');
      const from = (args.after ?? -1) + 1,
        result = controller.records.slice(from, from + args.limit);
      return ok({
        records: copyRecords(result),
        next: from + result.length < controller.records.length ? result.at(-1)!.sequence : null
      });
    },
    async release(id) {
      if (released.has(id)) return ok(undefined);
      const controller = controllers.get(id);
      if (!controller?.records) return fail('records_not_found');
      if (!controller.closed) return fail('instance_busy');
      controllers.delete(id);
      controller.records = new Records();
      released.add(id);
      return ok(undefined);
    }
  };
}
