package api

import (
	"context"
	"fmt"
	"testing"
)

// 批次 PP（2026-10-15）· 装配单组件明细的**七段校验**与 PUT 重写语义。
//
// 每一条期望值都来自回归回放，不是推测。证据文件：
//   运行快照,2,3,4,5}-20261015.txt  （POST）
//   运行快照,2,3}-20261015.txt        （PUT）
//
// 这些用例存在的理由：七段顺序里有三处**反直觉**，写成朴素的「逐行循环依次校验」
// 就会错，靠用例钉死：
//   · ⑫ 行1 qty=0 / 行2 UUID 非法  → 报 UUID 错（不是行1 的数量错）
//   · ⑭ 行1 qty=0 / 行2 缺 product_id → 报商品错（不是行1 的数量错）
//   · ⑯ 行1 缺 product_id / 行2 qty="abc" → 报数值错（不是行1 的商品错）
const ppGhostProduct = "00000000-0000-4000-8000-000000000001"

// ppLine 造一条明细行；pid 传 nil 表示**不带 product_id 键**。
func ppLine(pid any, qty any) map[string]any {
	line := map[string]any{}
	if pid != nil {
		line["product_id"] = pid
	}
	if qty != nil {
		line["qty"] = qty
	}
	return line
}

func TestAssemblyLineValidationSegments(t *testing.T) {
	c, s := setup(t)
	products, _ := s.Store.Rows(context.Background(), "SELECT id FROM products WHERE deleted_at IS NULL LIMIT 2")
	warehouses, _ := s.Store.Rows(context.Background(), "SELECT id FROM warehouses WHERE deleted_at IS NULL LIMIT 1")
	if len(products) == 0 || len(warehouses) == 0 {
		t.Skip("missing seed product or warehouse")
	}
	pid := fmt.Sprint(products[0]["id"])
	pid2 := pid
	if len(products) > 1 {
		pid2 = fmt.Sprint(products[1]["id"])
	}
	wid := fmt.Sprint(warehouses[0]["id"])

	const serverErr = "系统内部错误，请稍后重试或联系管理员"
	cases := []struct {
		name    string
		lines   any
		status  int
		code    float64
		message string
	}{
		// ── A 段：lines 缺失 / nil / 空数组 ──
		{"A 缺 lines", nil, 200, 10000, "组件明细不能为空"},
		{"A 空数组", []any{}, 200, 10000, "组件明细不能为空"},
		// ── B 段：形状非法 → 通用 400 ──
		{"B lines 非数组", "abc", 400, 400, serverErr},
		{"B lines 是对象", map[string]any{"a": 1}, 400, 400, serverErr},
		{"B 行是数字", []any{1}, 400, 400, serverErr},
		{"B 行是字符串", []any{"abc"}, 400, 400, serverErr},
		// ── E 段：行缺 product_id（null 行按空对象处理）──
		{"E 行是 null", []any{nil}, 200, 10000, "所选商品不存在或已被删除"},
		{"E 行是空对象", []any{ppLine(nil, 1)}, 200, 10000, "所选商品不存在或已被删除"},
		// ── C 段：product_id 非合法 UUID ──
		{"C 非法 UUID", []any{ppLine("not-a-uuid", 1)}, 400, 400, "请求参数错误: invalid UUID length: 10"},
		{"C 空串 UUID", []any{ppLine("", 1)}, 400, 400, "请求参数错误: invalid UUID length: 0"},
		// ── D 段：qty / unit_cost 非数值 ──
		{"D qty 非数值", []any{ppLine(pid, "abc")}, 400, 400, "请求参数错误: error decoding string 'abc': can't convert abc to decimal"},
		{"D unit_cost 非数值", []any{map[string]any{"product_id": pid, "qty": 1, "unit_cost": "abc"}}, 400, 400,
			"请求参数错误: error decoding string 'abc': can't convert abc to decimal"},
		// ── F 段：合法 UUID 但查无此商品 → 通用 500（与 E 是两套形态）──
		{"F 幽灵商品", []any{ppLine(ppGhostProduct, 1)}, 500, 500, serverErr},
		// ── G 段：数量为正 ──
		{"G qty=0", []any{ppLine(pid, 0)}, 200, 10000, "组件数量必须大于0"},
		{"G qty=-1", []any{ppLine(pid, -1)}, 200, 10000, "组件数量必须大于0"},
		{"G 缺 qty", []any{ppLine(pid, nil)}, 200, 10000, "组件数量必须大于0"},
		// ── 顺序反例：前段优先于后段，且是**全量前置**不是逐行短路 ──
		{"序⑨ UUID 先于数值", []any{map[string]any{"product_id": "not-a-uuid", "qty": "abc"}}, 400, 400, "请求参数错误: invalid UUID length: 10"},
		{"序⑪ 行1 UUID 非法优先", []any{ppLine("not-a-uuid", 1), ppLine(pid2, 0)}, 400, 400, "请求参数错误: invalid UUID length: 10"},
		{"序⑫ 行2 UUID 非法覆盖行1 数量错", []any{ppLine(pid, 0), ppLine("not-a-uuid", 1)}, 400, 400, "请求参数错误: invalid UUID length: 10"},
		{"序⑭ 行2 缺商品覆盖行1 数量错", []any{ppLine(pid, 0), ppLine(nil, 1)}, 200, 10000, "所选商品不存在或已被删除"},
		{"序⑮ 行1 缺商品优先", []any{ppLine(nil, 1), ppLine(pid2, 0)}, 200, 10000, "所选商品不存在或已被删除"},
		{"序⑯ 行2 数值错覆盖行1 商品错", []any{ppLine(nil, 1), ppLine(pid2, "abc")}, 400, 400,
			"请求参数错误: error decoding string 'abc': can't convert abc to decimal"},
		{"序⑬ 仅数量错", []any{ppLine(pid, 0), ppLine(pid2, 1)}, 200, 10000, "组件数量必须大于0"},
	}
	for i, tc := range cases {
		body := map[string]any{
			"assembly_no":  fmt.Sprintf("ASMPP-SEG-%02d", i),
			"warehouse_id": wid,
			"product_id":   pid,
			"qty":          1,
		}
		if tc.lines != nil {
			body["lines"] = tc.lines
		}
		status, got := c.request("POST", "/api/v1/assemblies", body)
		if status != tc.status || got["code"] != tc.code || got["message"] != tc.message {
			t.Errorf("%s = http%d code=%v message=%v, want http%d code=%v message=%s",
				tc.name, status, got["code"], got["message"], tc.status, tc.code, tc.message)
		}
	}
}

