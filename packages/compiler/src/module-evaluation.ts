/** Compiler-internal module bodies. Linking/instantiation must finish first;
 * dependencies retain source request order. This is not a public loading API. */
export type EvaluationModule = {dependencies:number[]} & (
  {async:false;execute:()=>void} | {async:true;execute:()=>Promise<void>}
);

/** Static module evaluation, following ECMA-262 InnerModuleEvaluation and its
 * async completion algorithms. This function is self-contained so the compiler
 * can emit it inside the program, using the same controlled execution as author
 * code. It must never run module bodies as host callbacks around that runtime.
 * https://tc39.es/ecma262/#sec-innermoduleevaluation */
export function evaluateModuleGraph(definitions:EvaluationModule[],entry:number):Promise<void>;
export function evaluateModuleGraph(definitions:EvaluationModule[],entry:number,synchronous:true):void;
export function evaluateModuleGraph(definitions:EvaluationModule[],entry:number,synchronous=false):Promise<void>|void{
  // 0 linked, 1 traversing, 2 waiting asynchronously, 3 evaluated.
  const records=definitions.map(definition=>({
    definition,state:0,index:-1,ancestor:-1,root:-1,order:-1,pending:0,
    parents:[] as number[],error:undefined as {value:unknown}|undefined
  }));
  const stack:number[]=[];
  let nextIndex=0,nextOrder=0;
  function evaluate(resolve:()=>void,reject:(error:unknown)=>void):void{
    function failed(id:number,value:unknown):void{
      const record=records[id]!;
      if(record.state===3)return;
      record.error={value};record.state=3;record.order=-2;
      if(id===entry)reject(value);
      for(const parent of record.parents)failed(parent,value);
    }
    function available(id:number,list:Set<number>):void{
      for(const parent of records[id]!.parents){
        const record=records[parent]!;
        // A synchronous failure may close a traversing ancestor before its SCC
        // root is assigned. Its own completion already makes it unavailable.
        if(list.has(parent)||record.error||records[record.root]!.error)continue;
        if(--record.pending===0){
          list.add(parent);
          if(!record.definition.async)available(parent,list);
        }
      }
    }
    function completed(id:number):void{
      const record=records[id]!;
      if(record.state===3)return;
      record.order=-2;record.state=3;
      if(id===entry)resolve();
      const ready=new Set<number>();available(id,ready);
      const ordered=[...ready].sort((a,b)=>records[a]!.order-records[b]!.order);
      for(const parent of ordered){
        const ancestor=records[parent]!;
        if(ancestor.state===3)continue;
        if(ancestor.definition.async)startAsync(parent);
        else{
          try{
            const execute=ancestor.definition.execute;execute();
            ancestor.order=-2;ancestor.state=3;
            if(parent===entry)resolve();
          }catch(error){failed(parent,error);}
        }
      }
    }
    function startAsync(id:number):void{
      const definition=records[id]!.definition;
      if(!definition.async)throw new Error('Async module body is missing');
      const execute=definition.execute;
      execute().then(()=>completed(id),error=>failed(id,error));
    }
    function visit(id:number):void{
      const record=records[id]!;
      if(record.state===2||record.state===3){
        if(record.error)throw record.error.value;
        return;
      }
      if(record.state===1)return;
      record.state=1;record.index=record.ancestor=nextIndex++;
      stack.push(id);
      for(const dependency of record.definition.dependencies){
        visit(dependency);
        let required=records[dependency]!,requiredId=dependency;
        if(required.state===1)record.ancestor=Math.min(record.ancestor,required.ancestor);
        else{
          requiredId=required.root;required=records[requiredId]!;
          if(required.error)throw required.error.value;
        }
        if(required.order>=0){record.pending++;required.parents.push(id);}
      }
      if(record.definition.async||record.pending>0){
        record.order=nextOrder++;
        if(record.pending===0)startAsync(id);
      }else{
        const execute=record.definition.execute;execute();
      }
      if(record.ancestor===record.index){
        let member:number;
        do{
          member=stack.pop()!;
          const current=records[member]!;
          current.state=current.order<0?3:2;current.root=id;
        }while(member!==id);
      }
    }
    try{visit(entry);if(records[entry]!.state===3)resolve();}
    catch(error){
      for(const id of stack){records[id]!.state=3;records[id]!.error={value:error};}
      reject(error);
    }
  }
  if(synchronous){
    if(definitions.some(definition=>definition.async))throw new Error('Synchronous evaluation requires synchronous module bodies');
    evaluate(()=>{},error=>{throw error;});return;
  }
  return new Promise<void>(evaluate);
}
