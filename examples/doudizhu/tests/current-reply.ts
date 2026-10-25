/** Test policy evaluated against each execution's own current contract view. */
export function currentReply(contract:any,call:any,strategy:'small'|'large'){
  const port=contract.ports[call.port];
  if(port.kind==='event')return port.receive(call.input).output;
  const received=port.receive(call.input),request=received.requests[0];
  const options=contract.inputs.action.describe(received.view,request);
  if(options.kind!=='exact')throw Error('Expected exact legal choices');
  const selected=strategy==='small'?options.values.find((action:any)=>action.kind==='play')??options.values.at(-1):options.values.at(-1);
  const prepared=port.respond(received.view,request,selected);
  if(!prepared.valid)throw Error(prepared.reason);
  return prepared.output;
}
