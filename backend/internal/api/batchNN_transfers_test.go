package api

import (
	"fmt"
	"testing"
)

// 本文件把批次 NN 的**两端对照取证结果**固化成回归测试。
//
// 背景：台账 37.6 留档的调拨单缺口只有一条直证（audit-batch-a 第 5 条「建调拨单」
// → 400 ToWarehouseID required），而本实现 `transfers.go` 的 POST 路由**完全没有
// 必填校验**，直接落到仓库存在性检查。本轮补齐取证后发现缺口远不止那一条：
// 校验顺序、PUT 语义、notFound 形态、以及两处自造文案全部与与既有行为不符。
//
// 证据（本轮新增）：
//   运行快照   13 条，2 一致
//   运行快照  10 条
//
// ⚠ 校验顺序是**逐条回放钉死的**，勿凭直觉调整（详见审计台账x）：
//   POST  必填(400) → 调出/调入仓相同 → 明细非空 → 数量>0 → 仓库引用(500) → 商品(10000)
//   PUT   必填(400) → 调出/调入仓相同 → 单据存在且草稿 → 明细允许空(清空) → 数量>0 …
// 其中「调出/调入仓相同」**早于单据存在性检查**（PUT 不存在的 id 且两仓相同
// → 报「调出仓与调入仓不能相同」，而不是「调拨单不存在或状态不允许修改」）。

const (
	nnGeneric500  = "系统内部错误，请稍后重试或联系管理员"
	nnMissingID   = "00000000-0000-0000-0000-000000000099"
	nnMissingProd = "00000000-0000-0000-0000-000000000001"
)

// nnTransferFixture 建好两个不同仓库与一个商品，返回各自的 id。
type nnTransferFixture struct {
	from, to, product string
}

func nnSetupTransfer(t *testing.T, c *client) nnTransferFixture {
	t.Helper()
	products := c.ok("GET", "/api/v1/products", nil).(map[string]any)["list"].([]any)
	warehouses := c.ok("GET", "/api/v1/warehouses", nil).(map[string]any)["list"].([]any)
	if len(products) == 0 || len(warehouses) == 0 {
		t.Fatal("种子数据缺商品或仓库")
	}
	from := warehouses[0].(map[string]any)["id"].(string)
	// 本实现种子只带一个仓库，补建第二个；既有实现有 5 个，直接取第二个。
	to := ""
	if len(warehouses) > 1 {
		to = warehouses[1].(map[string]any)["id"].(string)
	} else {
		to = c.ok("POST", "/api/v1/warehouses", map[string]any{"name": "NN 调入仓", "code": "NN-TO"}).(map[string]any)["id"].(string)
	}
	return nnTransferFixture{from: from, to: to, product: products[0].(map[string]any)["id"].(string)}
}

