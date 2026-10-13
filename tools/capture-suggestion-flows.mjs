export async function captureSuggestionFlows(request,baseline){
 const route='/api/v1/purchase-suggestions',missing=route+'/00000000-0000-0000-0000-000000000001';
 await request('GET',missing);await request('DELETE',missing);await request('POST',missing+'/convert',{});
 const list=await request('GET',route+'?page_size=100');const suggestions=list.data?.list||[];
 const empty=suggestions.find(x=>x.suggestion_no.endsWith('0001'));
 if(!empty)throw Error('Empty suggestion absent');
 await request('GET',route+'/'+empty.id);await request('POST',route+'/'+empty.id+'/convert',{});await request('GET',route+'/'+empty.id);await request('POST',route+'/'+empty.id+'/convert',{});
 const positive=suggestions.find(x=>x.suggestion_no.endsWith('0003'));if(!positive)throw Error('Positive suggestion absent');
 await request('GET',route+'/'+positive.id);await request('POST',route+'/'+positive.id+'/convert',{});await request('GET',route+'/'+positive.id);await request('POST',route+'/'+positive.id+'/convert',{});
 await request('GET','/api/v1/purchase-orders?page_size=100');await request('GET','/api/v1/purchase-requisitions?page_size=100');
 const other=suggestions.find(x=>x.suggestion_no.endsWith('0004'));
 const collection=name=>baseline.find(x=>x.endpoint==='/api/v1/'+name)?.body?.data?.list||[];
 await request('POST',route+'/'+other.id+'/convert',{supplier_id:collection('suppliers')[0].id,warehouse_id:collection('warehouses')[0].id});
 await request('GET',route+'/'+other.id);await request('GET','/api/v1/purchase-orders?page_size=100');await request('GET','/api/v1/purchase-requisitions?page_size=100');
 await request('DELETE',route+'/'+positive.id);await request('GET',route+'/'+positive.id);await request('DELETE',route+'/'+positive.id);await request('POST',route+'/'+positive.id+'/convert',{});
 await request('GET',route+'?status=converted');await request('GET',route+'?suggestion_no=NOT-FOUND');await request('GET',route+'?page=2&page_size=2');await request('GET',route+'?page_size=100');
}
