package api

import (
	"testing"
)

func TestSelfScopeCannotReadModifyOrDeleteOtherRecords(t *testing.T) {
	c, _ := setup(t)
	permissions := c.ok("GET", "/api/v1/permissions?page_size=1000", nil).(map[string]any)["list"].([]any)
	ids := []any{}
	for _, p := range permissions {
		row := p.(map[string]any)
		switch row["code"] {
		case "product_list", "product_view", "product_create", "product_edit", "product_delete":
			ids = append(ids, row["id"])
		}
	}
	if len(ids) < 4 {
		t.Fatal("original permission fixture missing product operations")
	}
	role := c.ok("POST", "/api/v1/roles", map[string]any{"code": "self-test", "name": "本人资料", "data_scope": "self"}).(map[string]any)
	c.ok("POST", "/api/v1/roles/"+role["id"].(string)+"/permissions", map[string]any{"permission_ids": ids})
	user := c.ok("POST", "/api/v1/users", map[string]any{"username": "scoped", "password": "scoped123"}).(map[string]any)
	c.ok("POST", "/api/v1/users/"+user["id"].(string)+"/roles", map[string]any{"role_ids": []any{role["id"]}})
	foreign := c.ok("POST", "/api/v1/products", map[string]any{"code": "OTHER", "name": "其他人商品"}).(map[string]any)
	login := c.ok("POST", "/api/v1/auth/login", map[string]any{"username": "scoped", "password": "scoped123"}).(map[string]any)
	regular := &client{t: t, server: c.server, token: login["access_token"].(string)}
	for _, method := range []string{"GET", "PUT", "DELETE"} {
		if status, _ := regular.request(method, "/api/v1/products/"+foreign["id"].(string), map[string]any{"name": "被篡改"}); status != 404 {
			t.Fatalf("scope bypass %s=%d", method, status)
		}
	}
	own := regular.ok("POST", "/api/v1/products", map[string]any{"code": "OWN", "name": "本人商品"}).(map[string]any)
	list := regular.ok("GET", "/api/v1/products?created_by="+foreign["created_by"].(string), nil).(map[string]any)
	if list["total"] != float64(1) {
		t.Fatal("client filter bypassed scope", list)
	}
	regular.ok("PUT", "/api/v1/products/"+own["id"].(string), map[string]any{"name": "本人修改"})
	regular.ok("DELETE", "/api/v1/products/"+own["id"].(string), nil)
	foreign = c.ok("GET", "/api/v1/products/"+foreign["id"].(string), nil).(map[string]any)
	if foreign["name"] != "其他人商品" {
		t.Fatal("unauthorized update persisted", foreign)
	}
	if status, _ := regular.request("POST", "/api/v1/stock-ins", map[string]any{}); status != 403 {
		t.Fatal("unverified business scope permitted", status)
	}
}

func TestOrdinaryHierarchyUpdateCannotBypassCycleGuard(t *testing.T) {
	c, _ := setup(t)
	for _, route := range []string{"departments", "categories"} {
		parent := c.ok("POST", "/api/v1/"+route, map[string]any{"code": "PARENT-" + route, "name": "父", "entity_code": "product"}).(map[string]any)
		child := c.ok("POST", "/api/v1/"+route, map[string]any{"code": "CHILD-" + route, "name": "子", "entity_code": "product", "parent_id": parent["id"]}).(map[string]any)
		if status, _ := c.request("PUT", "/api/v1/"+route+"/"+parent["id"].(string), map[string]any{"parent_id": child["id"]}); status != 400 {
			t.Fatalf("%s cycle accepted=%d", route, status)
		}
		result := c.ok("GET", "/api/v1/"+route+"/"+parent["id"].(string), nil).(map[string]any)
		if result["parent_id"] != nil {
			t.Fatal("cycle persisted", result)
		}
	}
}
