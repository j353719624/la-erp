export async function captureUnitFlows(request,baseline){
 const list=name=>baseline.find(x=>x.endpoint==='/api/v1/'+name&&x.method==='GET')?.body?.data?.list||[];
 const product=list('products')[2],other=list('products')[1],wh=list('warehouses')[0];if(!product||!other||!wh)throw Error('Unit probe masters missing');
 const unit=await request('POST','/api/v1/units',{code:'RECOVER-BOX',name:'恢复箱单位',is_base:false});if(!unit.data?.id)throw Error('Unit probe box missing');
 const path='/api/v1/products/'+product.id+'/unit-conversions';await request('GET',path);
 for(const rate of [0,-1])await request('POST',path,{unit_id:unit.data.id,rate});
 const conversion=await request('POST',path,{unit_id:unit.data.id,rate:10,remark:'箱十件'});if(!conversion.data?.id)throw Error('Unit conversion probe failed');
 const cp=path+'/'+conversion.data.id;await request('GET',path);await request('POST',path,{unit_id:unit.data.id,rate:5});await request('PUT',cp,{rate:0});await request('PUT',cp,{rate:12,remark:'箱十二件'});await request('GET',path);await request('PUT',cp,{rate:10});
 const stock=await request('POST','/api/v1/stock-ins',{type:'other',warehouse_id:wh.id,lines:[{product_id:product.id,unit_id:unit.data.id,qty:2,unit_cost:100}]});if(stock.data?.id){await request('GET','/api/v1/stock-ins/'+stock.data.id);await request('POST','/api/v1/stock-ins/'+stock.data.id+'/confirm',{});await request('GET','/api/v1/stock-ins/'+stock.data.id);await request('GET','/api/v1/inventory-balances?product_id='+product.id)}
 const out=await request('POST','/api/v1/stock-outs',{warehouse_id:wh.id,lines:[{product_id:product.id,unit_id:unit.data.id,qty:1}]});if(out.data?.id){await request('POST','/api/v1/stock-outs/'+out.data.id+'/confirm',{});await request('GET','/api/v1/stock-outs/'+out.data.id);await request('GET','/api/v1/inventory-balances?product_id='+product.id)}
 await request('POST',path,{unit_id:product.unit_id,rate:1});await request('GET',path);
 await request('DELETE',cp);await request('GET',path);await request('DELETE',cp);
 await request('GET','/api/v1/stock-movements?product_id='+product.id+'&page_size=1000');
}
