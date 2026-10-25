import {addMass,divideMass,multiplyMass,subtractMass,unitMass,zeroMass,type ProbabilityMass} from '../../../card-engine/src/probability-mass.ts';

export type CycleState={belief:number;actions:{key:string;outcomes:{belief:number;mass:ProbabilityMass}[]}[]};
type Weight={mass:ProbabilityMass;steps:ProbabilityMass};
export type PolicyExitKernel={actions:string[];exits:{belief:number|null;mass:ProbabilityMass;steps:ProbabilityMass}[][]};
type Work={policy:bigint;pivot:number;row:number;rows:Map<number,Weight>[];exit:Map<number,Weight>|null};
export type CycleSearchSnapshot={graph:CycleState[];completed:PolicyExitKernel[];work:null|Omit<Work,'rows'|'exit'>&{rows:[number,Weight][][];exit:[number,Weight][]|null}};
const plus=(left:Weight,right:Weight):Weight=>({mass:addMass(left.mass,right.mass),steps:addMass(left.steps,right.steps)});
const times=(left:Weight,right:Weight):Weight=>({mass:multiplyMass(left.mass,right.mass),steps:addMass(multiplyMass(left.steps,right.mass),multiplyMass(left.mass,right.steps))});
const empty=():Weight=>({mass:zeroMass(),steps:zeroMass()});

/** Exact first-exit laws for all deterministic stationary policies of a finite
 * component. State elimination sums geometric paths, including their first
 * moments. A closed recurrent class is an explicit nontermination outcome.
 * Each step eliminates at most one row; no original game code is executed. */
export class CycleSearch{
  readonly graph:CycleState[];
  readonly external:number[];
  readonly total:bigint;
  private readonly local:Map<number,number>;
  private readonly outside:Map<number,number>;
  private readonly sink:number;
  private completed:PolicyExitKernel[]=[];
  private work:Work|null=null;
  constructor(graph:CycleState[]){
    this.graph=structuredClone(graph);this.local=new Map(this.graph.map((state,index)=>[state.belief,index]));

    const external=new Set<number>();let count=1n;
    for(const state of this.graph){

      count*=BigInt(state.actions.length);
      for(const action of state.actions)for(const row of action.outcomes)if(!this.local.has(row.belief))external.add(row.belief);
    }
    this.total=count;this.external=[...external].sort((a,b)=>a-b);this.outside=new Map(this.external.map((id,index)=>[id,graph.length+index]));this.sink=graph.length+this.external.length;
  }
  get complete(){return BigInt(this.completed.length)===this.total;}
  get evaluated(){return this.completed.length;}
  kernels():readonly PolicyExitKernel[]{return this.completed;}
  private choices(policy:bigint):number[]{
    const result:number[]=[];for(const state of this.graph){const radix=BigInt(state.actions.length);result.push(Number(policy%radix));policy/=radix;}return result;
  }
  private begin():Work{
    const policy=BigInt(this.completed.length),choices=this.choices(policy),rows=this.graph.map((state,index)=>{
      const row=new Map<number,Weight>();
      for(const outcome of state.actions[choices[index]!]!.outcomes){
        const target=this.local.get(outcome.belief)??this.outside.get(outcome.belief)!;
        row.set(target,plus(row.get(target)??empty(),{mass:outcome.mass,steps:outcome.mass}));
      }
      return row;
    });
    for(let index=0;index<this.graph.length;index++)rows.push(new Map([[index,{mass:unitMass(),steps:zeroMass()}]]));
    return{policy,pivot:0,row:0,rows,exit:null};
  }
  step():boolean{
    if(this.complete)return false;
    if(!this.work){this.work=this.begin();return true;}
    const work=this.work,n=this.graph.length;
    if(work.pivot===n){
      const kernel:PolicyExitKernel={actions:this.choices(work.policy).map((choice,index)=>this.graph[index]!.actions[choice]!.key),
        exits:work.rows.slice(n).map(row=>[...row].map(([target,value])=>({belief:target===this.sink?null:this.external[target-n]!,...value})))};
      this.completed.push(kernel);this.work=null;return true;
    }
    if(work.exit===null){
      const row=work.rows[work.pivot]!,self=row.get(work.pivot)??empty(),remaining=subtractMass(unitMass(),self.mass),exit=new Map<number,Weight>();
      if(remaining.numerator===0n)exit.set(this.sink,{mass:unitMass(),steps:zeroMass()});
      else for(const [target,value] of row)if(target!==work.pivot){
        const mass=divideMass(value.mass,remaining);
        // d[f/(1-g)] = f'/(1-g) + f*g'/(1-g)^2 at z=1.
        const steps=target===this.sink?zeroMass():addMass(divideMass(value.steps,remaining),divideMass(multiplyMass(mass,self.steps),remaining));
        exit.set(target,{mass,steps});
      }
      work.exit=exit;return true;
    }
    if(work.row===work.rows.length){work.rows[work.pivot]!.clear();work.pivot++;work.row=0;work.exit=null;return true;}
    const index=work.row,row=work.rows[index]!,incoming=row.get(work.pivot);
    if(index!==work.pivot&&incoming){
      // Build a detached replacement before committing the row/cursor. A pause
      // or arithmetic error leaves the existing elimination work intact.
      const next=new Map(row);next.delete(work.pivot);
      for(const [target,value] of work.exit){const weight=times(incoming,value);if(target===this.sink)weight.steps=zeroMass();next.set(target,plus(next.get(target)??empty(),weight));}
      work.rows[index]=next;
    }
    work.row++;return true;
  }
  save():CycleSearchSnapshot{return{graph:structuredClone(this.graph),completed:structuredClone(this.completed),work:this.work?{
    ...this.work,rows:this.work.rows.map(row=>structuredClone([...row])),exit:this.work.exit?structuredClone([...this.work.exit]):null}:null};}
  static restore(graph:CycleState[],saved:CycleSearchSnapshot):CycleSearch{
    const result=new CycleSearch(graph);result.completed=structuredClone(saved.completed);
    if(saved.work){const work=structuredClone(saved.work);result.work={...work,rows:work.rows.map(row=>new Map(row)),exit:work.exit===null?null:new Map(work.exit)};}
    return result;
  }
}
