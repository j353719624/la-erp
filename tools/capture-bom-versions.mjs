export async function captureBOMVersions(request){
 const products=(await request('GET','/api/v1/products?page_size=100')).data.list;
 const raw=products.find(x=>x.code==='REC-NEST-RAW'),semi=products.find(x=>x.code==='REC-NEST-SEMI'),top=products.find(x=>x.code==='REC-NEST-TOP');
 const boms=(await request('GET','/api/v1/boms?page_size=100')).data.list;const old=boms.find(x=>x.product_id===semi.id),topBOM=boms.find(x=>x.product_id===top.id);
 const next=await request('POST','/api/v1/boms',{product_id:semi.id,product_code:semi.code,product_name:semi.name,qty_per:1,version:'2.0',items:[{product_id:raw.id,product_code:raw.code,product_name:raw.name,unit_id:raw.unit_id,qty:4,scrap_rate:0}]});if(!next.data?.id)throw Error('BOM version missing');
 await request('GET','/api/v1/boms?product_id='+semi.id);await request('POST','/api/v1/mrp/run',{});await request('GET','/api/v1/boms/'+topBOM.id+'/tree');
 await request('POST','/api/v1/boms/'+old.id+'/activate',{});await request('GET','/api/v1/boms?product_id='+semi.id);await request('POST','/api/v1/mrp/run',{});await request('GET','/api/v1/boms/'+topBOM.id+'/tree');
 await request('POST','/api/v1/boms/'+next.data.id+'/activate',{});await request('GET','/api/v1/boms?product_id='+semi.id);const plan=await request('POST','/api/v1/mrp/run',{});await request('GET','/api/v1/boms/'+topBOM.id+'/tree');
 const generated=await request('POST','/api/v1/mrp/requirements/'+plan.data.id+'/generate-work-orders',{});if(Array.isArray(generated.data)){for(const work of generated.data)await request('GET','/api/v1/work-orders/'+work.id+'/materials')}
 await request('POST','/api/v1/boms/00000000-0000-0000-0000-000000000001/activate',{});
}
