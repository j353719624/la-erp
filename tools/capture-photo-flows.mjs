export async function capturePhotoFlows(request,baseline){
 const list=name=>baseline.find(x=>x.endpoint==='/api/v1/'+name&&x.method==='GET')?.body?.data?.list||[];const product=list('products')[2],wh=list('warehouses')[0];if(!product||!wh)throw Error('Photo masters missing');
 const loc=await request('POST','/api/v1/locations',{warehouse_id:wh.id,name:'恢复拍照库区',code:'REC-PHOTO-LOC',status:'active'});const rack=loc.data?.id?await request('POST','/api/v1/racks',{location_id:loc.data.id,name:'恢复拍照货架',code:'REC-PHOTO-RACK',status:'active'}):null;
 if(!loc.data?.id||!rack?.data?.id)throw Error('Photo location masters missing');
 for(const confirmed of [false,true]){
  const doc=await request('POST','/api/v1/stock-ins',{type:'other',warehouse_id:wh.id,lines:[{product_id:product.id,qty:1,unit_cost:5}]});if(!doc.data?.id)throw Error('Photo stock creation failed');const p='/api/v1/stock-ins/'+doc.data.id;
  if(confirmed)await request('POST',p+'/confirm',{});
  await request('POST',p+'/photos',{photos:[]});await request('POST',p+'/photos',{photos:[{remark:'缺少URL'}]});
  const photos=await request('POST',p+'/photos',{photos:[{url:'/uploads/recovery-photo-1.jpg',remark:'照片一',location_id:loc.data.id,rack_id:rack.data.id},{url:'/uploads/recovery-photo-2.jpg',remark:'照片二'}]});
  await request('GET',p);if(!Array.isArray(photos.data)||!photos.data[0]?.id)throw Error('Photo add failed');
  const pp=p+'/photos/'+photos.data[0].id;await request('PUT',pp,{remark:'照片备注修改',url:'/uploads/recovery-photo-edited.jpg'});await request('GET',p);await request('PUT',pp,{location_id:null,rack_id:null,remark:'清空位置'});await request('GET',p);await request('DELETE',pp);await request('GET',p);await request('PUT',pp,{location_id:null,rack_id:null,remark:'清空位置'});await request('GET',p);await request('DELETE',pp);
  await request('GET','/api/v1/inventory-balances?product_id='+product.id);
 }
}
