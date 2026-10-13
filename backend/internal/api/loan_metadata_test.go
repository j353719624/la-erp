package api

import "testing"

func TestLoanPersistsBatchAndSerialMetadata(t *testing.T) {
 c,_:=setup(t); ps:=c.ok("GET","/api/v1/products?page_size=1",nil).(map[string]any); items,_:=ps["items"].([]any); if items==nil {if e,ok:=ps["edges"].(map[string]any);ok{items,_=e["items"].([]any)}}; if len(items)==0 {t.Skip("no seeded product")}; p:=items[0].(map[string]any); ws:=c.ok("GET","/api/v1/warehouses?page_size=1",nil).(map[string]any); witems,_:=ws["items"].([]any); if witems==nil {if e,ok:=ws["edges"].(map[string]any);ok{witems,_=e["items"].([]any)}}; if len(witems)==0 {t.Skip("no seeded warehouse")}; w:=witems[0].(map[string]any)
 loan:=c.ok("POST","/api/v1/loan-orders",map[string]any{"warehouse_id":w["id"],"lines":[]any{map[string]any{"product_id":p["id"],"qty":"1","batch_no":"B-REC-01","serial_nos":[]any{"SN-REC-01"}}}}).(map[string]any); line:=loan["lines"].([]any)[0].(map[string]any); if line["batch_no"]!="B-REC-01" {t.Fatalf("batch not persisted: %#v",line)}; if line["serial_nos"]==nil {t.Fatalf("serial metadata missing: %#v",line)}
}
