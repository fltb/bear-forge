import {z} from 'zod';
export const RecordCursorSchema=z.number().safe().nonnegative();
export const RecordReadSchema=z.strictObject({after:RecordCursorSchema.nullable(),limit:z.number().safe().positive()});
