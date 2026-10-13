// Usage: node inspect-elf.cjs <original-server> <analysis-output-dir>
const fs = require('fs');
const b = fs.readFileSync(process.argv[2]);
const u64 = o => Number(b.readBigUInt64LE(o));
const sh = u64(40), sz = b.readUInt16LE(58), n = b.readUInt16LE(60), si = b.readUInt16LE(62);
const no = u64(sh + si * sz + 24), nl = u64(sh + si * sz + 32);
const names = b.subarray(no, no + nl);
const sections = [];
for (let i=0;i<n;i++) { const o=sh+i*sz, ni=b.readUInt32LE(o); const name=names.subarray(ni,names.indexOf(0,ni)).toString(); sections.push({name,type:b.readUInt32LE(o+4),addr:u64(o+16),offset:u64(o+24),size:u64(o+32),entrySize:u64(o+56)}); }
fs.mkdirSync(process.argv[3],{recursive:true});
fs.writeFileSync(require('path').join(process.argv[3], 'elf-sections.json'), JSON.stringify(sections,null,2));
console.log(JSON.stringify(sections,null,2));
const bi=sections.find(x=>x.name==='.go.buildinfo'); if(bi) console.log('BUILDINFO',b.subarray(bi.offset,bi.offset+bi.size).toString());
