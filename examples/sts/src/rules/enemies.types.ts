import type {rules} from '@bear-forge/card-engine';
export type EnemySetup={actor:number;battle:number;aiRng:number;ascension:number;slot?:number|undefined;hpRng?:number|undefined;parameters?:number[]|undefined;deferInitialRoll?:boolean|undefined};
export type EnemyHealth={minimum:number;maximum:number;draw:boolean;discard:{minimum:number;maximum:number}[];parameters:{minimum:number;maximum:number}[]};
export type EnemyState=EnemySetup&{history:[number,number];opportunityTurn:number;claimed:boolean;prepared:boolean;escaped:boolean;halfDead:boolean};
export type EnemyIntent={attack:boolean;damage:number;hits:number};
export type EnemyAction={enemy:number;actor:number;battle:number;turn:number;move:number;attack:boolean};
export type EnemyRoll={enemy:number;roll:number};
export type EnemyConfig={
  metadata?:{id:number;name:string}|undefined;
  health?:rules.Query<number,EnemyHealth>|undefined;
  presentation?:rules.Query<number,Record<string,number|boolean>>|undefined;
  intent:rules.Query<number,EnemyIntent>;
  choose:rules.Effect<EnemyRoll,number>;
  act:rules.Effect<EnemyAction,void>;
  initialize?:rules.Effect<rules.EntityLifecycle<EnemySetup>,void>|undefined;
};
export type EnemyDefinition=rules.EntityDefinition<EnemyConfig,EnemySetup>;