// TestNNTransferCreateValidation POST 建单的校验顺序与文案。
func TestNNTransferCreateValidation(t *testing.T) {
	c, _ := setup(t)
	f := nnSetupTransfer(t, c)
	line := []any{map[string]any{"product_id": f.product, "qty": 1}}

	both := "请求参数错误: Key: 'createTransferRequest.FromWarehouseID' Error:Field validation for 'FromWarehouseID' failed on the 'required' tag\n" +
		"Key: 'createTransferRequest.ToWarehouseID' Error:Field validation for 'ToWarehouseID' failed on the 'required' tag"
	onlyTo := "请求参数错误: Key: 'createTransferRequest.ToWarehouseID' Error:Field validation for 'ToWarehouseID' failed on the 'required' tag"
	onlyFrom := "请求参数错误: Key: 'createTransferRequest.FromWarehouseID' Error:Field validation for 'FromWarehouseID' failed on the 'required' tag"

	for _, tc := range []struct {
		tag     string
		body    map[string]any
		http    int
		code    float64
		message string
	}{
		{"空载荷", map[string]any{}, 400, 400, both},
		{"只有 from", map[string]any{"from_warehouse_id": f.from}, 400, 400, onlyTo},
		{"只有 to", map[string]any{"to_warehouse_id": f.to}, 400, 400, onlyFrom},
		{"两仓相同", map[string]any{"from_warehouse_id": f.from, "to_warehouse_id": f.from, "lines": line}, 200, 10000, "调出仓与调入仓不能相同"},
		{"无 lines", map[string]any{"from_warehouse_id": f.from, "to_warehouse_id": f.to}, 200, 10000, "调拨明细不能为空"},
		{"lines 空数组", map[string]any{"from_warehouse_id": f.from, "to_warehouse_id": f.to, "lines": []any{}}, 200, 10000, "调拨明细不能为空"},
		{"qty=0", map[string]any{"from_warehouse_id": f.from, "to_warehouse_id": f.to, "lines": []any{map[string]any{"product_id": f.product, "qty": 0}}}, 200, 10000, "调拨数量必须大于0"},
		{"qty 缺失", map[string]any{"from_warehouse_id": f.from, "to_warehouse_id": f.to, "lines": []any{map[string]any{"product_id": f.product}}}, 200, 10000, "调拨数量必须大于0"},
		{"qty=-1", map[string]any{"from_warehouse_id": f.from, "to_warehouse_id": f.to, "lines": []any{map[string]any{"product_id": f.product, "qty": -1}}}, 200, 10000, "调拨数量必须大于0"},
		// 数量校验**全量先于**商品检查：第一行商品不存在、第二行 qty=0 → 报数量错。
		{"商品不存在+qty=0", map[string]any{"from_warehouse_id": f.from, "to_warehouse_id": f.to, "lines": []any{map[string]any{"product_id": nnMissingProd, "qty": 0}}}, 200, 10000, "调拨数量必须大于0"},
		{"第一行商品不存在+第二行qty=0", map[string]any{"from_warehouse_id": f.from, "to_warehouse_id": f.to, "lines": []any{map[string]any{"product_id": nnMissingProd, "qty": 1}, map[string]any{"product_id": f.product, "qty": 0}}}, 200, 10000, "调拨数量必须大于0"},
		{"商品不存在", map[string]any{"from_warehouse_id": f.from, "to_warehouse_id": f.to, "lines": []any{map[string]any{"product_id": nnMissingProd, "qty": 1}}}, 200, 10000, "所选商品不存在或已被删除"},
		{"行缺 product_id", map[string]any{"from_warehouse_id": f.from, "to_warehouse_id": f.to, "lines": []any{map[string]any{"qty": 1}}}, 200, 10000, "所选商品不存在或已被删除"},
		// 仓库引用：既有实现由外键兜底落成 500，本实现显式降级对齐（非语义对齐）。
		{"from 不存在", map[string]any{"from_warehouse_id": nnMissingProd, "to_warehouse_id": f.to, "lines": line}, 500, 500, nnGeneric500},
		{"to 不存在", map[string]any{"from_warehouse_id": f.from, "to_warehouse_id": nnMissingProd, "lines": line}, 500, 500, nnGeneric500},
		// 仓库引用(500) 早于商品(10000)：两者都坏时以 500 为准。
		{"from 不存在+商品不存在", map[string]any{"from_warehouse_id": nnMissingProd, "to_warehouse_id": f.to, "lines": []any{map[string]any{"product_id": nnMissingProd, "qty": 1}}}, 500, 500, nnGeneric500},
		// 明细形状非法：HTTP 400，但套的是通用系统内部错误文案。
		{"lines 非数组", map[string]any{"from_warehouse_id": f.from, "to_warehouse_id": f.to, "lines": map[string]any{"a": 1}}, 400, 400, nnGeneric500},
		{"lines 元素非对象", map[string]any{"from_warehouse_id": f.from, "to_warehouse_id": f.to, "lines": []any{1, 2}}, 400, 400, nnGeneric500},
		// 数值解码：非数字串按既有实现 decimal 解码失败输出。
		{"qty 非数字", map[string]any{"from_warehouse_id": f.from, "to_warehouse_id": f.to, "lines": []any{map[string]any{"product_id": f.product, "qty": "abc"}}}, 400, 400, "请求参数错误: error decoding string 'abc': can't convert abc to decimal"},
		{"cost_price 非数字", map[string]any{"from_warehouse_id": f.from, "to_warehouse_id": f.to, "lines": []any{map[string]any{"product_id": f.product, "qty": 1, "cost_price": "abc"}}}, 400, 400, "请求参数错误: error decoding string 'abc': can't convert abc to decimal"},
	} {
		t.Run(tc.tag, func(t *testing.T) {
			status, body := c.request("POST", "/api/v1/stock-transfers", tc.body)
			if status != tc.http || body["code"] != tc.code || body["message"] != tc.message {
				t.Fatalf("%s = %d %v, want %d/%v/%s", tc.tag, status, body, tc.http, tc.code, tc.message)
			}
		})
	}
}

