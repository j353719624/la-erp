package api

import "testing"

func TestSalesStaffActionsScopeAndImmediatePermissions(t *testing.T) {
	c, _ := setup(t)
	permissions := c.ok("GET", "/api/v1/permissions?page_size=1000", nil).(map[string]any)["list"].([]any)
	ids := []any{}
	listIDs := []any{}
	for _, raw := range permissions {
		p := raw.(map[string]any)
		switch p["code"] {
		case "sales_order_list":
			ids = append(ids, p["id"])
			listIDs = append(listIDs, p["id"])
		case "sales_order_create", "sales_order_edit", "sales_order_delete":
			ids = append(ids, p["id"])
		}
	}
	role := c.ok("POST", "/api/v1/roles", map[string]any{"code": "REPLAY-SELF", "name": "Replay self", "data_scope": "self"}).(map[string]any)
	rp := "/api/v1/roles/" + role["id"].(string) + "/permissions"
	c.ok("POST", rp, map[string]any{"permission_ids": ids})
	u := c.ok("POST", "/api/v1/users", map[string]any{"username": "replay-self", "password": "Replay123!"}).(map[string]any)
	c.ok("POST", "/api/v1/users/"+u["id"].(string)+"/roles", map[string]any{"role_ids": []any{role["id"]}})
	login := c.ok("POST", "/api/v1/auth/login", map[string]any{"username": "replay-self", "password": "Replay123!"}).(map[string]any)
	regular := &client{t: t, server: c.server, token: login["access_token"].(string)}
	customer := c.ok("POST", "/api/v1/customers", map[string]any{"code": "ROLE-CUSTOMER", "name": "Role customer"}).(map[string]any)
	p := c.ok("GET", "/api/v1/products", nil).(map[string]any)["list"].([]any)[0].(map[string]any)
	body := map[string]any{"customer_id": customer["id"], "lines": []any{map[string]any{"product_id": p["id"], "qty": 1, "price": 3}}}
	foreign := c.ok("POST", "/api/v1/sales-orders", body).(map[string]any)
	fp := "/api/v1/sales-orders/" + foreign["id"].(string)
	for _, method := range []string{"GET", "PUT", "DELETE"} {
		expected := 404
		if method != "GET" {
			expected = 200
		}
		if status, body := regular.request(method, fp, map[string]any{"remark": "forbidden"}); status != expected || (method != "GET" && body["code"] != float64(10000)) {
			t.Fatal(method, status)
		}
	}
	for _, action := range []string{"confirm", "approve", "cancel"} {
		if status, body := regular.request("POST", fp+"/"+action, map[string]any{}); status != 200 || body["code"] != float64(10000) {
			t.Fatal(action, status)
		}
	}
	own := regular.ok("POST", "/api/v1/sales-orders", body).(map[string]any)
	op := "/api/v1/sales-orders/" + own["id"].(string)
	regular.ok("PUT", op, map[string]any{"remark": "own edit"})
	regular.ok("POST", op+"/confirm", map[string]any{})
	regular.ok("POST", op+"/approve", map[string]any{})
	list := regular.ok("GET", "/api/v1/sales-orders", nil).(map[string]any)
	if list["total"] != float64(1) {
		t.Fatal(list)
	}
	c.ok("POST", rp, map[string]any{"permission_ids": listIDs})
	if status, _ := regular.request("POST", op+"/confirm", map[string]any{}); status != 403 {
		t.Fatal("stale permission", status)
	}
	if status, _ := regular.request("PUT", op, map[string]any{}); status != 403 {
		t.Fatal("stale edit", status)
	}
}

