import { createResolution, invoke } from '@bear-forge/card-engine';
import {gameEffect} from './effects.ts';
import {create} from '../../src/rules.ts';
import {SetupSchema,StateSchema,gamePorts} from '../../src/forge.schemas.ts';
import {contract} from '../../src/contract.ts';
import type {GameModule} from '@bear-forge/contracts/authoring';
import type {Types} from '../../src/game.types.ts';
export const game:GameModule<Types>={program:{schemas:{setup:SetupSchema,result:StateSchema,ports:gamePorts},run:async function runGame(setup,io){return await invoke(createResolution(create(setup),io),gameEffect,undefined);}},contract};
export const program=game.program;
