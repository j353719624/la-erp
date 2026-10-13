export async function captureBOMDepth(request){
 const unit=(await request('GET','/api/v1/units')).data.list[0];const products=[];const boms=[];
 for(let i=0;i<11;i++){const code='REC-DEPTH-'+String(i).padStart(2,'0');const p=await request('POST','/api/v1/products',{code,name:code,unit_id:unit.id,product_type:i===10?'raw_material':'finished',cost_method:'weighted_avg',purchase_price:1});if(!p.data?.id)throw Error('Depth product missing');products.push(p.data)}
 for(let i=9;i>=0;i--){const parent=products[i],part=products[i+1];const bom=await request('POST','/api/v1/boms',{product_id:parent.id,product_code:parent.code,product_name:parent.name,items:[{product_id:part.id,product_code:part.code,product_name:part.name,unit_id:unit.id,qty:1,scrap_rate:0}]});if(!bom.data?.id)throw Error('Depth BOM missing');boms[i]=bom.data}
 await request('GET',`/api/v1/boms/${boms[0].id}/tree`);await request('GET',`/api/v1/boms/${boms[1].id}/tree`);await request('GET',`/api/v1/boms/${boms[2].id}/tree`);
}
