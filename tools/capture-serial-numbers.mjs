export async function captureSerialNumbers(request){
 const products=(await request('GET','/api/v1/products?page_size=100')).data.list;const product=products.find(x=>x.code==='REC-DUP-FIN');const warehouse=(await request('GET','/api/v1/warehouses')).data.list[0];
 const body=serial_nos=>({product_id:product.id,product_code:product.code,product_name:product.name,warehouse_id:warehouse.id,warehouse_name:warehouse.name,serial_nos,source_type:'manual',source_no:'REC-SN-SOURCE',remark:'recovery probe'});
 await request('POST','/api/v1/serial-numbers',body(['REC-SN-001','REC-SN-002','REC-SN-003']));
 const list=(await request('GET','/api/v1/serial-numbers?page_size=100')).data.list;const a=list.find(x=>x.serial_no==='REC-SN-001'),b=list.find(x=>x.serial_no==='REC-SN-002');if(!a||!b)throw Error('Serial registration missing');
 await request('GET',`/api/v1/serial-numbers/${a.id}`);await request('POST',`/api/v1/serial-numbers/${a.id}/out`,{});await request('POST',`/api/v1/serial-numbers/${a.id}/out`,{});await request('POST',`/api/v1/serial-numbers/${a.id}/scrap`,{});
 await request('POST',`/api/v1/serial-numbers/${b.id}/scrap`,{});await request('POST',`/api/v1/serial-numbers/${b.id}/scrap`,{});await request('POST',`/api/v1/serial-numbers/${b.id}/out`,{});
 await request('POST','/api/v1/serial-numbers',body(['REC-SN-003','REC-SN-004']));await request('POST','/api/v1/serial-numbers',body(['REC-SN-005','REC-SN-005']));await request('POST','/api/v1/serial-numbers',body([]));
 await request('GET','/api/v1/serial-numbers?status=in_stock&page_size=100');await request('GET','/api/v1/serial-numbers?keyword=REC-SN-001&page_size=100');
 for(const action of ['out','scrap'])await request('POST','/api/v1/serial-numbers/00000000-0000-0000-0000-000000000001/'+action,{});
 await request('POST','/api/v1/serial-numbers',{});
 await request('POST','/api/v1/serial-numbers',{serial_nos:['REC-SN-006']});
 await request('POST','/api/v1/serial-numbers',body([' REC-SN-007 ','','  ']));
 await request('POST','/api/v1/serial-numbers',body(['REC-SN-008','REC-SN-003']));
 await request('GET','/api/v1/serial-numbers?page_size=100');

}
