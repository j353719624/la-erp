// Usage: node parse-go.cjs <original-server> <analysis-output-dir>
const fs=require('fs');
const b=fs.readFileSync(process.argv[2]);
const sec=JSON.parse(fs.readFileSync(require('path').join(process.argv[3], 'elf-sections.json')));
const s=sec.find(x=>x.name==='.gopclntab'), text=sec.find(x=>x.name==='.text');
const p=b.subarray(s.offset,s.offset+s.size),u64=o=>Number(p.readBigUInt64LE(o));
const n=u64(8), names=u64(32), pcln=u64(64);
const functions=[];
for(let i=0;i<n;i++) {
 const entry=p.readUInt32LE(pcln+i*8), next=p.readUInt32LE(pcln+(i+1)*8), fo=pcln+p.readUInt32LE(pcln+i*8+4);
 const no=p.readInt32LE(fo+4)+names;
 const name=p.subarray(no,p.indexOf(0,no)).toString();
 functions.push({name,start:text.addr+entry,end:text.addr+next,offset:text.offset+entry,size:next-entry,funcOffset:fo,pcfile:p.readUInt32LE(fo+20),pcln:p.readUInt32LE(fo+24),cuOffset:p.readUInt32LE(fo+32)});
}
fs.writeFileSync(require('path').join(process.argv[3], 'go-functions.json'),JSON.stringify(functions,null,2));
const own=functions.filter(x=>/la-erp|license|main\.main/i.test(x.name));
console.log('functions',n,'matched',own.length);console.log(own.slice(0,120).map(x=>x.name+' '+x.start.toString(16)).join('\n'));
console.log('first',functions.slice(0,4));
