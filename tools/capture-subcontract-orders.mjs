export async function captureSubcontractOrders(request) {
  const base='/api/v1/subcontract-orders';
  await request('GET',base+'?page_size=100');
  await request('POST',base,{});await request('POST',base,{qty:-1});
  const create=async(body)=>{const r=await request('POST',base,{supplier_id:supplier.id,product_id:product.id,warehouse_id:warehouse.id,...body});if(!r.data?.id)throw Error('subcontract: '+JSON.stringify(r));return r.data;};
  const supplier=(await request('GET','/api/v1/suppliers')).data.list[0];
  const warehouse=(await request('GET','/api/v1/warehouses')).data.list[0];
  const product=(await request('GET','/api/v1/products?page_size=100')).data.list.find(p=>p.code==='REC-LIST-FIN');
  const first=await create({qty:3,unit_price:2,mode:'pure',supplier_id:supplier.id,supplier_name:'caller supplier',product_id:product.id,product_name:'caller product',warehouse_id:warehouse.id,warehouse_name:'caller warehouse',process_name:'External process',remark:'initial'});
  const path=base+'/'+first.id;await request('GET',path);await request('GET',base+'?page_size=100');
  await request('PUT',path,{remark:'only remark'});await request('GET',path);
  await request('PUT',path,{qty:4,unit_price:3});await request('GET',path);
  await request('POST',path+'/complete',{});
  await request('POST',path+'/confirm',{});await request('POST',path+'/confirm',{});
  await request('PUT',path,{qty:5});await request('DELETE',path);
  await request('POST',path+'/cancel',{});await request('POST',path+'/cancel',{});await request('GET',path);
  const draft=await create({qty:1});await request('GET',base+'/'+draft.id);await request('DELETE',base+'/'+draft.id);await request('GET',base+'/'+draft.id);await request('DELETE',base+'/'+draft.id);
  const cancel=await create({qty:2,unit_price:5});await request('POST',base+'/'+cancel.id+'/cancel',{});await request('DELETE',base+'/'+cancel.id);
  await request('GET',base+'/00000000-0000-0000-0000-000000000001');
  await request('PUT',base+'/00000000-0000-0000-0000-000000000001',{qty:1});

  for(const body of [
    {qty:0,supplier_id:supplier.id},
    {qty:1,supplier_id:supplier.id,unit_price:-2},
    {qty:1,supplier_id:supplier.id},
    {qty:1,supplier_id:supplier.id,mode:'bad'},
    {qty:1,supplier_id:supplier.id,mode:'with_material',product_id:product.id}
  ])await request('POST',base,body);
  const raw=(await request('GET','/api/v1/products?page_size=100')).data.list.find(p=>p.code==='REC-LIST-RAW');
  const material=await create({qty:2,unit_price:3,mode:'with_material',material_lines:[{product_id:raw.id,product_code:'caller raw',product_name:'caller raw name',qty:4,remark:'first material'}]});
  const matPath=base+'/'+material.id;await request('GET',matPath);await request('GET',base+'?page_size=100');
  await request('PUT',matPath,{remark:'material remark'});await request('GET',matPath);
  await request('PUT',matPath,{material_lines:[{product_id:raw.id,qty:5,remark:'replacement'}]});await request('GET',matPath);
  await request('POST',matPath+'/confirm',{});await request('POST',matPath+'/cancel',{});await request('GET',matPath);

  for(const material_lines of [[],[{product_id:raw.id,qty:0}],[{product_id:raw.id,qty:1},{product_id:raw.id,qty:2}]])await request('POST',base,{qty:1,supplier_id:supplier.id,mode:'with_material',material_lines});
  const deletedMat=await create({qty:1,mode:'with_material',material_lines:[{product_id:raw.id,qty:1}]});
  await request('DELETE',base+'/'+deletedMat.id);await request('GET',base+'/'+deletedMat.id);
  const keywordOnly=await create({qty:1,supplier_name:'Needle Supplier',product_name:'Needle Product',process_name:'Needle Process',remark:'Needle Remark'});
  for(const keyword of ['Supplier','Product','Process','Remark','SUB'])await request('GET',base+'?page_size=100&keyword='+keyword);

  const receive=await create({qty:4,unit_price:3,product_code:product.code,product_name:product.name,supplier_name:supplier.name,warehouse_name:warehouse.name});
  const recvPath=base+'/'+receive.id;
  await request('POST',recvPath+'/receive',{qty:1});
  await request('POST',recvPath+'/confirm',{});
  await request('POST',recvPath+'/receive',{qty:0});
  await request('POST',recvPath+'/receive',{qty:1,batch:true,remark:'partial receive'});
  await request('GET',recvPath);
  await request('POST',recvPath+'/cancel',{});
  await request('POST',recvPath+'/finish-receive',{});
  await request('POST',recvPath+'/finish-receive',{reason:'quantity agreement'});
  await request('GET',recvPath);
  await request('POST',recvPath+'/complete',{});
  await request('POST',recvPath+'/complete',{});
  await request('GET','/api/v1/inventory-balances?product_id='+product.id);
  await request('GET','/api/v1/stock-movements?product_id='+product.id);
  await request('GET','/api/v1/ap-invoices?source_id='+receive.id);

  // Valid material lifecycle: seed stock, confirm a fresh order, issue, return,
  // then receive so the capture includes cost consumption and inventory effects.
  const seedStock=await request('POST','/api/v1/stock-ins',{warehouse_id:warehouse.id,lines:[{product_id:raw.id,qty:20,unit_cost:2}]});
  if(seedStock.data?.id)await request('POST','/api/v1/stock-ins/'+seedStock.data.id+'/confirm',{});
  const materialFlow=await create({qty:2,unit_price:3,warehouse_id:warehouse.id,mode:'with_material',material_lines:[{product_id:raw.id,qty:4}]});
  const flowPath=base+'/'+materialFlow.id;
  await request('POST',flowPath+'/confirm',{});
  const issueTarget=(await request('GET',flowPath)).data;
  const line=issueTarget.edges?.material_lines?.[0];
  await request('POST',flowPath+'/issue',[]);
  await request('POST',flowPath+'/issue',[{material_line_id:line.id,qty:0}]);
  await request('POST',flowPath+'/issue',[{material_line_id:line.id,qty:2}]);
  await request('POST',flowPath+'/issue',[{material_line_id:line.id,qty:99}]);
  await request('GET',flowPath);
  await request('POST',flowPath+'/return-material',[]);
  await request('POST',flowPath+'/return-material',[{material_line_id:line.id,qty:1}]);
  await request('POST',flowPath+'/return-material',[{material_line_id:line.id,qty:99}]);
  await request('POST',flowPath+'/receive',{qty:1,batch:true});
  await request('POST',flowPath+'/finish-receive',{reason:'material cost capture'});
  await request('GET',flowPath);
  await request('GET','/api/v1/inventory-balances?product_id='+raw.id);
  await request('GET','/api/v1/stock-movements?product_id='+raw.id);
}
