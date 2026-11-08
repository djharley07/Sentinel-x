/** Mono 16-bit PCM WAV, capped at 30 seconds, for the existing WAV endpoint. */
export function encodeWav(channels: Float32Array[], sourceRate: number): Blob {
 if(!channels.length||!channels[0].length||sourceRate<=0)throw new Error('No recorded audio was available.')
 const rate=16000
 const inputLength=Math.min(channels[0].length,Math.floor(sourceRate*30))
 const length=Math.floor(inputLength*rate/sourceRate)
 if(!length)throw new Error('The recording is too short.')
 const buffer=new ArrayBuffer(44+length*2),v=new DataView(buffer)
 const write=(offset:number,s:string)=>{for(let i=0;i<s.length;i++)v.setUint8(offset+i,s.charCodeAt(i))}
 write(0,'RIFF');v.setUint32(4,36+length*2,true);write(8,'WAVE');write(12,'fmt ');v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,1,true);v.setUint32(24,rate,true);v.setUint32(28,rate*2,true);v.setUint16(32,2,true);v.setUint16(34,16,true);write(36,'data');v.setUint32(40,length*2,true)
 for(let i=0;i<length;i++){
  // Average the source interval to downsample and combine microphone channels.
  const start=Math.floor(i*sourceRate/rate),end=Math.min(inputLength,Math.max(start+1,Math.floor((i+1)*sourceRate/rate)))
  let sum=0,count=0
  for(const c of channels)for(let j=start;j<end;j++){sum+=c[j]??0;count++}
  const sample=Math.max(-1,Math.min(1,sum/Math.max(1,count)))
  v.setInt16(44+i*2,sample<0?sample*32768:sample*32767,true)
 }
 return new Blob([buffer],{type:'audio/wav'})
}