// TestAssemblyUnitCostMayBeNegative 既有实现允许 unit_cost 为负（与 qty 不同）。
// 回放：unit_cost=-1 → code:0 建单成功（audit-batch-pp-lines-shape5-20261015.txt ⑱）。
func TestAssemblyUnitCostMayBeNegative(t *testing.T) {
	c, s := setup(t)
	products, _ := s.Store.Rows(context.Background(), "SELECT id FROM products WHERE deleted_at IS NULL LIMIT 1")
	warehouses, _ := s.Store.Rows(context.Background(), "SELECT id FROM warehouses WHERE deleted_at IS NULL LIMIT 1")
	if len(products) == 0 || len(warehouses) == 0 {
		t.Skip("missing seed product or warehouse")
	}
	created := c.ok("POST", "/api/v1/assemblies", map[string]any{
		"assembly_no": "ASMPP-NEGCOST", "warehouse_id": fmt.Sprint(warehouses[0]["id"]),
		"product_id": fmt.Sprint(products[0]["id"]), "qty": 1,
		"lines": []any{map[string]any{"product_id": fmt.Sprint(products[0]["id"]), "qty": 1, "unit_cost": -1}},
	}).(map[string]any)
	got := c.ok("GET", "/api/v1/assemblies/"+created["id"].(string), nil).(map[string]any)
	lines, _ := got["edges"].(map[string]any)["lines"].([]any)
	if len(lines) != 1 {
		t.Fatalf("明细条数 = %d, want 1", len(lines))
	}
	if got := fmt.Sprint(lines[0].(map[string]any)["unit_cost"]); got != "-1" {
		t.Errorf("unit_cost 落库 = %s, want -1（既有实现原样落库，不拒绝负数）", got)
	}
}

