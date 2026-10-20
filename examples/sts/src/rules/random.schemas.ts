import {z} from 'zod';
export const unsigned64=z.bigint().min(0n).max(0xffffffffffffffffn);
export const signed64=z.bigint().min(-0x8000000000000000n).max(0x7fffffffffffffffn);
export const randomStateSchema=z.object({counter:z.int32().nonnegative(),seed0:unsigned64,seed1:unsigned64}).strict();
export const randomViewSchema=z.object({counter:z.int32().nonnegative(),seed0:z.string(),seed1:z.string()});
