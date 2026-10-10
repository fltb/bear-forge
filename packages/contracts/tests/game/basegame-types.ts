import type {BaseGame,Request,ActionReply} from '@bear-forge/contracts/game';
type T={bid:{request:{minimum:number};action:{amount:number};description:never};text:{request:null;action:string;description:{grammar:'expression'}}};
type B=BaseGame<T,'a'|'b',{hand:number[]},string,number>;
export async function consume(base:B,request:Request<T,'a'|'b',{hand:number[]}>) {
  await base.bind({player:'a',onRequest:async()=>({kind:'pause'})});
  if(request.type==='bid'){
    const result=await base.describe({requestId:request.id,type:'bid'});if(result.ok){const n:number=result.value.values[0]!.amount;void n;}
    await base.validate({player:'a',reply:{requestId:request.id,type:'bid',action:{amount:2}}});
  }
  await base.run();await base.observe({player:'a'});
  // @ts-expect-error action payloads retain their type correlation
  const bad:ActionReply<T>={requestId:request.id,type:'text',action:{amount:1}};void bad;
  // @ts-expect-error actions have no generic delivery envelope
  const timed:ActionReply<T>={requestId:request.id,type:'bid',action:{amount:1},delivery:{at:1}};void timed;
  // @ts-expect-error binding selects a concrete player
  await base.bind({onRequest:async()=>({kind:'pause'})});
  // @ts-expect-error single-step operation has no input count setting
  await base.run({limits:{maxInputs:1}});
  // @ts-expect-error session input is an optional separate capability
  base.bindControl;
  // @ts-expect-error branching is optional, outside the basic game capability
  base.fork;
  // @ts-expect-error persistence is optional, outside the basic game capability
  base.save;
}
