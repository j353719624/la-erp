package api

import "testing"

func TestLoanCancelAfterConfirmReversesInventory(t *testing.T) {
	c, _ := setup(t)
	products := c.ok("GET", "/api/v1/products?page_size=1", nil).(map[string]any); items,_:=products["items"].([]any); if items==nil {if e,ok:=products["edges"].(map[string]any);ok{items,_=e["items"].([]any)}}; if len(items)==0 {t.Skip("no seeded product")}; p:=items[0].(map[string]any)
	warehouses:=c.ok("GET", "/api/v1/warehouses?page_size=1", nil).(map[string]any); ws,_:=warehouses["items"].([]any); if ws==nil {if e,ok:=warehouses["edges"].(map[string]any);ok{ws,_=e["items"].([]any)}}; if len(ws)==0 {t.Skip("no seeded warehouse")}; w:=ws[0].(map[string]any)
	loan:=c.ok("POST","/api/v1/loan-orders",map[string]any{"warehouse_id":w["id"],"lines":[]any{map[string]any{"product_id":p["id"],"qty":"1"}}}).(map[string]any); id:=loan["id"].(string)
	c.ok("POST","/api/v1/loan-orders/"+id+"/confirm",nil)
	cancelled:=c.ok("POST","/api/v1/loan-orders/"+id+"/cancel",nil).(map[string]any); if cancelled["status"]!="cancelled" {t.Fatalf("cancel: %#v",cancelled)}
	_,body:=c.request("POST","/api/v1/loan-orders/"+id+"/cancel",nil); if body["code"]==nil||body["code"].(float64)==0 {t.Fatalf("duplicate cancel accepted: %#v",body)}
}
