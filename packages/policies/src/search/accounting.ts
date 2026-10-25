import type {SearchCost} from './session.types.ts';

/** Accounting never cuts off execution, selects an action or changes a bound.
 * Phases include failed work and cleanup. Nested phases are not additive;
 * peak RSS is sampled at measurement boundaries, not an allocation profiler. */
export class SearchAccounting{
  private readonly started:number;
  private peakRssBytes=0;
  private longestSegmentMilliseconds=0;
  private readonly phases=new Map<string,{calls:number;milliseconds:number}>();
  private readonly clock:()=>number;
  private readonly rss:()=>number;
  constructor(clock=()=>performance.now(),rss=()=>process.memoryUsage().rss){this.clock=clock;this.rss=rss;this.started=clock();this.sample();}
  private sample(){this.peakRssBytes=Math.max(this.peakRssBytes,this.rss());}
  private record(phase:string,started:number){
    const elapsed=this.clock()-started,total=this.phases.get(phase)??{calls:0,milliseconds:0};
    total.calls++;total.milliseconds+=elapsed;this.phases.set(phase,total);
    this.longestSegmentMilliseconds=Math.max(this.longestSegmentMilliseconds,elapsed);this.sample();
  }
  measureSync<T>(operation:()=>T,phase:string):T{
    this.sample();const started=this.clock();try{return operation();}finally{this.record(phase,started);}
  }
  async measure<T>(operation:()=>Promise<T>,phase:string):Promise<T>{
    this.sample();const started=this.clock();try{return await operation();}finally{this.record(phase,started);}
  }
  cost():SearchCost{
    this.sample();return{milliseconds:this.clock()-this.started,peakRssBytes:this.peakRssBytes,longestSegmentMilliseconds:this.longestSegmentMilliseconds,
      phases:Object.fromEntries([...this.phases].map(([phase,cost])=>[phase,{...cost}]))};
  }
}
