const constants=new Uint32Array([0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
    0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
    0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
    0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
    0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
    0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
    0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
    0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2]);

/** SHA-256 over deterministic UTF-8 layout text; no host crypto or mutable runtime state. */
export function layoutDigest(text:string):string{
  // Allocate the exact padded byte buffer once. The language-only UTF-8
  // encoder also works where host TextEncoder is not an admitted capability.
  let length=0;
  for(let i=0;i<text.length;i++){
    const n=text.charCodeAt(i);
    if(n<0x80)length++;
    else if(n<0x800)length+=2;
    else if(n>=0xd800&&n<=0xdbff&&text.charCodeAt(i+1)>=0xdc00&&text.charCodeAt(i+1)<=0xdfff){length+=4;i++;}
    else length+=3;
  }
  const bytes=new Uint8Array(Math.ceil((length+9)/64)*64);
  let at=0;
  for(let i=0;i<text.length;i++){
    let n=text.charCodeAt(i);
    if(n>=0xd800&&n<=0xdfff){
      const next=text.charCodeAt(i+1);
      if(n<=0xdbff&&next>=0xdc00&&next<=0xdfff){n=0x10000+((n-0xd800)<<10)+(next-0xdc00);i++;}
      else n=0xfffd;
    }
    if(n<0x80)bytes[at++]=n;
    else if(n<0x800){bytes[at++]=0xc0|(n>>>6);bytes[at++]=0x80|(n&63);}
    else if(n<0x10000){bytes[at++]=0xe0|(n>>>12);bytes[at++]=0x80|((n>>>6)&63);bytes[at++]=0x80|(n&63);}
    else{bytes[at++]=0xf0|(n>>>18);bytes[at++]=0x80|((n>>>12)&63);bytes[at++]=0x80|((n>>>6)&63);bytes[at++]=0x80|(n&63);}
  }
  bytes[length]=0x80;
  const high=Math.floor(length/0x20000000),low=(length*8)>>>0;
  for(let i=0;i<4;i++){bytes[bytes.length-8+i]=(high>>>(24-i*8))&255;bytes[bytes.length-4+i]=(low>>>(24-i*8))&255;}
  let h0=0x6a09e667,h1=0xbb67ae85,h2=0x3c6ef372,h3=0xa54ff53a,h4=0x510e527f,h5=0x9b05688c,h6=0x1f83d9ab,h7=0x5be0cd19;
  const rotate=(value:number,bits:number)=>(value>>>bits)|(value<<(32-bits)),w=new Uint32Array(64);
  for(let offset=0;offset<bytes.length;offset+=64){
    for(let i=0;i<16;i++)w[i]=((bytes[offset+i*4]!<<24)|(bytes[offset+i*4+1]!<<16)|(bytes[offset+i*4+2]!<<8)|bytes[offset+i*4+3]!)>>>0;
    for(let i=16;i<64;i++){
      const a=w[i-15]!,b=w[i-2]!,s0=rotate(a,7)^rotate(a,18)^(a>>>3),s1=rotate(b,17)^rotate(b,19)^(b>>>10);
      w[i]=(w[i-16]!+s0+w[i-7]!+s1)>>>0;
    }
    let a=h0,b=h1,c=h2,d=h3,e=h4,f=h5,g=h6,j=h7;
    for(let i=0;i<64;i++){
      const t1=(j+(rotate(e,6)^rotate(e,11)^rotate(e,25))+((e&f)^(~e&g))+constants[i]!+w[i]!)>>>0;
      const t2=((rotate(a,2)^rotate(a,13)^rotate(a,22))+((a&b)^(a&c)^(b&c)))>>>0;
      j=g;g=f;f=e;e=(d+t1)>>>0;d=c;c=b;b=a;a=(t1+t2)>>>0;
    }
    h0=(h0+a)>>>0;h1=(h1+b)>>>0;h2=(h2+c)>>>0;h3=(h3+d)>>>0;
    h4=(h4+e)>>>0;h5=(h5+f)>>>0;h6=(h6+g)>>>0;h7=(h7+j)>>>0;
  }
  return [h0,h1,h2,h3,h4,h5,h6,h7].map(word=>word.toString(16).padStart(8,'0')).join('');
}
