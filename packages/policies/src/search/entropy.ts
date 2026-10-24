import {randomInt} from '../scripts.ts';
import type {RandomCursor} from '../policy.types.ts';

/** One cursor step per full entropy word. The reversible 32-bit mixing avoids
 * exposing the short low-bit cycles of the underlying LCG to small spaces.
 * Odd multipliers and xor shifts are bijections; no word mass is discarded. */
export function searchEntropyWord(cursor:RandomCursor){
  const next=randomInt(cursor,2**32);let value=next.value;
  value=Math.imul(value^(value>>>16),0x7feb352d);
  value=Math.imul(value^(value>>>15),0x846ca68b);
  value=(value^(value>>>16))>>>0;
  return{value,random:next.random};
}
