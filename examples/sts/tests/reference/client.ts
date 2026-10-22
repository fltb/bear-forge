import {spawn, type ChildProcessWithoutNullStreams} from 'node:child_process';
import {createInterface} from 'node:readline';
import {buildReference} from './build.ts';

export type RefCard = {id:string; misc?:number; upgraded:boolean; uniqueId?:number; cost?:number; costForTurn?:number; specialData?:number};
export type RefAction = {bits:number;description:string;type:number;index?:number;index2?:number;potion?:boolean;source?:number;target?:number};
export type ReferenceState = {
  game:{seed:string;ascension:number;act:number;floor:number;screen:string;outcome:number;room:string;event:number;
    hp:number;maxHp:number;gold:number;x:number;y:number;keys:{red:boolean;green:boolean;blue:boolean};deck:RefCard[];
    map:{burningEliteX:number;burningEliteY:number;nodes:{x:number;y:number;room:string;edges:number[];parents:number[]}[]};
    [key:string]:any};
  battle:null|{turn:number;encounter:number;input:number;outcome:number;player:{hp:number;energy:number;block:number;[key:string]:any};
    cards:{hand:RefCard[];draw:RefCard[];discard:RefCard[];exhaust:RefCard[];[key:string]:any};monsters:any[];[key:string]:any};
  actions:RefAction[];heartDefeated:boolean;decisions:number;
};
type Pending = {resolve:(value:any)=>void;reject:(error:Error)=>void;timer:NodeJS.Timeout};
export class ReferenceClient {
  readonly process:ChildProcessWithoutNullStreams;
  private pending:Pending[]=[];
  private errorText='';
  private dead:Error|null=null;
  private readonly closed:Promise<void>;
  constructor(binary:string) {
    this.process=spawn(binary,[],{stdio:'pipe'});
    // Install before any request: a child may exit while its reply is resolving.
    this.closed=new Promise(resolve=>this.process.once('close',()=>resolve()));
    this.process.stderr.on('data',b=>{this.errorText=(this.errorText+String(b)).slice(-16384);});
    createInterface({input:this.process.stdout}).on('line',line=>{
      const p=this.pending.shift(); if(!p)return;
      clearTimeout(p.timer);
      try {const r=JSON.parse(line);if(r.ok)p.resolve(r.value);else p.reject(Error(r.error));}
      catch(e){p.reject(e instanceof Error?e:Error(String(e)));}
    });
    const fail=(e:Error)=>{this.dead=e;for(const p of this.pending.splice(0)){clearTimeout(p.timer);p.reject(e);}};
    this.process.stdin.on('error',fail);
    this.process.on('error',fail);
    this.process.on('exit',(code,signal)=>fail(Error(`Reference exited (${code ?? signal})\n${this.errorText}`)));
  }
  static async create() { return new ReferenceClient(await buildReference()); }
  call<T=ReferenceState>(request:Record<string,unknown>,timeout=120000):Promise<T> {
    if(this.dead)return Promise.reject(this.dead);
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{this.process.kill();reject(Error(`Reference timed out on ${String(request.op)}`));},timeout);
      this.pending.push({resolve,reject,timer});
      this.process.stdin.write(JSON.stringify(request)+'\n');
    });
  }
  async close() {
    if(this.process.exitCode!==null || this.process.signalCode!==null){await this.closed;return;}
    try {if(!this.dead)await this.call<null>({op:'close'});} finally {
      this.process.stdin.end();
      await this.closed;
    }
  }
}

/** Require an explicitly identified mismatch before any diagnostic game starts. */
export function requireDifftest(){
  const seed=process.env.STS_DIFF_SEED?.trim(),mismatch=process.env.STS_DIFF_MISMATCH?.trim();
  if(!seed||!/^\d+$/.test(seed)||BigInt(seed)>0xffffffffffffffffn||!mismatch)
    throw Error('Explicit difftest requires STS_DIFF_SEED (uint64) and STS_DIFF_MISMATCH describing an observed mismatch; no replay is supported');
  return {seed,mismatch};
}
