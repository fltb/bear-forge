import {cardDefinition} from './card.ts';
import {contract as baseContract} from './contract.ts';
import {z} from 'zod';
export const contract: typeof baseContract = { ...baseContract,
  schemas: { ...baseContract.schemas, view: cardDefinition.schemas.ports.decision.input,
    observation: z.compile(baseContract.schemas.observation), event: z.compile(baseContract.schemas.event), playerEvent: z.compile(baseContract.schemas.playerEvent) },
  inputs: { action: { ...baseContract.inputs.action, options: z.compile(baseContract.inputs.action.options) } },
};
export const game={definition:cardDefinition,contract};
export {legalActions,prepareAction,prepareControl,observe} from './contract.ts';
