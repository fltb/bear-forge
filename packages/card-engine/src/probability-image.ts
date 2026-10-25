/** Push a trusted nondecreasing finite-valued producer through an integer
 * grid. Every row is [previousEnd,end); binary search avoids enumerating the
 * float24 grid. The producer retains the ONLY definition of its rounding. */
export function monotoneProbabilityImage(size:number,project:(coordinate:number)=>number):{end:number;value:number}[]{
  const result:{end:number;value:number}[]=[];let start=0;
  while(start<size){
    const value=project(start);
    let low=start+1,high=size;
    while(low<high){const middle=Math.floor((low+high)/2),next=project(middle);if(next===value)low=middle+1;else high=middle;}
    result.push({end:low,value});start=low;
  }
  return result;
}
