import {program} from './program.ts';
import {programSchemas} from '../../src/schemas.ts';
import {contract} from '../../src/contract.ts';
import type {DouDizhuModule} from '../../src/types.ts';
export const game:DouDizhuModule={program:{schemas:programSchemas,run:program},contract};
export {program};
