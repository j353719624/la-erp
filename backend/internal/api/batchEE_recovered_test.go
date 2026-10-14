package api

// 本文件固化批次 EE 取证（2026-10-14）的结论：组合件端点族
// /api/v1/combo-products（列表/详情/改配方/取消/组装/拆解/可用量）。
// 证据见 evidence/backend-runtime/audit-batch-ee-20261014.json。
//
// 关键口径（逐条对账过原版库存余额与 stock_movements）：
//   ref_cost     = 配件在默认仓的库存均价；均价为 0 或无库存行时回落 purchase_price
//   assemble     unit_cost = Σ(行 qty × ref_cost)
//   disassemble  unit_cost = 成品在该仓的库存均价

import (
	"fmt"
	"testing"
)

// comboFixture 建成品 + 一个配件，并把配件标为组合件配方行。
func comboFixture(t *testing.T, code string) (*client, map[string]any, map[string]any, map[string]any) {
	t.Helper()
	c, product, warehouse, _ := recoveredFixture(t, code)
	component := c.ok("POST", "/api/v1/products", map[string]any{"code": code + "-C1", "name": code + "配件"}).(map[string]any)
	c.ok("PUT", "/api/v1/combo-products/"+product["id"].(string), map[string]any{
		"lines": []any{map[string]any{"component_id": component["id"], "qty": 2}},
	})
	return c, product, component, warehouse
}

// comboSeed 给某商品在指定仓补库存（走库存调整单），返回确认后的可用量。
func comboSeed(c *client, productID, warehouseID string, qty int, unitCost float64) {
	adjust := c.ok("POST", "/api/v1/inventory-adjusts", map[string]any{
		"warehouse_id": warehouseID, "adjust_type": "increase",
		"lines": []any{map[string]any{"product_id": productID, "qty": qty, "unit_cost": unitCost}},
	}).(map[string]any)
	c.ok("POST", "/api/v1/inventory-adjusts/"+adjust["id"].(string)+"/confirm", nil)
}

// EE1：PUT 标记组合件 → 列表出现该商品、详情带配方行、DELETE 后列表归零。
func TestRecoveredComboMarkListAndUnmark(t *testing.T) {
	c, product, component, _ := comboFixture(t, "EE-MARK")

	list := c.ok("GET", "/api/v1/combo-products", nil).(map[string]any)
	if list["total"] != float64(1) {
		t.Fatalf("combo list total=%v", list["total"])
	}
	item := list["list"].([]any)[0].(map[string]any)
	if item["id"] != product["id"] || item["item_count"] != float64(1) {
		t.Fatalf("list item=%#v", item)
	}
	// 不带 warehouse_id 时 stock / can_assemble 恒为 "0"（原版一致）
	if item["stock"] != "0" || item["can_assemble"] != "0" {
		t.Fatalf("stock/can_assemble must be \"0\" without warehouse_id: %#v", item)
	}

	detail := c.ok("GET", "/api/v1/combo-products/"+product["id"].(string), nil).(map[string]any)
	if detail["is_combo"] != true {
		t.Fatalf("is_combo=%#v", detail["is_combo"])
	}
	lines := detail["lines"].([]any)
	if len(lines) != 1 {
		t.Fatalf("lines=%#v", lines)
	}
	line := lines[0].(map[string]any)
	if line["component_id"] != component["id"] || line["component_code"] != component["code"] {
		t.Fatalf("line snapshot=%#v", line)
	}
	if line["qty"] != "2" {
		t.Fatalf("line qty=%#v", line["qty"])
	}

	// DELETE 取消组合标记：幂等且列表归零，商品本身保留
	c.ok("DELETE", "/api/v1/combo-products/"+product["id"].(string), nil)
	c.ok("DELETE", "/api/v1/combo-products/"+product["id"].(string), nil)
	list = c.ok("GET", "/api/v1/combo-products", nil).(map[string]any)
	if list["total"] != float64(0) {
		t.Fatalf("after delete total=%v", list["total"])
	}
	kept := c.ok("GET", "/api/v1/products/"+product["id"].(string), nil).(map[string]any)
	if kept["code"] != product["code"] {
		t.Fatalf("product must survive delete: %#v", kept)
	}
}