// TestAssemblyPutRewritesLines PUT 的明细**整体重写**语义（批次 PP，
// audit-batch-pp-put-lines{,2,3}-20261015.txt）。
//
// 既有行为，三条全部与「只改表头」的直觉相反：
//   · 带 lines（含空数组）→ 软删旧行 + 写入新行
//   · 不带 lines          → 只清空明细，**不**报「组件明细不能为空」
//   · 校验比 POST 少一段：**不校验数量为正**（qty=0 原样落库）
func TestAssemblyPutRewritesLines(t *testing.T) {
	c, s := setup(t)
	products, _ := s.Store.Rows(context.Background(), "SELECT id FROM products WHERE deleted_at IS NULL LIMIT 2")
	warehouses, _ := s.Store.Rows(context.Background(), "SELECT id FROM warehouses WHERE deleted_at IS NULL LIMIT 1")
	if len(products) == 0 || len(warehouses) == 0 {
		t.Skip("missing seed product or warehouse")
	}
	pid := fmt.Sprint(products[0]["id"])
	pid2 := pid
	if len(products) > 1 {
		pid2 = fmt.Sprint(products[1]["id"])
	}
	wid := fmt.Sprint(warehouses[0]["id"])

	// newOrder 建一张带 1 行明细的装配单，返回其 id
	newOrder := func(no string) string {
		created := c.ok("POST", "/api/v1/assemblies", map[string]any{
			"assembly_no": no, "warehouse_id": wid, "product_id": pid, "qty": 1,
			"lines": []any{map[string]any{"product_id": pid2, "qty": 1, "unit_cost": 1}},
		}).(map[string]any)
		return created["id"].(string)
	}
	put := func(id string, extra map[string]any) (int, map[string]any) {
		body := map[string]any{"assembly_no": "x", "warehouse_id": wid, "product_id": pid, "qty": 1}
		for k, v := range extra {
			body[k] = v
		}
		return c.request("PUT", "/api/v1/assemblies/"+id, body)
	}
	lineCount := func(id string) int {
		got := c.ok("GET", "/api/v1/assemblies/"+id, nil).(map[string]any)
		lines, _ := got["edges"].(map[string]any)["lines"].([]any)
		return len(lines)
	}

	// ① 带 2 行 → 明细重写为 2 行
	id := newOrder("ASMPP-PUT-1")
	if status, body := put(id, map[string]any{
		"assembly_no": "ASMPP-PUT-1",
		"lines":       []any{ppLine(pid, 2), ppLine(pid2, 3)},
	}); status != 200 || body["code"] != float64(0) {
		t.Errorf("PUT 带 2 行 = http%d %v, want 200 code=0", status, body)
	}
	if got := lineCount(id); got != 2 {
		t.Errorf("PUT 后明细行数 = %d, want 2（既有实现整体重写）", got)
	}
	// ② 不带 lines → 明细清空，且不报「组件明细不能为空」
	id2 := newOrder("ASMPP-PUT-2")
	if status, body := put(id2, map[string]any{"assembly_no": "ASMPP-PUT-2", "qty": 5}); status != 200 || body["code"] != float64(0) {
		t.Errorf("PUT 不带 lines = http%d %v, want 200 code=0", status, body)
	}
	if got := lineCount(id2); got != 0 {
		t.Errorf("PUT 不带 lines 后明细行数 = %d, want 0（既有实现清空）", got)
	}
	// ③ lines=[] → 同样清空
	id3 := newOrder("ASMPP-PUT-3")
	if status, body := put(id3, map[string]any{"assembly_no": "ASMPP-PUT-3", "lines": []any{}}); status != 200 || body["code"] != float64(0) {
		t.Errorf("PUT lines=[] = http%d %v, want 200 code=0", status, body)
	}
	if got := lineCount(id3); got != 0 {
		t.Errorf("PUT lines=[] 后明细行数 = %d, want 0", got)
	}
	// ④ PUT 复用 B/C/D/E/F 五段校验，但**不含 G（数量为正）**
	putCases := []struct {
		name    string
		lines   any
		status  int
		code    float64
		message string
	}{
		{"B lines 非数组", "abc", 400, 400, "系统内部错误，请稍后重试或联系管理员"},
		{"C UUID 非法", []any{ppLine("not-a-uuid", 1)}, 400, 400, "请求参数错误: invalid UUID length: 10"},
		{"D qty 非数值", []any{ppLine(pid2, "abc")}, 400, 400, "请求参数错误: error decoding string 'abc': can't convert abc to decimal"},
		{"E 缺 product_id", []any{ppLine(nil, 1)}, 200, 10000, "所选商品不存在或已被删除"},
		{"F 幽灵商品", []any{ppLine(ppGhostProduct, 1)}, 500, 500, "系统内部错误，请稍后重试或联系管理员"},
		{"G 不校验数量为正", []any{ppLine(pid2, 0)}, 200, 0, ""},
	}
	for i, tc := range putCases {
		id := newOrder(fmt.Sprintf("ASMPP-PUTV-%02d", i))
		status, body := put(id, map[string]any{"assembly_no": fmt.Sprintf("ASMPP-PUTV-%02d", i), "lines": tc.lines})
		if status != tc.status || body["code"] != tc.code {
			t.Errorf("PUT %s = http%d code=%v, want http%d code=%v", tc.name, status, body["code"], tc.status, tc.code)
			continue
		}
		if tc.message != "" && body["message"] != tc.message {
			t.Errorf("PUT %s message = %v, want %s", tc.name, body["message"], tc.message)
		}
	}
	// ⑤ qty=0 必须**原样落库**（不是被静默改成别的值）
	id5 := newOrder("ASMPP-PUT-ZERO")
	put(id5, map[string]any{"assembly_no": "ASMPP-PUT-ZERO", "lines": []any{ppLine(pid2, 0)}})
	got := c.ok("GET", "/api/v1/assemblies/"+id5, nil).(map[string]any)
	lines, _ := got["edges"].(map[string]any)["lines"].([]any)
	if len(lines) != 1 {
		t.Fatalf("qty=0 后明细行数 = %d, want 1", len(lines))
	}
	if q := fmt.Sprint(lines[0].(map[string]any)["qty"]); q != "0" {
		t.Errorf("qty 落库 = %s, want 0（既有实现原样落库）", q)
	}
}
