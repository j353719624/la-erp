// Runs against the same temporary original instance, after financial capture.
export async function captureProductionFlows(request,baseline){
 const collection=route=>baseline.find(x=>x.method==='GET'&&x.endpoint==='/api/v1/'+route)?.body?.data?.list||[];
 const products=collection('products'),product=products[0],component=products[1],warehouse=collection('warehouses')[0];
 if(!product||!component||!warehouse)throw Error('Production master samples missing');
 const now=new Date().toISOString();
 const receipt=await request('POST','/api/v1/stock-ins',{type:'purchase',warehouse_id:warehouse.id,stock_in_date:now,lines:[{product_id:component.id,unit_id:component.unit_id,qty:20,unit_cost:3}]});
 if(receipt.data?.id)await request('POST','/api/v1/stock-ins/'+receipt.data.id+'/confirm',{});
 const bomInput={code:'RECOVER-BOM-001',product_id:product.id,product_name:product.name,product_code:product.code,version:'1.0',remark:'恢复BOM验证',items:[{product_id:component.id,unit_id:component.unit_id,product_name:component.name,product_code:component.code,qty:2,scrap_rate:0}]};
 const bom=await request('POST','/api/v1/boms',bomInput);
 if(bom.data?.id){const bp='/api/v1/boms/'+bom.data.id;await request('GET',bp);await request('PUT',bp,{...bomInput,remark:'编辑BOM验证',items:bomInput.items.map(x=>({...x,qty:3}))});await request('GET',bp);await request('POST',bp+'/activate',{});await request('GET',bp+'/tree');}
 for(const withBom of [false,true]){
  if(withBom&&!bom.data?.id)continue;
  const input={product_id:product.id,product_name:product.name,product_code:product.code,qty:2,warehouse_id:warehouse.id,priority:'normal',planned_start_date:now,planned_end_date:now,remark:withBom?'有BOM生产验证':'无BOM生产验证',...(withBom?{bom_id:bom.data.id}:{})};
  const wo=await request('POST','/api/v1/work-orders',input);if(!wo.data?.id)continue;
  const wp='/api/v1/work-orders/'+wo.data.id;
  await request('GET',wp);await request('GET',wp+'/bom-items');await request('GET',wp+'/material-availability');await request('GET',wp+'/materials');
  await request('PUT',wp,{...input,remark:'编辑生产工单'});await request('GET',wp);
  await request('POST',wp+'/confirm',{});await request('GET',wp);await request('GET',wp+'/materials');
  await request('POST',wp+'/approve',{});await request('GET',wp);await request('GET',wp+'/materials');
  await request('POST',wp+'/complete',{});await request('GET',wp);await request('POST',wp+'/cancel',{});await request('GET',wp);
  if(withBom){
    const line=(p,qty,cost)=>({product_id:p.id,product_name:p.name,product_code:p.code,qty,unit_cost:cost,batch_no:''});
    async function picking(qty){const x=await request('POST','/api/v1/production-pickings',{work_order_id:wo.data.id,work_order_no:wo.data.order_no,warehouse_id:warehouse.id,picking_date:now,remark:'恢复生产领料验证',lines:[line(component,qty,3)]});if(x.data?.id){const p='/api/v1/production-pickings/'+x.data.id;await request('GET',p);await request('POST',p+'/confirm',{});await request('GET',p);await request('GET',wp+'/materials');await request('GET',wp);await request('GET','/api/v1/inventory-balances?product_id='+component.id);return p;}}
    await picking(3);
    const ret=await request('POST','/api/v1/production-returns',{work_order_id:wo.data.id,work_order_no:wo.data.order_no,warehouse_id:warehouse.id,return_date:now,reason:'excess',remark:'恢复生产退料验证',lines:[line(component,1,3)]});
    if(ret.data?.id){const rp='/api/v1/production-returns/'+ret.data.id;await request('GET',rp);await request('POST',rp+'/confirm',{});await request('GET',wp+'/materials');await request('GET',wp);await request('GET','/api/v1/inventory-balances?product_id='+component.id);}
    await picking(10);await picking(4);
    const beforeComplete=await request('POST','/api/v1/production-receipts',{work_order_id:wo.data.id,work_order_no:wo.data.order_no,warehouse_id:warehouse.id,receipt_date:now,remark:'完工前入库验证',lines:[line(product,2,0)]});
    if(beforeComplete.data?.id){const rp='/api/v1/production-receipts/'+beforeComplete.data.id;await request('GET',rp);await request('POST',rp+'/confirm',{});await request('GET',rp);await request('GET',wp);}
    await request('POST',wp+'/complete',{});await request('GET',wp);
    const receipt=await request('POST','/api/v1/production-receipts',{work_order_id:wo.data.id,work_order_no:wo.data.order_no,warehouse_id:warehouse.id,receipt_date:now,remark:'恢复完工入库验证',lines:[line(product,2,0)]});
    if(receipt.data?.id){const rp='/api/v1/production-receipts/'+receipt.data.id;await request('GET',rp);await request('POST',rp+'/confirm',{});await request('GET',rp);await request('GET',wp);}
  }
  for(const p of [product,component])await request('GET','/api/v1/inventory-balances?product_id='+p.id+'&warehouse_id='+warehouse.id);
 }
 await request('GET','/api/v1/stock-movements?page_size=1000');
  if(bom.data?.id){
    const input={product_id:product.id,product_name:product.name,product_code:product.code,qty:2,bom_id:bom.data.id,warehouse_id:warehouse.id,remark:'生产状态边界验证'};
    const draft=await request('POST','/api/v1/work-orders',input);
    if(draft.data?.id){const p='/api/v1/work-orders/'+draft.data.id;await request('DELETE',p);await request('GET',p);}
    const wo=await request('POST','/api/v1/work-orders',input);
    if(wo.data?.id){
      const wp='/api/v1/work-orders/'+wo.data.id;await request('POST',wp+'/confirm',{});await request('POST',wp+'/approve',{});
      async function createDoc(route,qty,cost){const dateField=route==='production-pickings'?'picking_date':route==='production-returns'?'return_date':'receipt_date';const p=route==='production-receipts'?product:component;return request('POST','/api/v1/'+route,{work_order_id:wo.data.id,work_order_no:wo.data.order_no,warehouse_id:warehouse.id,[dateField]:now,reason:route==='production-returns'?'excess':undefined,remark:'生产扩展验证',lines:[{product_id:p.id,product_name:p.name,product_code:p.code,qty,unit_cost:cost,batch_no:''}]});}
      const deletable=await createDoc('production-pickings',1,3);if(deletable.data?.id){const p='/api/v1/production-pickings/'+deletable.data.id;await request('DELETE',p);await request('GET',p);}
      const pick=await createDoc('production-pickings',3,999);if(pick.data?.id){const p='/api/v1/production-pickings/'+pick.data.id;await request('POST',p+'/confirm',{});await request('POST',p+'/confirm',{});await request('DELETE',p);await request('GET',p);}
      const excess=await createDoc('production-returns',50,3);if(excess.data?.id){const p='/api/v1/production-returns/'+excess.data.id;await request('POST',p+'/confirm',{});await request('DELETE',p);await request('GET',p);}
      const ret=await createDoc('production-returns',1,999);if(ret.data?.id){const p='/api/v1/production-returns/'+ret.data.id;await request('POST',p+'/confirm',{});await request('GET',p);await request('GET',wp);await request('POST',p+'/cancel',{});await request('GET',p);await request('GET',wp);await request('DELETE',p);await request('GET',p);}
      const mats=await request('GET',wp+'/materials');const pending=Number(mats.data?.[0]?.qty_pending)||0;
      if(pending>0){const pick=await createDoc('production-pickings',pending,3);if(pick.data?.id)await request('POST','/api/v1/production-pickings/'+pick.data.id+'/confirm',{});}
      for(const cost of [111,0]){const rec=await createDoc('production-receipts',1,cost);if(rec.data?.id){const p='/api/v1/production-receipts/'+rec.data.id;await request('POST',p+'/confirm',{});await request('GET',p);await request('GET',wp);}}
      const excessReceipt=await createDoc('production-receipts',10,0);if(excessReceipt.data?.id)await request('POST','/api/v1/production-receipts/'+excessReceipt.data.id+'/confirm',{});
      await request('POST',wp+'/complete',{});await request('GET',wp);
    }
  }

  if(bom.data?.id){
    const wo=await request('POST','/api/v1/work-orders',{product_id:product.id,qty:1,bom_id:bom.data.id,warehouse_id:warehouse.id});
    if(wo.data?.id){const wp='/api/v1/work-orders/'+wo.data.id;await request('POST',wp+'/confirm',{});await request('POST',wp+'/approve',{});
      const receipt=await request('POST','/api/v1/production-receipts',{work_order_id:wo.data.id,warehouse_id:warehouse.id,receipt_date:now,lines:[{product_id:product.id,qty:1,unit_cost:0}]});if(receipt.data?.id){const p='/api/v1/production-receipts/'+receipt.data.id;await request('POST',p+'/confirm',{});await request('GET',p);await request('DELETE',p);}
      const picking=await request('POST','/api/v1/production-pickings',{work_order_id:wo.data.id,warehouse_id:warehouse.id,picking_date:now,lines:[{product_id:component.id,qty:1,unit_cost:0}]});if(picking.data?.id){const p='/api/v1/production-pickings/'+picking.data.id;await request('POST',p+'/confirm',{});await request('GET',p);await request('GET',wp);}
      const ret=await request('POST','/api/v1/production-returns',{work_order_id:wo.data.id,warehouse_id:warehouse.id,return_date:now,reason:'excess',lines:[{product_id:component.id,qty:1,unit_cost:0}]});if(ret.data?.id){const p='/api/v1/production-returns/'+ret.data.id;await request('POST',p+'/confirm',{});await request('GET',p);await request('GET',wp);}
      const cancelled=await request('POST','/api/v1/production-returns',{work_order_id:wo.data.id,warehouse_id:warehouse.id,return_date:now,reason:'excess',lines:[{product_id:component.id,qty:1,unit_cost:3}]});if(cancelled.data?.id){const p='/api/v1/production-returns/'+cancelled.data.id;await request('POST',p+'/cancel',{});await request('GET',p);await request('DELETE',p);}
    }
  }
  const center=await request('POST','/api/v1/work-centers',{code:'RECOVER-WC-001',name:'恢复装配中心',capacity:8,efficiency:0.9,cost_rate:12,manager:'恢复验证',status:'active'});
  if(center.data?.id){const cp='/api/v1/work-centers/'+center.data.id;await request('GET',cp);await request('PUT',cp,{name:'恢复工作中心编辑',capacity:10,cost_rate:15});await request('GET',cp);}
  const routing=await request('POST','/api/v1/routings',{code:'RECOVER-ROUTE-001',name:'恢复工艺路线',product_id:product.id,product_name:product.name,product_code:product.code,version:'1.0',steps:[{sequence:1,process_code:'ASSEMBLE',process_name:'装配',work_center:'恢复装配中心',work_center_id:center.data?.id,standard_time:2,setup_time:1,teardown_time:0}]});
  if(routing.data?.id){const rp='/api/v1/routings/'+routing.data.id;await request('GET',rp);await request('PUT',rp,{remark:'仅编辑工艺路线备注'});await request('GET',rp);}

  const flowInput={product_id:product.id,product_name:product.name,product_code:product.code,version:'1.0',steps:[1,2].map(sequence=>({sequence,process_code:'OP'+sequence,process_name:'工序'+sequence,work_center:'恢复中心',work_center_id:center.data?.id,standard_time:2,setup_time:1}))};
  const flow=await request('POST','/api/v1/routings',flowInput);
  if(flow.data?.id){
    await request('GET','/api/v1/routings/'+flow.data.id);
    const wo=await request('POST','/api/v1/work-orders',{product_id:product.id,qty:2,routing_id:flow.data.id,warehouse_id:warehouse.id,remark:'工序报工恢复验证'});
    if(wo.data?.id){
      const wp='/api/v1/work-orders/'+wo.data.id;
      await request('GET',wp);await request('POST',wp+'/confirm',{});await request('GET',wp);await request('POST',wp+'/approve',{});
      const detail=await request('GET',wp);
      let processes=detail.data?.edges?.processes||[];
      if(!processes.length){const list=await request('GET','/api/v1/work-order-processes?work_order_id='+wo.data.id+'&page_size=100');processes=list.data?.list||[];}
      await request('POST',wp+'/complete',{});await request('GET',wp);
      for(const step of processes){
        const pp='/api/v1/work-order-processes/'+step.id;
        await request('POST',pp+'/start',{operator_name:'恢复操作员'});await request('GET',wp);
        await request('POST',pp+'/complete',{operator_name:'恢复操作员',qty_good:2,qty_bad:0,actual_time:30,labor_rate:12});await request('GET',wp);
        await request('POST',pp+'/complete',{qty_good:2,qty_bad:0,actual_time:30,labor_rate:12});
        await request('POST',pp+'/revert',{});await request('GET',wp);
        await request('POST',pp+'/complete',{qty_good:1,qty_bad:1,actual_time:60,labor_rate:12});await request('GET',wp);
      }
      await request('POST',wp+'/complete',{});await request('GET',wp);
    }
  }

  if(flow.data?.id){
    const wo=await request('POST','/api/v1/work-orders',{product_id:product.id,qty:2,routing_id:flow.data.id,warehouse_id:warehouse.id});
    if(wo.data?.id){const wp='/api/v1/work-orders/'+wo.data.id;const processes=wo.data.edges?.processes||[];
      if(processes.length){const first='/api/v1/work-order-processes/'+processes[0].id;const last='/api/v1/work-order-processes/'+processes.at(-1).id;
        await request('POST',first+'/complete',{qty_good:2,qty_bad:0,actual_time:10,labor_rate:3});await request('POST',first+'/start',{});await request('GET',wp);
        await request('POST',wp+'/confirm',{});await request('POST',wp+'/approve',{});await request('POST',last+'/start',{});await request('GET',wp);
        await request('GET','/api/v1/work-order-processes?work_order_id='+wo.data.id+'&page_size=100');await request('GET','/api/v1/work-order-processes/pending?work_order_no='+wo.data.order_no+'&page_size=100');await request('GET','/api/v1/work-order-processes/stats');
        await request('POST',first+'/start',{});await request('POST',first+'/start',{});await request('POST',first+'/complete',{qty_good:5,qty_bad:1,actual_time:10,labor_rate:3});await request('GET',wp);
        await request('POST',first+'/complete',{qty_good:1,qty_bad:1,actual_time:10,labor_rate:3});await request('GET',wp);
        await request('POST',last+'/complete',{qty_good:-1,qty_bad:0,actual_time:10,labor_rate:3});await request('POST',last+'/complete',{qty_good:2,qty_bad:0,actual_time:10,labor_rate:3});await request('GET',wp);
        await request('POST',wp+'/complete',{});await request('POST',first+'/revert',{});await request('GET',wp);
      }
    }
  }

}
