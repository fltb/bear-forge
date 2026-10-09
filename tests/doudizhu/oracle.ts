import type { Pattern } from '../../games/doudizhu/src/patterns.ts';
/** Slow reference from selected-card multiplicities; shares no classification/generation code. */
export function oracle(cards: number[]): Pattern[] {
  const groups = new Map<number,number>();
  for (const c of cards) groups.set(c,(groups.get(c) ?? 0)+1);
  const r = [...groups.keys()].sort((a,b) => a-b), m = (rank: number) => groups.get(rank) ?? 0, out: Pattern[]=[];
  const push = (kind: Pattern['kind'], high: number, length=1) => out.push({kind,high,length});
  if (cards.length===1) push('single',r[0]!);
  if (cards.length===2 && m(16)===1 && m(17)===1) push('rocket',17);
  if (r.length===1 && r[0]!<=15) { if(cards.length===2)push('pair',r[0]!);if(cards.length===3)push('triple',r[0]!);if(cards.length===4)push('bomb',r[0]!); }
  const ordered = r.every((rank,i) => rank<=14 && (!i || rank===r[i-1]!+1));
  for (const [multiplicity,minimum,kind] of [[1,5,'straight'],[2,3,'pairs'],[3,2,'airplane']] as const) if (ordered && r.length>=minimum && r.every(rank=>m(rank)===multiplicity)) push(kind,r.at(-1)!,r.length);
  for (const rank of r) if(m(rank)===3 && r.length===2) {
    if(cards.length===4)push('tripleSingle',rank);
    if(cards.length===5)push('triplePair',rank);
  }
  const triples = r.filter(rank => m(rank)===3 && rank<=14);
  for (let i=0;i<triples.length;i++) for(let j=i+1;j<triples.length;j++) {
    const body=triples.slice(i,j+1), length=body.length;
    if(body.some((rank,k)=>k>0 && rank!==body[k-1]!+1))continue;
    const wings=r.filter(rank=>!body.includes(rank));
    if(m(16)&&m(17) || wings.some(rank=>m(rank)===4 || m(rank)===3 && rank<=14 && (rank===body[0]!-1 || rank===body.at(-1)!+1)))continue;
    const wingCount=wings.reduce((sum,rank)=>sum+m(rank),0);
    if(wingCount===length)push('airplaneSingle',body.at(-1)!,length);
    if(wings.length===length && wings.every(rank=>m(rank)===2))push('airplanePair',body.at(-1)!,length);
  }
  for(const rank of r)if(m(rank)===4 && !(m(16)&&m(17))) {
    const wings=r.filter(x=>x!==rank);
    if(cards.length===6)push('fourSingles',rank);
    if(cards.length===8 && wings.length===2 && wings.every(x=>m(x)===2))push('fourPairs',rank);
  }
  return out;
}