// EE2：详情对非组合商品返回 is_combo=false / lines=null / 数字 0。
func TestRecoveredComboDetailOfPlainProduct(t *testing.T) {
	c, product, warehouse, _ := recoveredFixture(t, "EE-PLAIN")
	detail := c.ok("GET", "/api/v1/combo-products/"+product["id"].(string), nil).(map[string]any)
	if detail["is_combo"] != false || detail["lines"] != nil {
		t.Fatalf("plain detail=%#v", detail)
	}
	if detail["unit_cost"] != float64(0) || detail["total_cost"] != float64(0) {
		t.Fatalf("plain unit/total must be numeric 0: %#v", detail)
	}
	// 非组合商品组装 / 拆解走原版文案
	for action, want := range map[string]string{"assemble": "该商品未配置组合配方，无法组装", "disassemble": "该商品未配置组合配方，无法拆解"} {
		status, resp := c.request("POST", "/api/v1/combo-products/"+product["id"].(string)+"/"+action,
			map[string]any{"warehouse_id": warehouse["id"], "qty": 1})
		if status != 200 || resp["code"] != float64(10000) || fmtMessage(resp) != want {
			t.Fatalf("%s: %d %#v", action, status, resp)
		}
	}
}

// EE3：PUT 配方保存的边界文案（逐字对照原版）。
func TestRecoveredComboSaveRejections(t *testing.T) {
	c, product, component, _ := comboFixture(t, "EE-SAVE")
	id := product["id"].(string)
	cid := component["id"].(string)

	cases := []struct {
		name string
		body map[string]any
		http int
		code float64
		msg  string
	}{
		{"lines 为空数组", map[string]any{"lines": []any{}}, 200, 10000, "组合配方至少需要一行配件"},
		{"缺 lines", map[string]any{}, 200, 10000, "组合配方至少需要一行配件"},
		{"lines 非数组", map[string]any{"lines": map[string]any{"a": 1}}, 400, 400, "系统内部错误，请稍后重试或联系管理员"},
		{"line 非对象", map[string]any{"lines": []any{"x"}}, 400, 400, "系统内部错误，请稍后重试或联系管理员"},
		{"component_id 空串", map[string]any{"lines": []any{map[string]any{"component_id": "", "qty": 1}}}, 400, 400, "请求参数错误: invalid UUID length: 0"},
		{"component_id 非 UUID", map[string]any{"lines": []any{map[string]any{"component_id": "zz", "qty": 1}}}, 400, 400, "请求参数错误: invalid UUID length: 2"},
		{"配件不存在", map[string]any{"lines": []any{map[string]any{"component_id": "00000000-0000-0000-0000-000000000099", "qty": 1}}}, 200, 10000, "配件商品不存在"},
		{"配件是自身", map[string]any{"lines": []any{map[string]any{"component_id": id, "qty": 1}}}, 200, 10000, "配件不能是成品自身"},
		{"qty=0", map[string]any{"lines": []any{map[string]any{"component_id": cid, "qty": 0}}}, 200, 10000, "配件数量必须大于 0"},
		{"qty=-1", map[string]any{"lines": []any{map[string]any{"component_id": cid, "qty": -1}}}, 200, 10000, "配件数量必须大于 0"},
		{"缺 qty", map[string]any{"lines": []any{map[string]any{"component_id": cid}}}, 200, 10000, "配件数量必须大于 0"},
		{"qty 非数字", map[string]any{"lines": []any{map[string]any{"component_id": cid, "qty": "abc"}}}, 400, 400, "请求参数错误: error decoding string 'abc': can't convert abc to decimal"},
		{"配件重复", map[string]any{"lines": []any{map[string]any{"component_id": cid, "qty": 1}, map[string]any{"component_id": cid, "qty": 2}}}, 200, 10000, "同一配件不能重复添加"},
	}
	for _, tc := range cases {
		status, resp := c.request("PUT", "/api/v1/combo-products/"+id, tc.body)
		if status != tc.http || resp["code"] != tc.code || fmtMessage(resp) != tc.msg {
			t.Fatalf("%s: want %d/%v/%q got %d/%v/%q", tc.name, tc.http, tc.code, tc.msg, status, resp["code"], fmtMessage(resp))
		}
	}
	// 成品不存在
	status, resp := c.request("PUT", "/api/v1/combo-products/00000000-0000-0000-0000-000000000099",
		map[string]any{"lines": []any{map[string]any{"component_id": cid, "qty": 1}}})
	if status != 200 || resp["code"] != float64(10000) || fmtMessage(resp) != "成品商品不存在" {
		t.Fatalf("unknown product: %d %#v", status, resp)
	}
	// qty 字符串数字原版接受
	c.ok("PUT", "/api/v1/combo-products/"+id, map[string]any{"lines": []any{map[string]any{"component_id": cid, "qty": "3"}}})
	detail := c.ok("GET", "/api/v1/combo-products/"+id, nil).(map[string]any)
	if detail["lines"].([]any)[0].(map[string]any)["qty"] != "3" {
		t.Fatalf("string qty must be accepted: %#v", detail["lines"])
	}
}

