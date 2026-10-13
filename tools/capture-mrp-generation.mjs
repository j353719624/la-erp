export async function captureMRPGeneration(request){
 const plan=(await request('POST','/api/v1/mrp/run',{})).data;if(!plan?.id)throw Error('Generation plan missing');
 async function generate(){
  const generated=await request('POST','/api/v1/mrp/requirements/'+plan.id+'/generate-work-orders',{});if(!Array.isArray(generated.data))throw Error('Generated work orders absent');
  for(const work of generated.data){await request('GET','/api/v1/work-orders/'+work.id);await request('GET','/api/v1/work-orders/'+work.id+'/materials')}
 }
 await generate();await request('GET','/api/v1/mrp/requirements/'+plan.id);await generate();await request('POST','/api/v1/mrp/run',{});
 // Independently compare normal creation using exactly the same nested BOM.
 const products=(await request('GET','/api/v1/products?page_size=100')).data.list;
 const top=products.find(x=>x.code==='REC-NEST-TOP');const bom=(await request('GET','/api/v1/boms?page_size=100')).data.list.find(x=>x.product_id===top.id);
 const warehouse=(await request('GET','/api/v1/warehouses')).data.list[0];
 const manual=await request('POST','/api/v1/work-orders',{product_id:top.id,product_code:top.code,product_name:top.name,bom_id:bom.id,warehouse_id:warehouse.id,qty:2});if(!manual.data?.id)throw Error('Manual nested work missing');
 await request('GET','/api/v1/work-orders/'+manual.data.id+'/materials');await request('POST','/api/v1/work-orders/'+manual.data.id+'/confirm',{});await request('POST','/api/v1/mrp/run',{});
}
