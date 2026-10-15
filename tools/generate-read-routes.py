"""Derive read-only SQL resources from actual original paginated responses."""
import json,pathlib
root=pathlib.Path(__file__).resolve().parent.parent
records=json.loads((root/'evidence/backend-runtime/api-contracts.json').read_text(encoding='utf8'))
tables={x['name'] for x in json.loads((root/'evidence/backend-runtime/database-schema.json').read_text(encoding='utf8'))}
aliases={'bank/statements':'bank_statements','payrolls':'payroll_batches','piecework-rates':'piece_rates','inventory-adjusts':'stock_adjusts','consignments':'consignment_orders','metadata/entities':'entity_defs','purchase-rfqs':'purchase_rf_qs','sales-commissions/settlements':'commission_settlements','spus':'product_spus','assemblies':'assembly_orders','mrp/requirements':'material_requirements','boms':'bo_ms','custom-reports':'report_definitions','portal/admin/orders':'sales_orders','portal/admin/customers':'customers','work-order-processes/pending':'work_order_processes'}
existing={'products','customers','suppliers','units','warehouses','categories','departments','users','roles','permissions','locations','racks'}
filtered={'combo-products','portal/admin/orders','portal/admin/customers','work-order-processes/pending'}
routes=[]
for record in records:
 data=record.get('body',{}).get('data') if isinstance(record.get('body'),dict) else None
 if record['method']!='GET' or record.get('status')!=200 or not isinstance(data,dict) or not {'list','total'}<=data.keys():continue
 route=record['endpoint'].removeprefix('/api/v1/')
 if route in existing or route in filtered:continue
 table=aliases.get(route,route.replace('-','_'))
 if table not in tables:raise ValueError('No verified table mapping for '+route)
 # Only super_admin may access newly reconstructed business reads until each
 # original route's precise permission/data-scope policy has been actual.
 routes.append({'route':route,'table':table,'permission':'*','original_endpoint':record['endpoint'],'original_total':data['total']})
dest=root/'backend/internal/api/read_resources.json';dest.write_text(json.dumps(routes,indent=2)+'\n',encoding='utf8')
print('Generated',len(routes),'read-only resource mappings from original responses.')