// TestNNTransferCreateAccepted 既有实现**放行**的组合（本实现不得误拒）。
//
// 原本实现在这里有两处自造限制，回放证明既有实现都没有：
//   · 明细「不超过1000行」—— 回放 1001 行 → code:0
//   · cost_price 不得为负   —— 回放 cost_price=-1 → code:0
func TestNNTransferCreateAccepted(t *testing.T) {
	c, _ := setup(t)
	f := nnSetupTransfer(t, c)
	base := map[string]any{"from_warehouse_id": f.from, "to_warehouse_id": f.to}

	// 1001 行：既有实现无行数上限。
	many := make([]any, 0, 1001)
	for i := 0; i < 1001; i++ {
		many = append(many, map[string]any{"product_id": f.product, "qty": 1})
	}
	body := base
	body["lines"] = many
	if status, got := c.request("POST", "/api/v1/stock-transfers", body); status != 200 || got["code"] != float64(0) {
		t.Fatalf("1001 行 = %d %v, want 200/0", status, got)
	}
	// 负成本：既有实现允许。
	status, got := c.request("POST", "/api/v1/stock-transfers", map[string]any{
		"from_warehouse_id": f.from, "to_warehouse_id": f.to,
		"lines": []any{map[string]any{"product_id": f.product, "qty": 1, "cost_price": -1}},
	})
	if status != 200 || got["code"] != float64(0) {
		t.Fatalf("cost_price 负 = %d %v, want 200/0", status, got)
	}
	// 同一商品多行：既有实现不去重。
	status, got = c.request("POST", "/api/v1/stock-transfers", map[string]any{
		"from_warehouse_id": f.from, "to_warehouse_id": f.to,
		"lines": []any{
			map[string]any{"product_id": f.product, "qty": 1},
			map[string]any{"product_id": f.product, "qty": 2},
		},
	})
	if status != 200 || got["code"] != float64(0) {
		t.Fatalf("同商品多行 = %d %v, want 200/0", status, got)
	}
}

