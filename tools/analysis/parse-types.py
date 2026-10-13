# Usage: python parse-types.py <original-server> <analysis-output-dir>
import pathlib,struct,json,re,sys
destdir=pathlib.Path(sys.argv[2])
b=pathlib.Path(sys.argv[1]).read_bytes()
secs=json.loads((destdir/'elf-sections.json').read_text())
ro=next(s for s in secs if s['name']=='.rodata')
def off(va):
 for s in secs:
  if s['type']!=8 and s['addr']<=va<s['addr']+s['size']:return s['offset']+va-s['addr']
 raise ValueError(hex(va))
def u64(va):return struct.unpack_from('<Q',b,off(va))[0]
def u32(va):return struct.unpack_from('<I',b,off(va))[0]
def varint(o):
 n=0;shift=0
 while True:
  v=b[o];o+=1;n|=(v&127)<<shift
  if not v&128:return n,o
  shift+=7
def name(va):
 o=off(va);flags=b[o];n,o=varint(o+1);text=b[o:o+n].decode('utf8','replace');o+=n;tag=''
 if flags&2:n,o=varint(o);tag=b[o:o+n].decode('utf8','replace')
 return text,tag
def tname(va):
 try:
  n=name(ro['addr']+u32(va+40))[0]
  return n[1:] if b[off(va)+20]&2 and n.startswith('*') else n
 except Exception:return '?'
def fields(va):
 ptr=u64(va+56);n=u64(va+64)
 if n>1000:return []
 return [{'name':name(u64(ptr+i*24))[0],'tag':name(u64(ptr+i*24))[1],'type':tname(u64(ptr+i*24+8)),'offset':u64(ptr+i*24+16)} for i in range(n)]
tl=next(s for s in secs if s['name']=='.typelink')
types=[]
for i in range(tl['size']//4):
 va=ro['addr']+struct.unpack_from('<i',b,tl['offset']+4*i)[0]
 try:
  kind=b[off(va)+23]&31
  if kind==22:
   va=u64(va+48);kind=b[off(va)+23]&31
  if kind!=25:continue
  fs=fields(va)
  if any(f['tag'] for f in fs):types.append({'address':hex(va),'name':tname(va),'size':u64(va),'fields':fs})
 except Exception:continue
types=list({x['address']:x for x in types}.values())
dest=destdir/'go-structs.json';dest.write_text(json.dumps(types,ensure_ascii=False,indent=2),encoding='utf8')
matches=[x for x in types if 'uVLmU1J' in x['name'] or any(re.search(r'json:"machine_id"|mapstructure:"trial_days"',f['tag']) for f in x['fields'])]
(destdir/'license-types.json').write_text(json.dumps(matches,ensure_ascii=False,indent=2),encoding='utf8')
print('Recovered tagged structs:',len(types));print(json.dumps(matches,ensure_ascii=True,indent=2))
