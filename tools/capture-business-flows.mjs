// Uses only the isolated temporary original instance supplied by capture-backend.
export async function captureBusinessFlows(request, baseline) {
  const collection = route => baseline.find(x => x.method === 'GET' && x.endpoint === '/api/v1/' + route)?.body?.data?.list || [];
  const product = collection('products')[0], warehouse = collection('warehouses')[0], supplier = collection('suppliers')[0];
  if (!product || !warehouse || !supplier) throw Error('Original demo master records missing');
  const now = new Date().toISOString();
  const stockLine = (qty, cost) => ({ line_no: 1, product_id: product.id, unit_id: product.unit_id, qty, unit_cost: cost });
  async function inventory() {
    return request('GET', `/api/v1/inventory-balances?product_id=${product.id}&warehouse_id=${warehouse.id}`);
  }
  async function incoming(qty, cost) {
    const create = await request('POST', '/api/v1/stock-ins', { type: 'purchase', warehouse_id: warehouse.id, stock_in_date: now, lines: [stockLine(qty, cost)] });
    if (!create.data?.id) throw Error('Original stock-in create failed');
    await request('GET', '/api/v1/stock-ins/' + create.data.id);
    await request('POST', '/api/v1/stock-ins/' + create.data.id + '/confirm', {});
    await request('GET', '/api/v1/stock-ins/' + create.data.id);
    await request('POST', '/api/v1/stock-ins/' + create.data.id + '/confirm', {});
    return create.data;
  }
  await request('POST', '/api/v1/stock-ins', {});
  await incoming(10, 12.5);
  let balance = (await inventory()).data?.list?.[0];
  if (!balance) throw Error('Original stock-in confirmation did not create inventory balance');
  await request('POST', '/api/v1/inventory-balances/' + balance.id + '/lock', { qty: 3 });
  await inventory();
  const large = await request('POST', '/api/v1/stock-outs', { type: 'sales', warehouse_id: warehouse.id, stock_out_date: now, lines: [stockLine(8, 0)] });
  if (large.data?.id) await request('POST', '/api/v1/stock-outs/' + large.data.id + '/confirm', {});
  await request('POST', '/api/v1/inventory-balances/' + balance.id + '/unlock', { qty: 3 });
  await inventory();
  const outgoing = await request('POST', '/api/v1/stock-outs', { type: 'sales', warehouse_id: warehouse.id, stock_out_date: now, lines: [stockLine(4, 0)] });
  if (!outgoing.data?.id) throw Error('Original stock-out create failed');
  await request('POST', '/api/v1/stock-outs/' + outgoing.data.id + '/confirm', {});
  await request('GET', '/api/v1/stock-outs/' + outgoing.data.id);
  await request('POST', '/api/v1/stock-outs/' + outgoing.data.id + '/confirm', {});
  await inventory();
  await incoming(4, 20);
  await inventory();
  await request('GET', '/api/v1/stock-movements?product_id=' + product.id);
  await request('GET', '/api/v1/products');
  await request('POST', '/api/v1/stock-ins', { type: 'purchase', warehouse_id: warehouse.id, stock_in_date: now, lines: [stockLine(-1, 12.5)] });
  await request('POST', '/api/v1/stock-ins', { type: 'purchase', warehouse_id: warehouse.id, stock_in_date: now, lines: [] });
  const customer = await request('POST', '/api/v1/customers', { code: 'recovery-business-customer', name: '恢复业务验证客户' });
  await request('GET', '/api/v1/customers');
  const orderLine = { line_no: 1, product_id: product.id, product_name: product.name, product_code: product.code, unit_id: product.unit_id, qty: 2, quantity: 2, price: 30, tax_rate: 13, discount_rate: 0 };
  const sales = await request('POST', '/api/v1/sales-orders', { customer_id: customer.data?.id, warehouse_id: warehouse.id, order_date: now, currency: 'CNY', lines: [orderLine] });
  if (sales.data?.id) {
    await request('GET', '/api/v1/sales-orders/' + sales.data.id);
    await request('POST', '/api/v1/sales-orders/' + sales.data.id + '/confirm', {});
    await request('GET', '/api/v1/sales-orders/' + sales.data.id);
    await inventory();
    await request('POST', '/api/v1/sales-orders/' + sales.data.id + '/confirm', {});
    await request('POST', '/api/v1/sales-orders/' + sales.data.id + '/cancel', {});
    await request('GET', '/api/v1/sales-orders/' + sales.data.id);
    await inventory();
  }
  const purchase = await request('POST', '/api/v1/purchase-orders', { supplier_id: supplier.id, warehouse_id: warehouse.id, order_date: now, currency: 'CNY', lines: [{ ...orderLine, qty: 3, quantity: 3, price: 17, tax_rate: 0 }] });
  if (purchase.data?.id) {
    await request('GET', '/api/v1/purchase-orders/' + purchase.data.id);
    await request('POST', '/api/v1/purchase-orders/' + purchase.data.id + '/confirm', {});
    await request('GET', '/api/v1/purchase-orders/' + purchase.data.id);
    await request('POST', '/api/v1/purchase-orders/' + purchase.data.id + '/cancel', {});
    await request('GET', '/api/v1/purchase-orders/' + purchase.data.id);
  }
  // Editing and deletion: record behavior rather than guessing from route names.
  for (const route of ['stock-ins', 'stock-outs', 'sales-orders', 'purchase-orders']) {
    const stock = route.startsWith('stock-'), incoming = route === 'stock-ins';
    const input = stock
      ? { type: incoming ? 'purchase' : 'sales', warehouse_id: warehouse.id, [incoming ? 'stock_in_date' : 'stock_out_date']: now, lines: [stockLine(1, 2)] }
      : { [route === 'sales-orders' ? 'customer_id' : 'supplier_id']: route === 'sales-orders' ? customer.data.id : supplier.id, warehouse_id: warehouse.id, order_date: now, currency: 'CNY', lines: [{ ...orderLine, qty: 1, price: 10, tax_rate: 13 }] };
    const create = await request('POST', '/api/v1/' + route, input);
    if (!create.data?.id) throw Error('Editing sample create failed: ' + route);
    const path = '/api/v1/' + route + '/' + create.data.id;
    const changed = { ...input, remark: '恢复编辑验证', lines: input.lines.map(line => ({ ...line, qty: 3, unit_cost: stock ? 7 : undefined, price: stock ? undefined : 25 })) };
    await request('PUT', path, changed);
    await request('GET', path);
    await request('PUT', path, { remark: '仅修改备注' });
    await request('GET', path);
    await request('DELETE', path);
    await request('GET', path);
    const confirmed = await request('POST', '/api/v1/' + route, input);
    if (!confirmed.data?.id) throw Error('Confirmed editing sample create failed: ' + route);
    const confirmedPath = '/api/v1/' + route + '/' + confirmed.data.id;
    await request('POST', confirmedPath + '/confirm', {});
    await request('PUT', confirmedPath, changed);
    await request('DELETE', confirmedPath);
    await request('GET', confirmedPath);
  }
  for (const discount of [3, 50]) {
    await request('POST', '/api/v1/sales-orders', { customer_id: customer.data.id, currency: 'CNY', lines: [{ ...orderLine, qty: 2, price: 30, tax_rate: 13, discount }] });
  }
  // Original UI uses stock-ins/outs with source_id/source_no for order fulfillment.
  const linkedOrderLine = { ...orderLine, qty: 5, price: 18, tax_rate: 13 };
  const linkedPurchase = await request('POST', '/api/v1/purchase-orders', { supplier_id: supplier.id, warehouse_id: warehouse.id, order_date: now, currency: 'CNY', lines: [linkedOrderLine] });
  if (!linkedPurchase.data?.id) throw Error('Linked purchase sample missing');
  const purchasePath = '/api/v1/purchase-orders/' + linkedPurchase.data.id;
  await request('POST', purchasePath + '/confirm', {});
  await request('POST', purchasePath + '/approve', {});
  await request('GET', purchasePath);
  await request('GET', '/api/v1/ap-invoices');
  async function linkedStock(route, order, qty, cost) {
    const incoming = route === 'stock-ins';
    const created = await request('POST', '/api/v1/' + route, { type: incoming ? 'purchase' : 'sales', warehouse_id: warehouse.id, source_id: order.id, source_no: order.order_no, [incoming ? 'stock_in_date' : 'stock_out_date']: now, lines: [{ ...stockLine(qty, cost), batch_no: '', serial_nos: [] }] });
    if (!created.data?.id) return;
    const path = '/api/v1/' + route + '/' + created.data.id;
    await request('POST', path + '/confirm', {});
    await request('GET', path);
    await request('GET', (incoming ? '/api/v1/purchase-orders/' : '/api/v1/sales-orders/') + order.id);
    await inventory();
  }
  await linkedStock('stock-ins', linkedPurchase.data, 2, 18);
  await linkedStock('stock-ins', linkedPurchase.data, 10, 18);
  await linkedStock('stock-ins', linkedPurchase.data, 3, 18);
  await request('GET', '/api/v1/ap-invoices');
  const linkedSales = await request('POST', '/api/v1/sales-orders', { customer_id: customer.data.id, warehouse_id: warehouse.id, order_date: now, currency: 'CNY', lines: [{ ...linkedOrderLine, qty: 4, price: 31 }] });
  if (!linkedSales.data?.id) throw Error('Linked sales sample missing');
  const salesPath = '/api/v1/sales-orders/' + linkedSales.data.id;
  await request('POST', salesPath + '/confirm', {});
  await request('POST', salesPath + '/approve', {});
  await request('GET', salesPath);
  await inventory();
  await request('GET', '/api/v1/ar-invoices');
  await linkedStock('stock-outs', linkedSales.data, 2, 0);
  await linkedStock('stock-outs', linkedSales.data, 3, 0);
  await linkedStock('stock-outs', linkedSales.data, 2, 0);
  await request('GET', '/api/v1/ar-invoices');
  await request('POST', salesPath + '/cancel', {});
  await request('GET', salesPath);
  await request('GET', '/api/v1/stock-movements?product_id=' + product.id);
  for (const [route, order, party, price] of [
    ['sales-returns', linkedSales.data, customer.data, 31],
    ['purchase-returns', linkedPurchase.data, supplier, 18],
  ]) {
    const sales = route === 'sales-returns', sourceRoute = sales ? 'sales-orders' : 'purchase-orders';
    const input = qty => ({ [sales ? 'customer_id' : 'supplier_id']: party.id, warehouse_id: warehouse.id, [sales ? 'sales_order_id' : 'purchase_order_id']: order.id, [sales ? 'sales_order_no' : 'purchase_order_no']: order.order_no, order_date: now, currency: 'CNY', remark: '恢复退货验证', lines: [{ ...orderLine, qty, price, tax_rate: 13 }] });
    const created = await request('POST', '/api/v1/' + route, input(1));
    if (!created.data?.id) throw Error('Return sample missing: ' + route);
    const path = '/api/v1/' + route + '/' + created.data.id;
    await request('GET', path);
    await request('POST', path + '/confirm', {});
    await inventory();
    await request('GET', '/api/v1/' + sourceRoute + '/' + order.id);
    await request('POST', path + '/approve', {});
    await request('GET', path);
    await inventory();
    await request('GET', '/api/v1/' + sourceRoute + '/' + order.id);
    await request('POST', path + '/approve', {});
    await request('POST', path + '/cancel', {});
    const excess = await request('POST', '/api/v1/' + route, input(10));
    if (excess.data?.id) {
      await request('POST', '/api/v1/' + route + '/' + excess.data.id + '/confirm', {});
      await request('POST', '/api/v1/' + route + '/' + excess.data.id + '/approve', {});
    }
    await inventory();
    await request('GET', '/api/v1/stock-movements?product_id=' + product.id);
  }
  const accounts = collection('accounts');
  const cash = accounts.find(x => x.code === '1001') || accounts[0];
  if (!cash) throw Error('Cash account sample missing');
  const date = now.slice(0, 10);
  for (const [invoiceRoute, paymentRoute, party] of [['ar-invoices', 'payment-receipts', customer.data], ['ap-invoices', 'payments', supplier]]) {
    const receipt = paymentRoute === 'payment-receipts';
    const invoiceInput = { [receipt ? 'customer_id' : 'supplier_id']: party.id, [receipt ? 'customer_name' : 'supplier_name']: party.name, invoice_date: date, due_date: date, total_amount: 100, remark: '恢复核销验证' };
    let invoice = await request('POST', '/api/v1/' + invoiceRoute, invoiceInput);
    if (!invoice.data?.id) invoice = await request('POST', '/api/v1/' + invoiceRoute, { ...invoiceInput, invoice_date: now, due_date: now });
    if (!invoice.data?.id) throw Error('Financial invoice sample missing: ' + invoiceRoute);
    const invoicePath = '/api/v1/' + invoiceRoute + '/' + invoice.data.id;
    await request('GET', invoicePath);
    async function pay(amount) {
      const paymentInput = { [receipt ? 'customer_id' : 'supplier_id']: party.id, [receipt ? 'customer_name' : 'supplier_name']: party.name, [receipt ? 'receipt_date' : 'payment_date']: date, amount, [receipt ? 'receipt_type' : 'payment_type']: 'normal', currency_code: 'CNY', cash_account_id: cash.id, cash_account_code: cash.code, cash_account_name: cash.name, lines: [{ line_no: 1, [receipt ? 'ar_invoice_id' : 'ap_invoice_id']: invoice.data.id, [receipt ? 'ar_invoice_no' : 'ap_invoice_no']: invoice.data.invoice_no, amount }] };
      let p = await request('POST', '/api/v1/' + paymentRoute, paymentInput);
      if (!p.data?.id) p = await request('POST', '/api/v1/' + paymentRoute, { ...paymentInput, [receipt ? 'receipt_date' : 'payment_date']: now });
      if (p.data?.id) {
        const path = '/api/v1/' + paymentRoute + '/' + p.data.id;
        await request('GET', path);
        await request('POST', path + '/confirm', {});
        await request('GET', invoicePath);
        await request('GET', '/api/v1/accounts/' + cash.id + '/balance');
        return path;
      }
    }
    const first = await pay(40);
    await pay(70);
    const second = await pay(60);
    if (second) { await request('POST', second + '/cancel', {}); await request('GET', invoicePath); }
    if (first) { await request('POST', first + '/cancel', {}); await request('GET', invoicePath); }
    await request('GET', '/api/v1/accounts/' + cash.id + '/balance');
  }
  // Additional invoice lifecycle and draft payment deletion, isolated from the
  // 225-request baseline above so its accounting checkpoint remains comparable.
  for (const [invoiceRoute,paymentRoute,party] of [['ar-invoices','payment-receipts',customer.data],['ap-invoices','payments',supplier]]) {
    const receipt=paymentRoute==='payment-receipts', partyField=receipt?'customer':'supplier';
    await request('GET','/api/v1/'+paymentRoute);
    const inv=await request('POST','/api/v1/'+invoiceRoute,{[partyField+'_id']:party.id,[partyField+'_name']:party.name,invoice_date:now,total_amount:50,remark:'恢复开票编辑验证'});
    if (!inv.data?.id) throw Error('Additional invoice missing');
    const ip='/api/v1/'+invoiceRoute+'/'+inv.data.id;
    await request('PUT',ip,{remark:'仅更新应收应付备注'});
    await request('GET',ip);
    await request('PUT',ip,{total_amount:80,remark:'修改应收应付金额'});
    await request('GET',ip);
    await request('POST',ip+'/issue',{[receipt?'sales_invoice_no':'purchase_invoice_no']:'REBUILD-INVOICE-001',invoice_date:now,tax_rate:13,tax_amount:10.4,status:'invoiced'});
    await request('GET',ip);
    await request('POST',ip+'/issue',{[receipt?'sales_invoice_no':'purchase_invoice_no']:'REBUILD-INVOICE-002',tax_rate:13});
    await request('GET',ip);
    const pay=await request('POST','/api/v1/'+paymentRoute,{[partyField+'_id']:party.id,[partyField+'_name']:party.name,[receipt?'receipt_date':'payment_date']:now,amount:5,[receipt?'receipt_type':'payment_type']:'normal',currency_code:'CNY',cash_account_id:cash.id,cash_account_code:cash.code,cash_account_name:cash.name,lines:[{[receipt?'ar_invoice_id':'ap_invoice_id']:inv.data.id,amount:5}]});
    if (!pay.data?.id) throw Error('Draft payment missing');
    const pp='/api/v1/'+paymentRoute+'/'+pay.data.id;
    await request('POST',pp+'/cancel',{}); await request('GET',pp);
    await request('DELETE',pp);await request('GET',pp);
    await request('DELETE',ip);await request('GET',ip);
    await request('GET','/api/v1/'+paymentRoute);
  }
  const voucherInput={type:'general',voucher_date:now,remark:'恢复手工凭证验证',entries:[{sequence:1,account_code:cash.code,account_name:cash.name,direction:'debit',amount:25},{sequence:2,account_code:'1122',account_name:'应收账款',direction:'credit',amount:25}]};
  let voucher=await request('POST','/api/v1/vouchers',voucherInput);
  if (!voucher.data?.id) { const receivable=accounts.find(x=>x.code==='1122');voucherInput.total_debit=25;voucherInput.total_credit=25;voucherInput.entries[0].account_id=cash.id;voucherInput.entries[1].account_id=receivable?.id;voucher=await request('POST','/api/v1/vouchers',voucherInput); }
  if(voucher.data?.id){
    const vp='/api/v1/vouchers/'+voucher.data.id;
    await request('GET',vp);await request('PUT',vp,{...voucherInput,remark:'编辑手工凭证'});await request('GET',vp);
    await request('POST',vp+'/post',{});await request('GET',vp);
    await request('POST',vp+'/approve?approver_id='+voucher.data.id,{});await request('GET',vp);
    await request('POST',vp+'/post',{});await request('GET',vp);
    await request('POST',vp+'/cancel',{});await request('GET',vp);await request('DELETE',vp);await request('GET',vp);
  }

  if (voucher.data?.id) {
    const approveFirst=await request('POST','/api/v1/vouchers',voucherInput);
    if(approveFirst.data?.id){const vp='/api/v1/vouchers/'+approveFirst.data.id;await request('POST',vp+'/approve',{});await request('POST',vp+'/post',{});await request('POST',vp+'/cancel',{});await request('GET',vp);}
    const postedCancel=await request('POST','/api/v1/vouchers',voucherInput);
    if(postedCancel.data?.id){const vp='/api/v1/vouchers/'+postedCancel.data.id;await request('POST',vp+'/post',{});await request('POST',vp+'/post',{});await request('POST',vp+'/cancel',{});await request('GET',vp);await request('GET','/api/v1/accounts/'+cash.id+'/balance');}
  }

}
