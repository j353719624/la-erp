export async function captureUploadFlows(request,baseline){
 const base64='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1kAAAAASUVORK5CYII=';
 const route='/api/v1/upload/image';
 let primary;
 await request('POST',route,{$multipart:{}});await request('POST',route,{$multipart:{filename:'one.png',base64,field:'wrong'}});await request('POST',route,{$multipart:{filename:'one.png',base64,mime:'image/png'}},false);
 for(const ext of ['png','jpg','jpeg','PNG','gif','webp','bmp','svg','txt']){
  const uploaded=await request('POST',route,{$multipart:{filename:'recovery.'+ext,base64,mime:'image/png'}});
  if(ext==='png')primary=uploaded.data?.url;
  if(uploaded.data?.url){await request('GET',uploaded.data.url,undefined,false);await request('GET',uploaded.data.url)}
 }
 for(const [filename,bytes] of [['empty.png',''],['text.png',Buffer.from('plain text').toString('base64')]]) {const upload=await request('POST',route,{$multipart:{filename,base64:bytes,mime:'text/plain'}});if(upload.data?.url)await request('GET',upload.data.url,undefined,false)}
 await request('POST',route,{$multipart:{filename:'oversize.png',base64,size_bytes:11*1024*1024,mime:'image/png'}});
 await request('GET','/uploads/recovery-missing.png',undefined,false);
 const list=name=>baseline.find(x=>x.endpoint==='/api/v1/'+name&&x.method==='GET')?.body?.data?.list||[];const p=list('products')[2],wh=list('warehouses')[0];
 if(!primary||!p||!wh)throw Error('Upload photo integration masters missing');
 const stock=await request('POST','/api/v1/stock-ins',{type:'other',warehouse_id:wh.id,lines:[{product_id:p.id,product_code:p.code,product_name:p.name,qty:1,unit_cost:1}]});if(!stock.data?.id)throw Error('Upload photo stock missing');
 const routeStock='/api/v1/stock-ins/'+stock.data.id;const photos=await request('POST',routeStock+'/photos',{photos:[{url:primary,remark:'真实上传照片'}]});await request('GET',routeStock);if(!photos.data?.[0]?.id)throw Error('Uploaded image photo linking failed');await request('DELETE',routeStock+'/photos/'+photos.data[0].id);await request('GET',primary,undefined,false);
}
