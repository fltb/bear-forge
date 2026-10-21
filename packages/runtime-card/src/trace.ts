import type { CardTrace } from '@bear-forge/card-engine';
import type { TracePosition } from '../../card-engine/src/card-trace.ts';
import { Records } from '../../runtime/src/records.ts';

export type TraceLayout = { positions: readonly TracePosition[]; offsets: readonly number[] };
type SavedTrace = { positions: number[]; depths: number[] };
/** Program metadata stays shared; the Context log stores only two numbers per
 * instruction. The existing DTO is materialized only for public readers. */
export class CardTraceRecords {
  private positions = new Records<number>();
  private depths = new Records<number>();
  readonly layout:TraceLayout;
  constructor(layout:TraceLayout) {this.layout=layout;}
  push(position: TracePosition, depth: number): void {
    this.positions.push(this.layout.offsets[position.block]! + position.index);
    this.depths.push(depth);
  }
  snapshot(): SavedTrace {
    return { positions: this.positions.slice(), depths: this.depths.slice() };
  }
  restore(saved: unknown): void {
    if (!saved || typeof saved !== 'object') throw Error('Invalid saved Core trace');
    const { positions, depths } = saved as Partial<SavedTrace>;
    if (!Array.isArray(positions) || !Array.isArray(depths) || positions.length !== depths.length) throw Error('Invalid saved Core trace');
    const nextPositions = new Records<number>(), nextDepths = new Records<number>();
    for (let index = 0; index < positions.length; index++) {
      const position = positions[index]!, depth = depths[index]!;
      if (!Number.isSafeInteger(position) || position < 0 || position >= this.layout.positions.length || !Number.isSafeInteger(depth) || depth < 1) throw Error('Invalid saved Core trace position');
      nextPositions.push(position); nextDepths.push(depth);
    }
    this.positions = nextPositions; this.depths = nextDepths;
  }
  fork(): CardTraceRecords {
    const result = new CardTraceRecords(this.layout);
    result.positions = this.positions.fork(); result.depths = this.depths.fork(); return result;
  }
  slice(): CardTrace[] {
    const positions = this.positions.slice(), depths = this.depths.slice();
    return positions.map((position, index) => ({ ...this.layout.positions[position]!, depth: depths[index]! }));
  }
}