func TestDepartmentIsolationOffSalesFullAndAllImmediate(t *testing.T) {
	c, _ := setup(t)
	dept := c.ok("POST", "/api/v1/departments", map[string]any{"code": "DEPT-REPLAY", "name": "Dept replay"}).(map[string]any)
	perms := c.ok("GET", "/api/v1/permissions?page_size=1000", nil).(map[string]any)["list"].([]any)
	ids := []any{}
	for _, raw := range perms {
		p := raw.(map[string]any)
		switch p["code"] {
		case "sales_order_list", "sales_order_create", "customer_create", "customer_list", "product_create", "stock_in", "stock_in_create", "stock_in_edit":
			ids = append(ids, p["id"])
		}
	}
	role := c.ok("POST", "/api/v1/roles", map[string]any{"code": "DEPT-SALES", "name": "Dept sales", "data_scope": "dept"}).(map[string]any)
	rp := "/api/v1/roles/" + role["id"].(string)
	c.ok("POST", rp+"/permissions", map[string]any{"permission_ids": ids})
	u := c.ok("POST", "/api/v1/users", map[string]any{"username": "dept-sales", "password": "Replay123!", "department_id": dept["id"]}).(map[string]any)
	c.ok("POST", "/api/v1/users/"+u["id"].(string)+"/roles", map[string]any{"role_ids": []any{role["id"]}})
	login := c.ok("POST", "/api/v1/auth/login", map[string]any{"username": "dept-sales", "password": "Replay123!"}).(map[string]any)
	regular := &client{t: t, server: c.server, token: login["access_token"].(string)}
	product := c.ok("GET", "/api/v1/products", nil).(map[string]any)["list"].([]any)[0].(map[string]any)
	foreignCustomer := c.ok("POST", "/api/v1/customers", map[string]any{"name": "Foreign"}).(map[string]any)
	body := map[string]any{"customer_id": foreignCustomer["id"], "lines": []any{map[string]any{"product_id": product["id"], "qty": 1, "price": 3}}}
	foreign := c.ok("POST", "/api/v1/sales-orders", body).(map[string]any)
	fp := "/api/v1/sales-orders/" + foreign["id"].(string)
	regular.ok("GET", fp, nil)
	c.ok("PUT", "/api/v1/data-isolation", map[string]any{"mode": "sales"})
	if status, _ := regular.request("GET", fp, nil); status != 404 {
		t.Fatal(status)
	}
	_, response := regular.request("POST", "/api/v1/sales-orders", body)
	if response["code"] == float64(0) {
		t.Fatal("foreign customer accepted")
	}
	ownCustomer := regular.ok("POST", "/api/v1/customers", map[string]any{"name": "Dept customer"}).(map[string]any)
	if ownCustomer["department_id"] != dept["id"] {
		t.Fatal(ownCustomer)
	}
	body["customer_id"] = ownCustomer["id"]
	own := regular.ok("POST", "/api/v1/sales-orders", body).(map[string]any)
	if own["department_id"] != dept["id"] {
		t.Fatal(own)
	}
	for _, mode := range []string{"sales", "full"} {
		c.ok("PUT", "/api/v1/data-isolation", map[string]any{"mode": mode})
		list := regular.ok("GET", "/api/v1/sales-orders", nil).(map[string]any)
		if list["total"] != float64(1) {
			t.Fatal(mode, list)
		}
	}
	wh := c.ok("GET", "/api/v1/warehouses", nil).(map[string]any)["list"].([]any)[0].(map[string]any)
	stockBody := map[string]any{"warehouse_id": wh["id"], "type": "other", "lines": []any{map[string]any{"product_id": product["id"], "qty": 1, "unit_cost": 13}}}
	if status, response := regular.request("POST", "/api/v1/stock-ins", stockBody); status != 400 || response["message"] != "无权访问该数据" {
		t.Fatal(status, response)
	}
	ownedProduct := regular.ok("POST", "/api/v1/products", map[string]any{"code": "DEPT-STOCK-P", "name": "Dept stock"}).(map[string]any)
	stockBody["lines"] = []any{map[string]any{"product_id": ownedProduct["id"], "qty": 1, "unit_cost": 13}}
	stock := regular.ok("POST", "/api/v1/stock-ins", stockBody).(map[string]any)
	if stock["department_id"] != dept["id"] {
		t.Fatal(stock)
	}
	regular.ok("POST", "/api/v1/stock-ins/"+stock["id"].(string)+"/confirm", nil)
	c.ok("PUT", rp, map[string]any{"code": "DEPT-SALES", "name": "Dept sales", "data_scope": "all"})
	regular.ok("GET", fp, nil)
}

