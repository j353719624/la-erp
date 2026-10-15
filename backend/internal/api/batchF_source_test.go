package api

import (
	"strings"
	"testing"
)

// 本文件固化批次 F 取证（2026-10-14）的结论：入库照片上限、序列号注册格式、
// unit_rate 被忽略、明细行数上限。
// 证据见 运行快照。

// FF1：入库单照片上限为 20 张，文案与与既有行为一致。
func TestSourceStockPhotoLimitIsTwenty(t *testing.T) {
	c, product, warehouse, _ := testFixture(t, "FF-PHOTO")
	in := c.ok("POST", "/api/v1/stock-ins", map[string]any{"warehouse_id": warehouse["id"], "lines": []any{
		map[string]any{"product_id": product["id"], "qty": 1, "unit_cost": 1},
	}}).(map[string]any)
	path := "/api/v1/stock-ins/" + in["id"].(string) + "/photos"
	many := make([]any, 0, 21)
	for i := 0; i < 21; i++ {
		many = append(many, map[string]any{"url": "/uploads/images/f" + itoa(i) + ".png"})
	}
	if status, body := c.request("POST", path, map[string]any{"photos": many}); status == 200 && body["code"] == float64(0) {
		t.Fatalf("21 photos accepted: %#v", body)
	} else if body["message"] != "单张入库单最多记录 20 张照片，请先删除不再需要的记录" {
		t.Fatalf("photo limit message: %#v", body["message"])
	}
	twenty := make([]any, 0, 20)
	for i := 0; i < 20; i++ {
		twenty = append(twenty, map[string]any{"url": "/uploads/images/g" + itoa(i) + ".png"})
	}
	c.ok("POST", path, map[string]any{"photos": twenty})
	// 空数组与空对象分别对应既有实现的 400 与提示文案。
	if status, _ := c.request("POST", path, map[string]any{"photos": []any{}}); status != 400 {
		t.Fatalf("empty photos status=%d", status)
	}
}

// FF3：序列号注册的元素类型与空值语义对齐既有行为。
func TestSourceSerialRegistrationInputShapes(t *testing.T) {
	c, _ := setup(t)
	if status, body := c.request("POST", "/api/v1/serial-numbers", map[string]any{"serial_nos": []any{}}); body["code"] == float64(0) || fmtMessage(body) != "序列号不能为空" {
		t.Fatalf("empty serial list: %d %#v", status, body)
	}
	if status, body := c.request("POST", "/api/v1/serial-numbers", map[string]any{}); body["code"] == float64(0) || fmtMessage(body) != "序列号不能为空" {
		t.Fatalf("missing serial list: %d %#v", status, body)
	}
	if status, body := c.request("POST", "/api/v1/serial-numbers", map[string]any{"serial_nos": []any{float64(1)}}); status == 200 && body["code"] == float64(0) {
		t.Fatal("non-string serial accepted")
	}
	// 含空串元素时既有实现跳过空串、注册其余。
	product := c.ok("POST", "/api/v1/products", map[string]any{"code": "FF-SN", "name": "FF-SN"}).(map[string]any)
	warehouse := c.ok("GET", "/api/v1/warehouses", nil).(map[string]any)["list"].([]any)[0].(map[string]any)
	c.ok("POST", "/api/v1/serial-numbers", map[string]any{"serial_nos": []any{"FF-SN-1", ""}, "product_id": product["id"], "warehouse_id": warehouse["id"]})
	list := c.ok("GET", "/api/v1/serial-numbers?page_size=50", nil).(map[string]any)
	if !contains(trimJSON(list), "FF-SN-1") {
		t.Fatalf("serial not registered: %v", list)
	}
}

