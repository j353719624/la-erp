package api

import (
	"context"
	"fmt"
	"testing"

	"github.com/google/uuid"

	"la-erp-recovered/backend/internal/database"
)

// ppStock 给「商品 + 仓库」准备一行库存余额。
//
// 批次 PP（2026-10-15）：原版 confirm 会校验组件库存，库存为 0 时回
// 200 + 10000「库存不足」。测试库默认无库存行，故先铺一行。
// 注：inventory_balances 表**没有 deleted_at 列**（见 schema.sql）。
func ppStock(t *testing.T, s *Server, productID, warehouseID, qty string) {
	t.Helper()
	// 唯一索引是 (product_id, warehouse_id, location_id, rack_id, batch_no) 五列，
	// 故这里先清后插，避免 UPSERT 的冲突列写不全。
	if _, err := s.Store.DB.Exec("DELETE FROM inventory_balances WHERE product_id=? AND warehouse_id=?", productID, warehouseID); err != nil {
		t.Fatalf("清理库存失败: %v", err)
	}
	if _, err := s.Store.DB.Exec(`INSERT INTO inventory_balances
		(id,created_at,updated_at,product_id,warehouse_id,qty_available,qty_locked,qty_in_transit,avg_cost,tenant_id)
		VALUES(?,?,?,?,?,?,0,0,0,?)`,
		uuid.NewString(), database.Now(), database.Now(), productID, warehouseID, qty, database.ZeroUUID); err != nil {
		t.Fatalf("准备库存失败: %v", err)
	}
}

func TestAssemblyOrderLifecycleGuards(t *testing.T) {
	c, s := setup(t)
	products, _ := s.Store.Rows(context.Background(), "SELECT id,name,code FROM products WHERE deleted_at IS NULL LIMIT 1")
	warehouses, _ := s.Store.Rows(context.Background(), "SELECT id,name FROM warehouses WHERE deleted_at IS NULL LIMIT 1")
	if len(products) == 0 || len(warehouses) == 0 {
		t.Skip("missing seed product or warehouse")
	}
	// confirm 会扣组件库存，先铺货（组件 qty=1）
	ppStock(t, s, fmt.Sprint(products[0]["id"]), fmt.Sprint(warehouses[0]["id"]), "100")
	// 批次 PP（2026-10-15）：原版建装配单**必须带组件明细**，缺 lines 或空数组
	// 一律回 200 + 10000「组件明细不能为空」（audit-batch-pp-assembly-20261015.txt）。
	// 恢复端原先不校验也不落库，建单成功但组件清单为空。
	order := c.ok("POST", "/api/v1/assemblies", map[string]any{
		"assembly_no": "ASM-2099-01",
		"warehouse_id": warehouses[0]["id"],
		"product_id":  products[0]["id"],
		"product_name": products[0]["name"],
		"product_code": products[0]["code"],
		"qty":          "1",
		"unit_cost":    "10",
		"total_cost":   "10",
		"lines":        []any{map[string]any{"product_id": products[0]["id"], "qty": 1, "unit_cost": 10}},
	}).(map[string]any)
	id := order["id"].(string)
	confirmed := c.ok("POST", "/api/v1/assemblies/"+id+"/confirm", map[string]any{}).(map[string]any)
	if confirmed["status"] != "confirmed" {
		t.Fatalf("unexpected confirm state: %#v", confirmed)
	}
	status, response := c.request("POST", "/api/v1/assemblies/"+id+"/confirm", map[string]any{})
	if status != 200 || response["code"] != float64(10000) {
		t.Fatalf("repeat confirm response=%d %#v", status, response)
	}
}