// TestNNTransferUpdateSemantics PUT 的三处与 POST 不同的语义。
//
//   ① 必填校验同样存在，结构体名换为 updateTransferRequest
//   ② 「调出/调入仓相同」早于单据存在性检查
//   ③ lines 缺失/为空 → **清空明细并 code:0**（POST 是报「调拨明细不能为空」）
//   ④ 非草稿（含 id 不存在）→ 10000「调拨单不存在或状态不允许修改」
func TestNNTransferUpdateSemantics(t *testing.T) {
	c, _ := setup(t)
	f := nnSetupTransfer(t, c)
	line := []any{map[string]any{"product_id": f.product, "qty": 1}}

	doc := c.ok("POST", "/api/v1/stock-transfers", map[string]any{
		"from_warehouse_id": f.from, "to_warehouse_id": f.to, "lines": line,
	}).(map[string]any)
	id := doc["id"].(string)

	both := "请求参数错误: Key: 'updateTransferRequest.FromWarehouseID' Error:Field validation for 'FromWarehouseID' failed on the 'required' tag\n" +
		"Key: 'updateTransferRequest.ToWarehouseID' Error:Field validation for 'ToWarehouseID' failed on the 'required' tag"
	onlyTo := "请求参数错误: Key: 'updateTransferRequest.ToWarehouseID' Error:Field validation for 'ToWarehouseID' failed on the 'required' tag"
	onlyFrom := "请求参数错误: Key: 'updateTransferRequest.FromWarehouseID' Error:Field validation for 'FromWarehouseID' failed on the 'required' tag"

	for _, tc := range []struct {
		tag     string
		id      string
		body    map[string]any
		http    int
		code    float64
		message string
	}{
		{"空载荷", id, map[string]any{}, 400, 400, both},
		{"只有 from", id, map[string]any{"from_warehouse_id": f.from}, 400, 400, onlyTo},
		{"只有 to", id, map[string]any{"to_warehouse_id": f.to}, 400, 400, onlyFrom},
		// ② 早于单据存在性：不存在的 id 也先报「调出仓与调入仓不能相同」
		{"不存在id+两仓相同", nnMissingID, map[string]any{"from_warehouse_id": f.from, "to_warehouse_id": f.from, "lines": line}, 200, 10000, "调出仓与调入仓不能相同"},
		{"不存在id+完整载荷", nnMissingID, map[string]any{"from_warehouse_id": f.from, "to_warehouse_id": f.to, "lines": line}, 200, 10000, "调拨单不存在或状态不允许修改"},
		{"不存在id+无lines", nnMissingID, map[string]any{"from_warehouse_id": f.from, "to_warehouse_id": f.to}, 200, 10000, "调拨单不存在或状态不允许修改"},
		// ③ lines 空/缺失 → 清空明细并成功（POST 是报错）
		{"lines 空数组", id, map[string]any{"from_warehouse_id": f.from, "to_warehouse_id": f.to, "lines": []any{}}, 200, 0, "success"},
		{"无 lines", id, map[string]any{"from_warehouse_id": f.from, "to_warehouse_id": f.to}, 200, 0, "success"},
	} {
		t.Run(tc.tag, func(t *testing.T) {
			status, body := c.request("PUT", "/api/v1/stock-transfers/"+tc.id, tc.body)
			if status != tc.http || body["code"] != tc.code || body["message"] != tc.message {
				t.Fatalf("%s = %d %v, want %d/%v/%s", tc.tag, status, body, tc.http, tc.code, tc.message)
			}
		})
	}

	// ③ 的落库后果：明细确实被清空，不是保留。
	detail := c.ok("GET", "/api/v1/stock-transfers/"+id, nil).(map[string]any)
	if lines, ok := detail["edges"].(map[string]any)["lines"]; ok && len(lines.([]any)) != 0 {
		t.Fatalf("PUT 无 lines 后明细未清空: %v", lines)
	}

	// ④ 非草稿：cancel 后再 PUT。
	doc2 := c.ok("POST", "/api/v1/stock-transfers", map[string]any{
		"from_warehouse_id": f.from, "to_warehouse_id": f.to, "lines": line,
	}).(map[string]any)
	id2 := doc2["id"].(string)
	c.ok("POST", "/api/v1/stock-transfers/"+id2+"/cancel", nil)
	if status, body := c.request("PUT", "/api/v1/stock-transfers/"+id2, map[string]any{
		"from_warehouse_id": f.from, "to_warehouse_id": f.to, "lines": line,
	}); status != 200 || body["code"] != float64(10000) || body["message"] != "调拨单不存在或状态不允许修改" {
		t.Fatalf("PUT cancelled = %d %v", status, body)
	}
}

