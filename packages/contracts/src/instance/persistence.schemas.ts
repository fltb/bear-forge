import {z} from 'zod';
export const InstanceSnapshotSchema=z.strictObject({snapshotId:z.uuid().brand<'InstanceSnapshotId'>()});
