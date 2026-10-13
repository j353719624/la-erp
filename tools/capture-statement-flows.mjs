// Cross-month statements against the packaged original, in its disposable DB.
export async function captureStatementFlows(request, baseline) {
  const accounts = baseline.find(x => x.endpoint === '/api/v1/accounts' && x.method === 'GET')?.body?.data;
  const cash = (Array.isArray(accounts) ? accounts : accounts?.list || []).find(x => x.code === '1001');
  if (!cash) throw Error('Statement cash account missing');
  for (const customer of [true, false]) {
    const party = customer ? 'customer' : 'supplier';
    const created = await request('POST', '/api/v1/' + party + 's', {name:'恢复跨月对账' + party, code:'REC-STMT-' + party});
    if (!created.data?.id) throw Error('Statement party missing');
    const id = created.data.id;
    const report = '/api/v1/reports/finance/statement/' + party;
    const invoiceRoute = customer ? 'ar-invoices' : 'ap-invoices';
    const paymentRoute = customer ? 'payment-receipts' : 'payments';
    const query = async () => {
      for (const suffix of ['', '?'+party+'_id='+id, '?'+party+'_id='+id+'&start_date=2026-02-01&end_date=2026-03-31', '?'+party+'_id='+id+'&start_date=2026-03-01&end_date=2026-03-31', '?'+party+'_id='+id+'&start_date=2026-04-01&end_date=2026-04-30', '?'+party+'_id=00000000-0000-0000-0000-000000000001']) await request('GET', report+suffix);
    };
    await query();
    const invoices = [];
    for (const [month,amount] of [['01',120],['02',80],['04',30]]) {
      const inv = await request('POST', '/api/v1/'+invoiceRoute, {[party+'_id']:id,[party+'_name']:created.data.name,invoice_date:'2026-'+month+'-10T09:00:00Z',total_amount:amount,remark:'跨月对账验证'});
      if (!inv.data?.id) throw Error('Statement invoice missing');
      invoices.push(inv.data);
    }
    await query();
    const pay = await request('POST','/api/v1/'+paymentRoute,{[party+'_id']:id,[party+'_name']:created.data.name,[customer?'receipt_date':'payment_date']:'2026-03-12T09:00:00Z',amount:50,[customer?'receipt_type':'payment_type']:'normal',currency_code:'CNY',cash_account_id:cash.id,cash_account_code:cash.code,cash_account_name:cash.name,lines:[{[customer?'ar_invoice_id':'ap_invoice_id']:invoices[0].id,[customer?'ar_invoice_no':'ap_invoice_no']:invoices[0].invoice_no,amount:50}]});
    if(!pay.data?.id) throw Error('Statement payment missing');
    await query();
    await request('POST','/api/v1/'+paymentRoute+'/'+pay.data.id+'/confirm',{});
    await query();
    await request('POST','/api/v1/'+paymentRoute+'/'+pay.data.id+'/cancel',{});
    await query();
    await request('DELETE','/api/v1/'+invoiceRoute+'/'+invoices[2].id);
    await query();
    // Insert an older invoice after newer ones to identify original line order.
    const older=await request('POST','/api/v1/'+invoiceRoute,{[party+'_id']:id,[party+'_name']:created.data.name,invoice_date:'2025-12-10T09:00:00Z',total_amount:40});
    if(!older.data?.id)throw Error('Backdated statement invoice missing');
    const early=await request('POST','/api/v1/'+paymentRoute,{[party+'_id']:id,[party+'_name']:created.data.name,[customer?'receipt_date':'payment_date']:'2026-01-15T09:00:00Z',amount:25,[customer?'receipt_type':'payment_type']:'normal',currency_code:'CNY',cash_account_id:cash.id,cash_account_code:cash.code,cash_account_name:cash.name,lines:[{[customer?'ar_invoice_id':'ap_invoice_id']:older.data.id,[customer?'ar_invoice_no':'ap_invoice_no']:older.data.invoice_no,amount:25}]});
    if(!early.data?.id)throw Error('Opening payment missing');
    await request('POST','/api/v1/'+paymentRoute+'/'+early.data.id+'/confirm',{});
    await query();
    await request('GET',report+'?'+party+'_id='+id+'&end_date=2026-01-31');
    await request('GET',report+'?'+party+'_id='+id+'&start_date=2026-02-01');
  }
}
