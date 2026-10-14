package api

import (
	"fmt"
	"strings"
	"testing"
)

// 本文件固化批次 M 取证（2026-10-14）的结论：盘点不比对账面与实时余额、
// 成本型调整接受任意数量。证据见 evidence/backend-runtime/audit-batch-m-20261014.json。

// KK9：盘点期间账面被改动不影响提交，原版仍按创建时的 book_qty 算差异。
func TestRecoveredStocktakeToleratesBookQuantityDrift(t *testing.T) {
	c, product, warehouse, _ := recoveredFixture(t, "KK-DRIFT")
	check := c.ok("POST", "/api/v1/inventory-checks", map[string]any{
		"warehouse_id": warehouse["id"],
		"lines":        []any{map[string]any{"product_id": product["id"]}},
	}).(map[string]any)
	path := "/api/v1/inventory-checks/" + check["id"].(string)
	c.ok("POST", path+"/start", nil)

	// 记录创建时的账面数
	detail := c.ok("GET", path, nil).(map[string]any)
	line := detail["edges"].(map[string]any)["lines"].([]any)[0].(map[string]any)
	book := line["book_qty"].(string)

	// 盘点期间入库，实时余额与账面不一致
	seed := c.ok("POST", "/api/v1/stock-ins", map[string]any{
		"warehouse_id": warehouse["id"],
		"lines":        []any{map[string]any{"product_id": product["id"], "qty": 100, "unit_cost": 5}},
	}).(map[string]any)
	c.ok("POST", "/api/v1/stock-ins/"+seed["id"].(string)+"/confirm", nil)

	// 提交实盘数：原版放行，且差异仍按 book_qty 计算
	target := float64(3)
	if v, err := parseFloat(book); err == nil {
		target = v + 3
	}
	c.ok("PUT", path, map[string]any{
		"warehouse_id": warehouse["id"],
		"lines":        []any{map[string]any{"product_id": product["id"], "actual_qty": target}},
	})
	after := c.ok("GET", path, nil).(map[string]any)
	l2 := after["edges"].(map[string]any)["lines"].([]any)[0].(map[string]any)
	if l2["book_qty"] != book {
		t.Fatalf("book_qty must stay at the value captured at create time: %v vs %v", l2["book_qty"], book)
	}
	if l2["diff_qty"] != "3" || l2["diff_type"] != "profit" {
		t.Fatalf("diff must be computed from book_qty: %#v", l2)
	}
	// complete 不应被账面漂移阻断
	done := c.ok("POST", path+"/complete", nil).(map[string]any)
	if done["id"] != check["id"] {
		t.Fatal("complete should succeed despite book quantity drift")
	}
}

// KK9b：盘点中提交原单上没有的明细行 —— 原版整体替换行集（批次 P）。
func TestRecoveredStocktakeRejectsUnknownLine(t *testing.T) {
	c, product, warehouse, _ := recoveredFixture(t, "KK-NEWLINE")
	check := c.ok("POST", "/api/v1/inventory-checks", map[string]any{
		"warehouse_id": warehouse["id"],
		"lines":        []any{map[string]any{"product_id": product["id"]}},
	}).(map[string]any)
	path := "/api/v1/inventory-checks/" + check["id"].(string)
	c.ok("POST", path+"/start", nil)
	// 批次 P 实测（2026-10-14）：提交原单上没有的商品，原版同样放行——
	// 明细被整体替换，新行 book_qty 取当前实时余额。恢复端原先返回「盘点明细不存在」，属误拒。
	other := c.ok("POST", "/api/v1/products", map[string]any{"code": "KK-NEWLINE-P", "name": "KK-NEWLINE-P"}).(map[string]any)
	c.ok("PUT", path, map[string]any{
		"warehouse_id": warehouse["id"],
		"lines":        []any{map[string]any{"product_id": other["id"], "actual_qty": 7}},
	})
	detail := c.ok("GET", path, nil).(map[string]any)
	lines := detail["edges"].(map[string]any)["lines"].([]any)
	if len(lines) != 1 || lines[0].(map[string]any)["product_id"] != other["id"] {
		t.Fatalf("lines must be replaced wholesale, as the original does: %#v", lines)
	}
	line := lines[0].(map[string]any)
	if line["book_qty"] != "0" || line["diff_qty"] != "7" || line["diff_type"] != "profit" {
		t.Fatalf("new line must take book_qty from the live balance: %#v", line)
	}
	c.ok("POST", path+"/complete", nil)
}

// KK10：成本型调整接受任意数量，明细保留、表头 total_qty 归零。
func TestRecoveredCostAdjustmentAcceptsQuantity(t *testing.T) {
	c, product, warehouse, _ := recoveredFixture(t, "KK-COSTADJ")
	recoveredSeedStock(t, c, product, warehouse, 20, 10)
	adjust := c.ok("POST", "/api/v1/inventory-adjusts", map[string]any{
		"warehouse_id": warehouse["id"], "adjust_type": "cost",
		"lines": []any{map[string]any{"product_id": product["id"], "qty": 5, "unit_cost": 12}},
	}).(map[string]any)
	if adjust["total_qty"] != "0" {
		t.Fatalf("header total_qty must be normalised to 0 for cost adjustments: %v", adjust["total_qty"])
	}
	line := adjust["edges"].(map[string]any)["lines"].([]any)[0].(map[string]any)
	if line["qty"] != "5" {
		t.Fatalf("line qty should be kept as submitted: %v", line["qty"])
	}
	// confirm 必须通过
	c.ok("POST", "/api/v1/inventory-adjusts/"+adjust["id"].(string)+"/confirm", nil)
	// 均价已更新
	balances := c.ok("GET", "/api/v1/inventory-balances?product_id="+product["id"].(string)+"&warehouse_id="+warehouse["id"].(string), nil).(map[string]any)
	raw := trimJSON(balances)
	if !strings.Contains(raw, `"avg_cost":"12"`) {
		t.Fatalf("avg_cost not updated by cost adjustment: %s", raw)
	}
}

// 守卫分类：负损耗率属「有意不对齐原版缺陷」，不得再标为「尚未恢复」。
func TestRecoveredNegativeScrapIsMarkedAsOriginalDefect(t *testing.T) {
	c, product, _, _ := recoveredFixture(t, "KK-DEFECT")
	_, body := c.request("POST", "/api/v1/boms", map[string]any{
		"name": "KK 负损耗", "product_id": product["id"],
		"items": []any{map[string]any{"product_id": product["id"], "qty": 4, "scrap_rate": -0.1}},
	})
	if body["code"] == float64(0) {
		t.Fatal("negative scrap rate must stay rejected (it inflates demand)")
	}
	msg := fmtMessage(body)
	if strings.Contains(msg, "尚未恢复") {
		t.Fatalf("negative scrap must be reported as an intentional divergence, not as unrecovered: %#v", msg)
	}
	if !strings.Contains(msg, "原版") {
		t.Fatalf("message should explain the divergence: %#v", msg)
	}
}

func parseFloat(s string) (float64, error) {
	var f float64
	_, err := fmt.Sscan(s, &f)
	return f, err
}