// TestNNTransferActionNotFound 动作端点与 DELETE 在 id 不存在时的形态。
//
// 既有实现一律 **200 + code 10000「调拨单不存在」**，与 GET 详情的 404「调拨单不存在」
// 是两套形态；本实现原先走通用 404「记录不存在」，形态与文案双错。
func TestNNTransferActionNotFound(t *testing.T) {
	c, _ := setup(t)
	for _, tc := range []struct{ method, path string }{
		{"DELETE", "/api/v1/stock-transfers/" + nnMissingID},
		{"POST", "/api/v1/stock-transfers/" + nnMissingID + "/dispatch"},
		{"POST", "/api/v1/stock-transfers/" + nnMissingID + "/complete"},
		{"POST", "/api/v1/stock-transfers/" + nnMissingID + "/cancel"},
	} {
		t.Run(tc.method+" "+tc.path, func(t *testing.T) {
			status, body := c.request(tc.method, tc.path, nil)
			if status != 200 || body["code"] != float64(10000) || body["message"] != "调拨单不存在" {
				t.Fatalf("%s %s = %d %v, want 200/10000/调拨单不存在", tc.method, tc.path, status, body)
			}
		})
	}
	// GET 详情保持 404（与动作端点不同形态）。
	if status, body := c.request("GET", "/api/v1/stock-transfers/"+nnMissingID, nil); status != 404 || body["message"] != "调拨单不存在" {
		t.Fatalf("GET 不存在 id = %d %v, want 404/调拨单不存在", status, body)
	}
}

// TestNNTransferDeleteStatusGuard DELETE 的状态守卫文案与 PUT 不同。
//
// 回放：DELETE 非草稿 → 10000「只有草稿状态的调拨单才能删除」（与 PUT 的
// 「调拨单不存在或状态不允许修改」不是同一句，勿合并）。
func TestNNTransferDeleteStatusGuard(t *testing.T) {
	c, _ := setup(t)
	f := nnSetupTransfer(t, c)
	doc := c.ok("POST", "/api/v1/stock-transfers", map[string]any{
		"from_warehouse_id": f.from, "to_warehouse_id": f.to,
		"lines": []any{map[string]any{"product_id": f.product, "qty": 1}},
	}).(map[string]any)
	id := doc["id"].(string)
	c.ok("POST", "/api/v1/stock-transfers/"+id+"/cancel", nil)
	status, body := c.request("DELETE", "/api/v1/stock-transfers/"+id, nil)
	if status != 200 || body["code"] != float64(10000) || body["message"] != "只有草稿状态的调拨单才能删除" {
		t.Fatalf("DELETE cancelled = %d %v, want 200/10000/只有草稿状态的调拨单才能删除", status, body)
	}
	// 已取消的单据仍可读（DELETE 未生效）。
	if status, body := c.request("GET", "/api/v1/stock-transfers/"+id, nil); status != 200 || body["code"] != float64(0) {
		t.Fatalf("DELETE 被拒后 GET = %d %v, want 200/0", status, body)
	}
}

// TestNNTransferNumberShape 建单成功的返回形状（与 GetTransfer 一致）。
func TestNNTransferNumberShape(t *testing.T) {
	c, _ := setup(t)
	f := nnSetupTransfer(t, c)
	doc := c.ok("POST", "/api/v1/stock-transfers", map[string]any{
		"from_warehouse_id": f.from, "to_warehouse_id": f.to,
		"lines": []any{map[string]any{"product_id": f.product, "qty": 2}},
	}).(map[string]any)
	for _, key := range []string{"id", "transfer_no", "status", "from_warehouse_id", "to_warehouse_id", "edges"} {
		if _, ok := doc[key]; !ok {
			t.Fatalf("建单返回缺字段 %s: %v", key, doc)
		}
	}
	if doc["status"] != "draft" {
		t.Fatalf("status = %v, want draft", doc["status"])
	}
	if no, _ := doc["transfer_no"].(string); len(no) < 2 || no[:2] != "TR" {
		t.Fatalf("transfer_no = %v, want TR 前缀", no)
	}
	_ = fmt.Sprint(doc["id"])
}