// TestAssemblyLinesRequiredAndPersisted 装配单组件明细的两个缺口：
//   ① 缺 lines / 空数组 → 200 + 10000「组件明细不能为空」（原版同形）
//   ② 带 lines 建单后明细**必须落库**（恢复端原先恒为空）
func TestAssemblyLinesRequiredAndPersisted(t *testing.T) {
	c, s := setup(t)
	products, _ := s.Store.Rows(context.Background(), "SELECT id,name,code FROM products WHERE deleted_at IS NULL LIMIT 1")
	warehouses, _ := s.Store.Rows(context.Background(), "SELECT id,name FROM warehouses WHERE deleted_at IS NULL LIMIT 1")
	if len(products) == 0 || len(warehouses) == 0 {
		t.Skip("missing seed product or warehouse")
	}
	head := func(no string) map[string]any {
		return map[string]any{
			"assembly_no": no, "warehouse_id": warehouses[0]["id"],
			"product_id": products[0]["id"], "qty": "1",
		}
	}
	// ① 缺 lines
	if status, body := c.request("POST", "/api/v1/assemblies", head("ASM-PP-NOLINE")); status != 200 ||
		body["code"] != float64(10000) || body["message"] != "组件明细不能为空" {
		t.Errorf("缺 lines = %d %v, want 200/10000 组件明细不能为空", status, body)
	}
	// ① 空数组
	empty := head("ASM-PP-EMPTY")
	empty["lines"] = []any{}
	if status, body := c.request("POST", "/api/v1/assemblies", empty); status != 200 ||
		body["code"] != float64(10000) || body["message"] != "组件明细不能为空" {
		t.Errorf("空 lines = %d %v, want 200/10000 组件明细不能为空", status, body)
	}
	// ② 带明细建单后必须落库
	full := head("ASM-PP-FULL")
	full["lines"] = []any{
		map[string]any{"product_id": products[0]["id"], "qty": 2, "unit_cost": 3.5, "batch_no": "B1", "remark": "明细备注"},
	}
	created := c.ok("POST", "/api/v1/assemblies", full).(map[string]any)
	id := created["id"].(string)
	got := c.ok("GET", "/api/v1/assemblies/"+id, nil).(map[string]any)
	lines, _ := got["edges"].(map[string]any)["lines"].([]any)
	if len(lines) != 1 {
		t.Fatalf("明细条数 = %d, want 1（原版落库，恢复端原先为 0）", len(lines))
	}
	line := lines[0].(map[string]any)
	if fmt.Sprint(line["qty"]) != "2" || fmt.Sprint(line["unit_cost"]) != "3.5" {
		t.Errorf("明细行 = %#v, want qty=2 unit_cost=3.5", line)
	}
	if fmt.Sprint(line["assembly_id"]) != id {
		t.Errorf("明细 assembly_id = %v, want %s", line["assembly_id"], id)
	}
}