// FF7：unit_rate 被既有实现彻底忽略，任意数值都不影响金额计算。
func TestSourceUnitRateIsIgnored(t *testing.T) {
	c, product, warehouse, party := testFixture(t, "FF-RATE")
	customer := party["customer"].(map[string]any)
	for _, rate := range []any{float64(2), float64(0), 1} {
		order := c.ok("POST", "/api/v1/sales-orders", map[string]any{
			"customer_id": customer["id"], "warehouse_id": warehouse["id"],
			"lines": []any{map[string]any{"product_id": product["id"], "qty": 3, "price": 10, "unit_rate": rate}},
		}).(map[string]any)
		if order["total_amount"] != "30" || order["total_qty"] != "3" {
			t.Fatalf("unit_rate %v changed totals: %v / %v", rate, order["total_amount"], order["total_qty"])
		}
		line := srcLine(t, order, 0)
		if line["amount"] != "30" {
			t.Fatalf("unit_rate %v changed line amount: %v", rate, line["amount"])
		}
	}
	// 非数字值：既有实现同样无区分证据（未能构造出与「忽略」相区分的观测），
	// 本实现一并放行，不自造「格式错误」文案。此处固化该决策。
	if _, body := c.request("POST", "/api/v1/sales-orders", map[string]any{
		"customer_id": customer["id"], "warehouse_id": warehouse["id"],
		"lines": []any{map[string]any{"product_id": product["id"], "qty": 1, "price": 1, "unit_rate": "abc"}},
	}); body["code"] != float64(0) {
		t.Fatalf("non-numeric unit_rate should be ignored like the original: %#v", body)
	}
}

// FF6：本实现保留 1000 行上限（既有实现无上限，属资源保护的已知差异）。
func TestSourceLineLimitRemainsAsResourceGuard(t *testing.T) {
	c, product, warehouse, party := testFixture(t, "FF-LIMIT")
	lines := make([]any, 0, 1001)
	for i := 0; i < 1001; i++ {
		lines = append(lines, map[string]any{"product_id": product["id"], "qty": 1, "price": 1})
	}
	if _, body := c.request("POST", "/api/v1/sales-orders", map[string]any{
		"customer_id": party["customer"].(map[string]any)["id"], "warehouse_id": warehouse["id"], "lines": lines,
	}); body["code"] == float64(0) {
		t.Fatalf("1001 lines accepted, resource guard lost: %#v", body)
	}
	thousand := lines[:1000]
	if _, body := c.request("POST", "/api/v1/sales-orders", map[string]any{
		"customer_id": party["customer"].(map[string]any)["id"], "warehouse_id": warehouse["id"], "lines": thousand,
	}); body["code"] != float64(0) {
		t.Fatalf("1000 lines should be accepted: %#v", body)
	}
}

// FF2：入库照片的库位/货架不被强制校验（既有实现带异仓 location_id 也放行）。
func TestSourceStockPhotoAcceptsForeignLocation(t *testing.T) {
	c, product, warehouse, _ := testFixture(t, "FF-LOC")
	location := c.ok("POST", "/api/v1/locations", map[string]any{"name": "FF-LOC", "warehouse_id": warehouse["id"]}).(map[string]any)
	in := c.ok("POST", "/api/v1/stock-ins", map[string]any{"warehouse_id": warehouse["id"], "lines": []any{
		map[string]any{"product_id": product["id"], "qty": 1, "unit_cost": 1},
	}}).(map[string]any)
	// 照片挂在已确认的入库单上。
	c.ok("POST", "/api/v1/stock-ins/"+in["id"].(string)+"/confirm", nil)
	c.ok("POST", "/api/v1/stock-ins/"+in["id"].(string)+"/photos", map[string]any{"photos": []any{
		map[string]any{"url": "/uploads/images/loc.png", "location_id": location["id"]},
	}})
	// 明细携带异仓 warehouse_id 时建单仍按表头仓库放行。
	other := c.ok("POST", "/api/v1/stock-ins", map[string]any{
		"warehouse_id": warehouse["id"], "lines": []any{
			map[string]any{"product_id": product["id"], "qty": 1, "unit_cost": 1, "warehouse_id": "00000000-0000-0000-0000-000000000099"},
		},
	}).(map[string]any)
	if other["warehouse_id"] != warehouse["id"] {
		t.Fatalf("header warehouse overridden by line: %v", other["warehouse_id"])
	}
	if !strings.Contains(trimJSON(other), product["id"].(string)) {
		t.Fatal("line with foreign warehouse was dropped")
	}
}

func itoa(i int) string {
	if i == 0 {
		return "0"
	}
	var b []byte
	for i > 0 {
		b = append([]byte{byte('0' + i%10)}, b...)
		i /= 10
	}
	return string(b)
}
