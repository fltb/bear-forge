import type {PortBindings} from '@bear-forge/contracts/instance';
import type {ProgramSchemas} from '@bear-forge/contracts/core';
import type {GameContract,GamePortDeclarations,GameSDK} from '@bear-forge/contracts/authoring';

type Empty={setup:null;ports:{};programResult:null;view:null;actions:{};player:'a';observation:null;event:null;playerEvent:null;result:null;control:never};
type C=GameContract<Empty>;
const valid:[PortBindings<{}>,ProgramSchemas<null,{},null>['ports'],GamePortDeclarations<{}>,GameSDK<{}>,C['ports'],C['schemas']['actions'],C['inputs']]=[{},{},{},{},{},{},{}];
void valid;
// @ts-expect-error empty bindings are a table, not the TS non-nullish {} type
const scalar:PortBindings<{}>=123;
// @ts-expect-error even variables with undeclared keys must be rejected
const foreign:PortBindings<{}>={undeclared:async()=>({kind:'reply',value:1})};
// @ts-expect-error empty schema tables reject undeclared ports
const schemas:ProgramSchemas<null,{},null>['ports']={extra:{}};
// @ts-expect-error empty game declarations reject undeclared ports
const declarations:GamePortDeclarations<{}>={extra:{}};
// @ts-expect-error no method is available in an empty SDK
const sdk:GameSDK<{}>={extra:async()=>null};
// @ts-expect-error no undeclared adapter
const adapters:C['ports']={extra:{}};
// @ts-expect-error no undeclared action schema
const actions:C['schemas']['actions']={extra:{}};
// @ts-expect-error no undeclared input description
const inputs:C['inputs']={extra:{}};
// @ts-expect-error symbols cannot bypass an empty table
const symbol:PortBindings<{}>={[Symbol()]:null};
// @ts-expect-error arrays cannot stand in for a fixed empty table
const array:PortBindings<{}>=[];
void [scalar,foreign,schemas,declarations,sdk,adapters,actions,inputs,symbol,array];
