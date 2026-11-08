"""Offline synthetic noise fixtures and transcript scoring; never calls an API."""
import argparse,array,hashlib,json,math,random,re,sys,unicodedata,wave
from pathlib import Path

def distance(a,b):
 row=list(range(len(b)+1))
 for i,x in enumerate(a,1):
  nxt=[i]
  for j,y in enumerate(b,1):nxt.append(min(nxt[-1]+1,row[j]+1,row[j-1]+(x!=y)))
  row=nxt
 return row[-1]

def normalized(s):
 return ' '.join(''.join(' ' if unicodedata.category(c).startswith('P') else c for c in unicodedata.normalize('NFC',s).casefold()).split())

def score(ref,hyp):
 a,b=normalized(ref),normalized(hyp)
 if not a:raise ValueError('Reference transcript cannot be empty.')
 return {'word_error_rate':distance(a.split(),b.split())/len(a.split()),'character_error_rate':distance(a,b)/len(a),'normalization':'NFC, lowercase, punctuation removed; number words and digits remain different','critical_facts':'Manually check equipment number, temperature, unit and negation.'}

def load_wav(p):
 with wave.open(str(p),'rb') as w:
  channels=w.getnchannels();rate=w.getframerate()
  if w.getsampwidth()!=2 or w.getcomptype()!='NONE':raise ValueError('Use an uncompressed 16-bit PCM WAV.')
  if channels not in (1,2) or not 8000<=rate<=96000 or not 0<w.getnframes()<=rate*30:raise ValueError('Use a mono/stereo WAV between 1 sample and 30 seconds, 8–96 kHz.')
  samples=array.array('h',w.readframes(w.getnframes()))
  if sys.byteorder!='little':samples.byteswap()
 return [sum(samples[i:i+channels])/(channels*32768) for i in range(0,len(samples),channels)],rate

def resample(x,source,target):
 if source==target:return x[:]
 n=int(len(x)*target/source)
 return [sum(x[int(i*source/target):max(int(i*source/target)+1,int((i+1)*source/target))])/max(1,max(int(i*source/target)+1,int((i+1)*source/target))-int(i*source/target)) for i in range(n)]

def add_noise(x,snr,seed):
 rng=random.Random(seed);noise=[rng.gauss(0,1) for _ in x]
 rms=lambda a:math.sqrt(sum(v*v for v in a)/len(a))
 power=rms(x)
 if power<1e-5:raise ValueError('Recording is silent or too quiet for a noise benchmark.')
 scale=power/(10**(snr/20)*rms(noise))
 mixed=[a+b*scale for a,b in zip(x,noise)];peak=max(1,max(abs(v) for v in mixed)/.95)
 return [v/peak for v in mixed]

def telephone(x):
 # Approximate band-limiting plus 8-kHz sampling; not a telephone codec/call.
 rate=8000;high=math.exp(-2*math.pi*300/rate);low=1-math.exp(-2*math.pi*3000/rate)
 prev=hp=lp=0;result=[]
 for sample in x:
  hp=high*(hp+sample-prev);prev=sample;lp+=low*(hp-lp);result.append(lp)
 return result

def write_wav(p,x,rate):
 samples=array.array('h',(int(max(-1,min(1,v))*32767) for v in x))
 if sys.byteorder!='little':samples.byteswap()
 with wave.open(str(p),'wb') as w:w.setnchannels(1);w.setsampwidth(2);w.setframerate(rate);w.writeframes(samples.tobytes())

def create(source,out,reference,language):
 if out.exists():raise ValueError('Choose a new output folder; existing test data will not be overwritten.')
 x,rate=load_wav(source);clean=resample(x,rate,16000)
 variants=[('clean',clean,16000,None),('synthetic_noise_20db',add_noise(clean,20,42),16000,20),('synthetic_noise_10db',add_noise(clean,10,42),16000,10)]
 phone=telephone(resample(clean,16000,8000));variants.append(('telephone_band_simulation_noise_10db',add_noise(phone,10,42),8000,10))
 if not reference.strip():raise ValueError('Reference transcript cannot be empty.')
 out.mkdir(parents=True)
 files=[]
 for name,audio,sr,snr in variants:
  p=out/(name+'.wav');write_wav(p,audio,sr)
  files.append({'condition':name,'filename':p.name,'sample_rate':sr,'nominal_added_noise_snr_db':snr,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()})
 manifest={'language_label':language,'reference_transcript':reference,'original_sha256':hashlib.sha256(source.read_bytes()).hexdigest(),'seed':42,'simulation_notice':'Synthetic Gaussian noise and approximate telephone-band audio; not real noisy calls and not a noise-removal improvement.','files':files}
 (out/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding='utf-8')
 print('Created four test WAV files and manifest.json in',out)

if __name__=='__main__':
 parser=argparse.ArgumentParser(description=__doc__);sub=parser.add_subparsers(dest='command',required=True)
 c=sub.add_parser('create');c.add_argument('audio',type=Path);c.add_argument('--reference',type=Path,required=True);c.add_argument('--language',required=True);c.add_argument('--output',type=Path,required=True)
 s=sub.add_parser('score');s.add_argument('reference',type=Path);s.add_argument('transcript',type=Path)
 args=parser.parse_args()
 try:
  if args.command=='create':create(args.audio,args.output,args.reference.read_text(encoding='utf-8-sig'),args.language)
  else:print(json.dumps(score(args.reference.read_text(encoding='utf-8-sig'),args.transcript.read_text(encoding='utf-8-sig')),ensure_ascii=False,indent=2))
 except (OSError,ValueError,wave.Error) as error:parser.exit(1,str(error)+'\n')