// EE4：ID 形态与可用量端点。
func TestRecoveredComboIdAndAvailable(t *testing.T) {
	c, product, _, warehouse := comboFixture(t, "EE-AVAIL")
	id := product["id"].(string)
	wh := warehouse["id"].(string)

	// 非法 UUID 一律 400「无效的商品ID」
	for _, route := range []struct{ method, path string }{
		{"GET", "/api/v1/combo-products/not-a-uuid"},
		{"DELETE", "/api/v1/combo-products/not-a-uuid"},
		{"PUT", "/api/v1/combo-products/not-a-uuid"},
		{"POST", "/api/v1/combo-products/not-a-uuid/assemble"},
		{"POST", "/api/v1/combo-products/not-a-uuid/disassemble"},
	} {
		status, resp := c.request(route.method, route.path, map[string]any{})
		if status != 400 || fmtMessage(resp) != "无效的商品ID" {
			t.Fatalf("%s %s: %d %#v", route.method, route.path, status, resp)
		}
	}
	// 商品不存在的路径
	status, resp := c.request("GET", "/api/v1/combo-products/00000000-0000-0000-0000-000000000099", nil)
	if status != 200 || fmtMessage(resp) != "商品不存在" {
		t.Fatalf("detail unknown: %d %#v", status, resp)
	}
	status, resp = c.request("DELETE", "/api/v1/combo-products/00000000-0000-0000-0000-000000000099", nil)
	if status != 200 || fmtMessage(resp) != "商品不存在" {
		t.Fatalf("delete unknown: %d %#v", status, resp)
	}

	// available：缺 / 非法 warehouse_id → 400「无效的仓库ID」
	for _, q := range []string{"", "not-a-uuid"} {
		status, resp := c.request("GET", "/api/v1/combo-products/"+id+"/available?warehouse_id="+q, nil)
		if status != 400 || fmtMessage(resp) != "无效的仓库ID" {
			t.Fatalf("available warehouse=%q: %d %#v", q, status, resp)
		}
	}
	// 商品 / 仓库不存在时静默返回 0（原版不报错）
	data := c.ok("GET", "/api/v1/combo-products/00000000-0000-0000-0000-000000000099/available?warehouse_id="+wh, nil).(map[string]any)
	if data["can_assemble"] != "0" || data["stock"] != "0" {
		t.Fatalf("available of unknown product=%#v", data)
	}
}

