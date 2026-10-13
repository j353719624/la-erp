export async function captureMappingFlows(request,baseline){
 const route='/api/v1/account-mappings';await request('GET',route);
 const leaf=await request('POST','/api/v1/accounts',{code:'REC-MAPPING-LEAF',name:'恢复映射费用',category:'expense',is_leaf:true,is_enabled:true,currency:'CNY'});
 const parent=await request('POST','/api/v1/accounts',{code:'REC-MAPPING-PARENT',name:'恢复映射父级',category:'expense',is_leaf:false,is_enabled:true,currency:'CNY'});
 const disabled=await request('POST','/api/v1/accounts',{code:'REC-MAPPING-DISABLED',name:'恢复映射禁用科目',category:'expense',is_leaf:true,is_enabled:false,currency:'CNY'});
 if(!leaf.data?.id||!parent.data?.id||!disabled.data?.id)throw Error('Mapping accounts missing');
 const tree=baseline.find(x=>x.endpoint==='/api/v1/accounts/tree')?.body?.data||[];const flatten=rows=>rows.flatMap(x=>[x,...flatten(x.edges?.children||[])]);const expenseDefault=flatten(tree).find(x=>x.code==='6602');if(!expenseDefault)throw Error('Default expense account missing');
 for(const items of [undefined,{unknown:leaf.data.id},{expense:expenseDefault.id},{expense:leaf.data.id},{salary:leaf.data.id},{expense:leaf.data.id,salary:'00000000-0000-0000-0000-000000000001'},{expense:'00000000-0000-0000-0000-000000000001'},{expense:parent.data.id},{expense:disabled.data.id},{expense:'',salary:''},{expense:leaf.data.id}]){
  await request('PUT',route,items===undefined?{}:{items});await request('GET',route);
 }
 await request('DELETE','/api/v1/accounts/'+leaf.data.id);await request('GET',route);await request('PUT',route,{items:{expense:''}});await request('GET',route);
}