// TestAssemblyConfirmStockEffects 装配单 confirm 的库存副作用（批次 PP）。
//
// 原版 confirm 不只是改状态：
//   ① 组件库存不足 → 200 + 10000「库存不足」，整体回滚
//   ② 成功后产生**两条** stock_movements：组件出（dir=-1）+ 成品入（dir=1）
//   ③ 成品入库 unit_cost = 组件总成本 ÷ 成品数量
// 恢复端原先三者全缺：只改状态，库存与流水纹丝不动。
func TestAssemblyConfirmStockEffects(t *testing.T) {
	c, s := setup(t)
	products, _ := s.Store.Rows(context.Background(), "SELECT id,name,code FROM products WHERE deleted_at IS NULL LIMIT 1")
	warehouses, _ := s.Store.Rows(context.Background(), "SELECT id,name FROM warehouses WHERE deleted_at IS NULL LIMIT 1")
	if len(products) == 0 || len(warehouses) == 0 {
		t.Skip("missing seed product or warehouse")
	}
	pid, wid := fmt.Sprint(products[0]["id"]), fmt.Sprint(warehouses[0]["id"])

	// ── ① 库存不足必须被拒 ──────────────────────────────────────────
	ppStock(t, s, pid, wid, "1")
	over := c.ok("POST", "/api/v1/assemblies", map[string]any{
		"assembly_no": "ASM-PP-OVER", "warehouse_id": wid, "product_id": pid, "qty": 1,
		"lines": []any{map[string]any{"product_id": pid, "qty": 999999, "unit_cost": 1}},
	}).(map[string]any)
	if status, body := c.request("POST", "/api/v1/assemblies/"+over["id"].(string)+"/confirm", map[string]any{}); status != 200 ||
		body["code"] != float64(10000) || body["message"] != "库存不足" {
		t.Errorf("超量 confirm = %d %v, want 200/10000 库存不足", status, body)
	}
	// 被拒后库存与流水都不应有变化
	ppAssertStock(t, s, pid, wid, "1")
	ppAssertMoves(t, s, over["id"].(string), 0)

	// ── ② 成功后两条流水 + 库存变动 ──────────────────────────────────
	ppStock(t, s, pid, wid, "10")
	ok1 := c.ok("POST", "/api/v1/assemblies", map[string]any{
		"assembly_no": "ASM-PP-OK", "warehouse_id": wid, "product_id": pid, "qty": 2,
		"lines": []any{map[string]any{"product_id": pid, "qty": 1, "unit_cost": 7}},
	}).(map[string]any)
	c.ok("POST", "/api/v1/assemblies/"+ok1["id"].(string)+"/confirm", map[string]any{})
	// 组件出 1、成品入 2 → 10 - 1 + 2 = 11
	ppAssertStock(t, s, pid, wid, "11")
	moves := ppMoves(t, s, ok1["id"].(string))
	if len(moves) != 2 {
		t.Fatalf("流水条数 = %d, want 2（组件出 + 成品入）", len(moves))
	}
	byType := map[string]map[string]any{}
	for _, m := range moves {
		byType[fmt.Sprint(m["type"])] = m
	}
	out, in := byType["out"], byType["in"]
	if out == nil || in == nil {
		t.Fatalf("缺少 in/out 流水: %#v", byType)
	}
	// 组件出库：qty=1, unit_cost=7, total_cost=7, remark="组装 {单号} 行1"
	if fmt.Sprint(out["qty"]) != "1" || fmt.Sprint(out["unit_cost"]) != "7" || fmt.Sprint(out["total_cost"]) != "7" {
		t.Errorf("出库流水 = %#v, want qty=1 unit_cost=7 total_cost=7", out)
	}
	if fmt.Sprint(out["direction"]) != "-1" {
		t.Errorf("出库 direction = %v, want -1", out["direction"])
	}
	// 成品入库：qty=2, unit_cost=7/2=3.5, total_cost=7
	if fmt.Sprint(in["qty"]) != "2" || fmt.Sprint(in["total_cost"]) != "7" {
		t.Errorf("入库流水 = %#v, want qty=2 total_cost=7", in)
	}
	if got := fmt.Sprint(in["unit_cost"]); got != "3.5" {
		t.Errorf("入库 unit_cost = %s, want 3.5（组件总成本÷成品数）", got)
	}
	if fmt.Sprint(in["direction"]) != "1" {
		t.Errorf("入库 direction = %v, want 1", in["direction"])
	}
}

func ppAssertStock(t *testing.T, s *Server, productID, warehouseID, want string) {
	t.Helper()
	rows, err := s.Store.Rows(context.Background(),
		"SELECT qty_available FROM inventory_balances WHERE product_id=? AND warehouse_id=?", productID, warehouseID)
	if err != nil || len(rows) == 0 {
		t.Fatalf("查库存失败: %v rows=%d", err, len(rows))
	}
	if got := fmt.Sprint(rows[0]["qty_available"]); got != want {
		t.Errorf("库存 = %s, want %s", got, want)
	}
}

func ppMoves(t *testing.T, s *Server, sourceID string) []map[string]any {
	t.Helper()
	rows, err := s.Store.Rows(context.Background(),
		"SELECT * FROM stock_movements WHERE source_id=? ORDER BY id", sourceID)
	if err != nil {
		t.Fatalf("查流水失败: %v", err)
	}
	return rows
}

func ppAssertMoves(t *testing.T, s *Server, sourceID string, want int) {
	t.Helper()
	if got := len(ppMoves(t, s, sourceID)); got != want {
		t.Errorf("流水条数 = %d, want %d", got, want)
	}
}
