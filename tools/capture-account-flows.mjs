export async function captureAccountFlows(request,baseline){
 const route='/api/v1/accounts';
 await request('POST',route,{});await request('POST',route,{code:'REC-ACCOUNT-NONAME'});await request('POST',route,{name:'缺少编码'});
 await request('POST',route,{code:'REC-ACCOUNT-BAD',name:'无效类别',category:'invalid'});
 const minimal=await request('POST',route,{code:'REC-ACCOUNT-MIN',name:'最少科目字段'});if(!minimal.data?.id)throw Error('Minimal account missing');await request('GET',route+'/'+minimal.data.id);await request('DELETE',route+'/'+minimal.data.id);
 const parent=await request('POST',route,{code:'REC-ACCOUNT',name:'恢复科目父级',category:'asset',is_leaf:false,currency:'CNY',remark:'父级说明'});if(!parent.data?.id)throw Error('Account parent missing');const p=route+'/'+parent.data.id;
 await request('GET',p);await request('POST',route,{code:'REC-ACCOUNT',name:'重复编码',category:'asset'});
 const child=await request('POST',route,{code:'REC-ACCOUNT-01',name:'恢复科目子级',category:'asset',parent_id:parent.data.id,currency:'CNY',is_leaf:true,is_enabled:true});if(!child.data?.id)throw Error('Account child missing');const c=route+'/'+child.data.id;
 await request('GET',c);await request('GET',p);await request('GET',route+'/tree');await request('PUT',p,{is_enabled:true});await request('GET',route+'/tree');await request('PUT',p,{is_enabled:false});await request('GET',route+'/tree');await request('DELETE',p);await request('GET',p);
 await request('PUT',c,{name:'恢复科目修改',remark:'科目备注'});await request('GET',c);await request('PUT',c,{is_enabled:false});await request('GET',c);await request('PUT',c,{is_enabled:true,code:'REC-ACCOUNT-02',currency:'CNY'});await request('GET',c);
 await request('PUT',c,{category:'expense',sub_category:'recovery-sub',currency:'USD',is_leaf:false,parent_id:null,remark:null,code:'REC-ACCOUNT-IGNORED'});await request('GET',c);
 await request('GET',c+'/balance');await request('DELETE',c);await request('GET',c);await request('DELETE',c);await request('DELETE',p);await request('GET',p);await request('POST',route,{code:'REC-ACCOUNT',name:'已删编码再建',category:'asset'});
 await request('POST',route,{code:'REC-ACCOUNT-INVALID-PARENT',name:'无效父级',parent_id:'00000000-0000-0000-0000-000000000001'});
 const accounts=baseline.find(x=>x.endpoint===route&&x.method==='GET')?.body?.data?.list||[];const cash=accounts.find(x=>x.code==='1001');if(!cash)throw Error('Existing account missing');await request('DELETE',route+'/'+cash.id);await request('GET',route+'/'+cash.id);
}