// EE5：组装 / 拆解的库存、流水与成本口径。
func TestRecoveredComboAssembleAndDisassemble(t *testing.T) {
	c, product, component, warehouse := comboFixture(t, "EE-ACT")
	id, cid, wh := product["id"].(string), component["id"].(string), warehouse["id"].(string)

	// 配件补 100 件 @20 → ref_cost 回落采购价前先看均价：调拨单价 20 → 均价 20
	comboSeed(c, cid, wh, 100, 20)

	// 数量边界
	for action, want := range map[string]string{"assemble": "组装数量必须大于 0", "disassemble": "拆解数量必须大于 0"} {
		for _, qty := range []any{0, -5} {
			status, resp := c.request("POST", "/api/v1/combo-products/"+id+"/"+action, map[string]any{"warehouse_id": wh, "qty": qty})
			if status != 200 || resp["code"] != float64(10000) || fmtMessage(resp) != want {
				t.Fatalf("%s qty=%v: %d %#v", action, qty, status, resp)
			}
		}
	}
	// 仓库不存在
	status, resp := c.request("POST", "/api/v1/combo-products/"+id+"/assemble",
		map[string]any{"warehouse_id": "00000000-0000-0000-0000-000000000001", "qty": 1})
	if status != 200 || fmtMessage(resp) != "仓库不存在" {
		t.Fatalf("bad warehouse: %d %#v", status, resp)
	}
	// 库存不足
	status, resp = c.request("POST", "/api/v1/combo-products/"+id+"/assemble", map[string]any{"warehouse_id": wh, "qty": 999})
	if status != 200 || fmtMessage(resp) != "库存不足" {
		t.Fatalf("insufficient: %d %#v", status, resp)
	}

	// 可用量：100 / 2 = 50
	avail := c.ok("GET", "/api/v1/combo-products/"+id+"/available?warehouse_id="+wh, nil).(map[string]any)
	if avail["can_assemble"] != "50" || avail["stock"] != "0" {
		t.Fatalf("available=%#v", avail)
	}

	// 组装 10 套：unit_cost = 2 × 20 = 40
	res := c.ok("POST", "/api/v1/combo-products/"+id+"/assemble", map[string]any{"warehouse_id": wh, "qty": 10}).(map[string]any)
	if res["qty"] != "10" || res["unit_cost"] != "40" || res["total_cost"] != "400" {
		t.Fatalf("assemble result=%#v", res)
	}
	if got := recoveredBalance(c, cid, wh); got != 80 {
		t.Fatalf("component stock after assemble=%v want 80", got)
	}
	if got := recoveredBalance(c, id, wh); got != 10 {
		t.Fatalf("combo stock after assemble=%v want 10", got)
	}
	// 成品均价 = (0 + 10×40)/10 = 40
	if avg := comboBalanceAvg(c, id, wh); avg != "40" {
		t.Fatalf("combo avg cost=%v want 40", avg)
	}

	// 拆解 4 套：unit_cost = 成品库存均价 40，配件按 ref_cost 入库
	res = c.ok("POST", "/api/v1/combo-products/"+id+"/disassemble", map[string]any{"warehouse_id": wh, "qty": 4}).(map[string]any)
	if res["unit_cost"] != "40" || res["total_cost"] != "160" {
		t.Fatalf("disassemble result=%#v", res)
	}
	if got := recoveredBalance(c, cid, wh); got != 88 {
		t.Fatalf("component stock after disassemble=%v want 88", got)
	}
	if got := recoveredBalance(c, id, wh); got != 6 {
		t.Fatalf("combo stock after disassemble=%v want 6", got)
	}

	// 流水：配件出库 / 成品入库 / 成品出库 / 配件入库 四类齐全
	remarks := comboMovementRemarks(c)
	for _, want := range []string{"组装 EE-ACT 配件出库", "组装成品 EE-ACT", "拆解成品 EE-ACT", "拆解 EE-ACT 配件入库"} {
		if _, ok := remarks[want]; !ok {
			t.Fatalf("movement %q missing, got %#v", want, remarks)
		}
	}
	if remarks["组装 EE-ACT 配件出库"] != "combo_assemble" || remarks["拆解 EE-ACT 配件入库"] != "combo_disassemble" {
		t.Fatalf("source_type=%#v", remarks)
	}
}

// EE6：ref_cost 回落采购价 —— 无库存行时用 purchase_price。
func TestRecoveredComboRefCostFallsBackToPurchasePrice(t *testing.T) {
	c, product, component, warehouse := comboFixture(t, "EE-REF")
	id, cid, wh := product["id"].(string), component["id"].(string), warehouse["id"].(string)

	// 给配件设采购价 12.5，此时无任何库存行 → ref_cost 应为 12.5
	c.ok("PUT", "/api/v1/products/"+cid, map[string]any{"purchase_price": 12.5})
	detail := c.ok("GET", "/api/v1/combo-products/"+id, nil).(map[string]any)
	line := detail["lines"].([]any)[0].(map[string]any)
	if line["ref_cost"] != "12.5" {
		t.Fatalf("ref_cost must fall back to purchase_price: %#v", line)
	}
	if detail["unit_cost"] != "25" {
		t.Fatalf("unit_cost=%#v want 25 (2 × 12.5)", detail["unit_cost"])
	}
	_ = wh
	_ = fmt.Sprint(id)
}

// comboBalanceAvg 取某商品在某仓的库存均价字符串。
func comboBalanceAvg(c *client, productID, warehouseID string) string {
	list := c.ok("GET", "/api/v1/inventory-balances?product_id="+productID+"&warehouse_id="+warehouseID, nil).(map[string]any)
	rows, _ := list["list"].([]any)
	if len(rows) == 0 {
		return ""
	}
	return fmt.Sprint(rows[0].(map[string]any)["avg_cost"])
}

// comboMovementRemarks 取组合件流水的「remark → source_type」映射。
// 配件侧流水的 product_id 是配件本身，故此处按 source_type 全量过滤。
func comboMovementRemarks(c *client) map[string]string {
	list := c.ok("GET", "/api/v1/stock-movements?page_size=1000", nil).(map[string]any)
	result := map[string]string{}
	for _, raw := range list["list"].([]any) {
		row := raw.(map[string]any)
		if fmt.Sprint(row["source_type"]) == "" || (fmt.Sprint(row["source_type"]) != "combo_assemble" && fmt.Sprint(row["source_type"]) != "combo_disassemble") {
			continue
		}
		result[fmt.Sprint(row["remark"])] = fmt.Sprint(row["source_type"])
	}
	return result
}
