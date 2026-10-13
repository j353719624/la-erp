export async function captureBOMLifecycle(request){
 const products=(await request('GET','/api/v1/products?page_size=100')).data.list;
 const semi=products.find(x=>x.code==='REC-NEST-SEMI'),top=products.find(x=>x.code==='REC-NEST-TOP');
 const list=(await request('GET','/api/v1/boms?page_size=100')).data.list;
 const versions=list.filter(x=>x.product_id===semi.id).sort((a,b)=>b.code.localeCompare(a.code));const latest=versions[0],older=versions[1],root=list.find(x=>x.product_id===top.id);
 await request('POST',`/api/v1/boms/${latest.id}/deactivate`,{});
 await request('GET',`/api/v1/boms/${latest.id}`);await request('GET',`/api/v1/boms/${root.id}/tree`);await request('POST','/api/v1/mrp/run',{});
 await request('POST',`/api/v1/boms/${latest.id}/deactivate`,{});
 await request('POST',`/api/v1/boms/${older.id}/deactivate`,{});await request('GET',`/api/v1/boms/${root.id}/tree`);await request('POST','/api/v1/mrp/run',{});
 await request('POST',`/api/v1/boms/${latest.id}/activate`,{});
 await request('DELETE',`/api/v1/boms/${latest.id}`);await request('GET',`/api/v1/boms/${latest.id}`);await request('GET',`/api/v1/boms/${root.id}/tree`);
 await request('DELETE',`/api/v1/boms/${latest.id}`);await request('POST',`/api/v1/boms/${latest.id}/activate`,{});await request('POST',`/api/v1/boms/${latest.id}/deactivate`,{});
 await request('DELETE','/api/v1/boms/00000000-0000-0000-0000-000000000001');await request('POST','/api/v1/boms/00000000-0000-0000-0000-000000000001/deactivate',{});
 const raw=products.find(x=>x.code==='REC-NEST-RAW');const unused=await request('POST','/api/v1/boms',{product_id:semi.id,qty_per:1,version:'3.0',items:[{product_id:raw.id,unit_id:raw.unit_id,qty:5,scrap_rate:0}]});
 if(!unused.data?.id)throw Error('Unused BOM missing');
 await request('DELETE',`/api/v1/boms/${unused.data.id}`);await request('GET',`/api/v1/boms/${unused.data.id}`);await request('DELETE',`/api/v1/boms/${unused.data.id}`);
 await request('POST',`/api/v1/boms/${unused.data.id}/activate`,{});await request('POST',`/api/v1/boms/${unused.data.id}/deactivate`,{});

}