func TestPurchaseAndWarehouseAuthorizedStaffAndForeignScope(t *testing.T) {
	for _, kind := range []string{"purchase", "stock"} {
		t.Run(kind, func(t *testing.T) {
			c, _ := setup(t)
			prefix, route, view := "purchase_order", "purchase-orders", "purchase_order_list"
			if kind == "stock" {
				prefix, route, view = "stock_in", "stock-ins", "stock_in"
			}
			perms := c.ok("GET", "/api/v1/permissions?page_size=1000", nil).(map[string]any)["list"].([]any)
			ids := []any{}
			for _, raw := range perms {
				p := raw.(map[string]any)
				switch p["code"] {
				case view, prefix + "_create", prefix + "_edit", prefix + "_delete":
					ids = append(ids, p["id"])
				}
			}
			role := c.ok("POST", "/api/v1/roles", map[string]any{"code": "STAFF-" + kind, "name": "Staff", "data_scope": "self"}).(map[string]any)
			c.ok("POST", "/api/v1/roles/"+role["id"].(string)+"/permissions", map[string]any{"permission_ids": ids})
			u := c.ok("POST", "/api/v1/users", map[string]any{"username": "staff-" + kind, "password": "Replay123!"}).(map[string]any)
			c.ok("POST", "/api/v1/users/"+u["id"].(string)+"/roles", map[string]any{"role_ids": []any{role["id"]}})
			login := c.ok("POST", "/api/v1/auth/login", map[string]any{"username": "staff-" + kind, "password": "Replay123!"}).(map[string]any)
			regular := &client{t: t, server: c.server, token: login["access_token"].(string)}
			p := c.ok("GET", "/api/v1/products", nil).(map[string]any)["list"].([]any)[0].(map[string]any)
			wh := c.ok("GET", "/api/v1/warehouses", nil).(map[string]any)["list"].([]any)[0].(map[string]any)
			body := map[string]any{"warehouse_id": wh["id"], "lines": []any{map[string]any{"product_id": p["id"], "qty": 1, "price": 3, "unit_cost": 3}}}
			if kind == "purchase" {
				supplier := c.ok("POST", "/api/v1/suppliers", map[string]any{"name": "Role supplier"}).(map[string]any)
				body["supplier_id"] = supplier["id"]
			}
			foreign := c.ok("POST", "/api/v1/"+route, body).(map[string]any)
			fp := "/api/v1/" + route + "/" + foreign["id"].(string)
			for _, method := range []string{"GET", "PUT", "DELETE"} {
				expected, code := 404, float64(404)
				if method != "GET" {
					expected = 200
					code = 10000
					if kind == "stock" {
						expected = 400
						code = 400
					}
				}
				status, response := regular.request(method, fp, map[string]any{"remark": "forbidden"})
				if status != expected || response["code"] != code {
					t.Fatal(method, status, response)
				}
			}
			expected := 200
			if kind == "stock" {
				expected = 400
			}
			if status, _ := regular.request("POST", fp+"/confirm", nil); status != expected {
				t.Fatal(status)
			}
			own := regular.ok("POST", "/api/v1/"+route, body).(map[string]any)
			op := "/api/v1/" + route + "/" + own["id"].(string)
			regular.ok("GET", op, nil)
			regular.ok("POST", op+"/confirm", nil)
			draft := regular.ok("POST", "/api/v1/"+route, body).(map[string]any)
			regular.ok("DELETE", "/api/v1/"+route+"/"+draft["id"].(string), nil)
		})
	}
}
