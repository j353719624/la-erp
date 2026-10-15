package api

import (
	"bytes"
	"encoding/json"
	"mime/multipart"
	"net/http"
	"strings"
	"testing"
)

// 本文件固化批次 GG 的取证结论（2026-10-14 原版回放 192.168.110.97:18886）。
//
// 起因：批次 FF 补齐路由后，tools/audit-self-authored-text.mjs 判定新增的
// errors.New/fmt.Errorf 中文文案里 22 条查无实据（自造）。批次 GG 逐条复现触发条件
// 取回原版真实响应，结论分三类：
//   ① 文案自造 → 逐字替换为原版文案
//   ② 恢复端比原版更严（原版放行）→ 删除守卫
//   ③ 恢复端口径不同（编码/命名规则）→ 按原版口径改写
//
// 证据：evidence/backend-runtime/audit-batch-gg-20261014.json、
//       audit-batch-gg2-20261014.json、audit-batch-gg3-20261014.json
// 回放脚本：tools/replay-batch-gg.js、replay-batch-gg2.js、replay-batch-gg3.js

// uploadImport 上传导入文件，返回 HTTP 状态码与完整响应体（含 code/message/data）。
func (c *client) uploadImport(kind, filename, content string) (int, map[string]any) {
	c.t.Helper()
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	part, err := writer.CreateFormFile("file", filename)
	if err != nil {
		c.t.Fatal(err)
	}
	if _, err = part.Write([]byte(content)); err != nil {
		c.t.Fatal(err)
	}
	if err = writer.WriteField("dry_run", "true"); err != nil {
		c.t.Fatal(err)
	}
	if err = writer.Close(); err != nil {
		c.t.Fatal(err)
	}
	route := "/api/v1/import/" + kind
	req, err := http.NewRequest("POST", c.server.URL+route, &body)
	if err != nil {
		c.t.Fatal(err)
	}
	req.Header.Set("Content-Type", writer.FormDataContentType())
	if c.token != "" {
		req.Header.Set("Authorization", "Bearer "+c.token)
	}
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		c.t.Fatal(err)
	}
	defer res.Body.Close()
	var result map[string]any
	if err = json.NewDecoder(res.Body).Decode(&result); err != nil {
		c.t.Fatal(err)
	}
	if data, ok := result["data"].(map[string]any); ok && result["code"] == float64(0) {
		// 导入结果在 data 里（total/success/failed/messages）
		for key, value := range data {
			result[key] = value
		}
	}
	return res.StatusCode, result
}

// assertBusiness 断言原版的业务错误形态：HTTP 200 + code 10000 + 逐字文案。
func assertBusiness(t *testing.T, c *client, method, route string, body any, message string) {
	t.Helper()
	status, resp := c.request(method, route, body)
	if status != http.StatusOK || resp["code"] != float64(10000) || resp["message"] != message {
		t.Fatalf("%s %s = %d %v, want 200/10000/%s", method, route, status, resp, message)
	}
}

// ── 一、单据必填：原版只校验商品款的 name ───────────────────────────────────

// GG1：POST /spus 缺 name → 400 + 原版 validator 原文案（回放 GG1）。
func TestSourceGGSpuNameRequired(t *testing.T) {
	c, _ := setup(t)
	status, body := c.request("POST", "/api/v1/spus", map[string]any{})
	if status != 400 {
		t.Fatalf("status=%d body=%v", status, body)
	}
	want := "请求参数错误: Key: 'CreateSpuRequest.Name' Error:Field validation for 'Name' failed on the 'required' tag"
	if body["message"] != want {
		t.Fatalf("message=%v want %s", body["message"], want)
	}
}

// GG2：合同缺往来单位时原版照常建单（回放 GG2/GG3），恢复端此前误拒。
func TestSourceGGContractAllowsMissingParty(t *testing.T) {
	c, _ := setup(t)
	for _, route := range []string{"purchase-contracts", "sales-contracts"} {
		created := c.ok("POST", "/api/v1/"+route, map[string]any{}).(map[string]any)
		if created["id"] == nil {
			t.Fatalf("%s created without party: %v", route, created)
		}
	}
}

// ── 二、明细校验：三种单据文案各不相同 ─────────────────────────────────────

// GG3：采购申请 / 询价单 / 报价单的「空明细」「商品不存在」「数量非正」文案（回放 MM）。
func TestSourceGGDocumentLineMessages(t *testing.T) {
	c, product, _, _ := testFixture(t, "GG-LINE")
	zero := "00000000-0000-0000-0000-000000000000"
	cases := []struct {
		route, empty, productMsg, qtyMsg string
		productStatus                    int
	}{
		{"purchase-requisitions", "采购申请明细不能为空", "系统内部错误，请稍后重试或联系管理员", "采购申请数量必须为正数", 500},
		{"purchase-rfqs", "询价明细不能为空", "所选商品不存在或已被删除", "询价明细数量必须大于 0", 0},
		{"sales-quotations", "报价明细不能为空", "所选商品不存在或已被删除", "报价明细数量必须大于 0", 0},
	}
	for _, item := range cases {
		base := "/api/v1/" + item.route
		assertBusiness(t, c, "POST", base, map[string]any{}, item.empty)
		assertBusiness(t, c, "POST", base, map[string]any{"lines": []any{}}, item.empty)

		if item.productStatus == 500 {
			status, body := c.request("POST", base, map[string]any{
				"lines": []any{map[string]any{"product_id": zero, "qty": 1}},
			})
			if status != 500 || body["message"] != item.productMsg {
				t.Fatalf("%s missing product = %d %v", item.route, status, body)
			}
		} else {
			assertBusiness(t, c, "POST", base, map[string]any{
				"lines": []any{map[string]any{"product_id": zero, "qty": 1}},
			}, item.productMsg)
		}
		// 「缺 qty」与「qty=0」同文案
		assertBusiness(t, c, "POST", base, map[string]any{
			"lines": []any{map[string]any{"product_id": product["id"]}},
		}, item.qtyMsg)
		assertBusiness(t, c, "POST", base, map[string]any{
			"lines": []any{map[string]any{"product_id": product["id"], "qty": 0}},
		}, item.qtyMsg)
		// 合法明细必须放行
		c.ok("POST", base, map[string]any{"lines": []any{map[string]any{"product_id": product["id"], "qty": 2}}})
	}
}

// ── 三、询价报价：状态守卫与不存在报价 ─────────────────────────────────────

// GG4：草稿询价单转单/录入报价均被拒；不存在的报价走 500 通用文案（回放 GG10/GG11/GG14）。
func TestSourceGGRfqQuoteGuards(t *testing.T) {
	c, product, _, party := testFixture(t, "GG-QUOTE")
	supplier := party["supplier"].(map[string]any)
	rfq := c.ok("POST", "/api/v1/purchase-rfqs", map[string]any{
		"supplier_id": supplier["id"],
		"lines":       []any{map[string]any{"product_id": product["id"], "qty": 3}},
	}).(map[string]any)
	path := "/api/v1/purchase-rfqs/" + rfq["id"].(string)

	assertBusiness(t, c, "POST", path+"/convert", map[string]any{}, "只有已确认的询价单才能转采购订单")
	assertBusiness(t, c, "POST", path+"/quotes", map[string]any{
		"supplier_id": supplier["id"],
		"lines":       []any{map[string]any{"product_id": product["id"], "qty": 1, "price": 1}},
	}, "只有已确认的询价单才能录入供应商报价")

	// select / delete 不存在的报价 → HTTP 500 + 通用文案（不是「报价不存在」）
	zero := "00000000-0000-0000-0000-000000000000"
	for _, call := range []struct{ method, route string }{
		{"POST", path + "/quotes/" + zero + "/select"},
		{"DELETE", path + "/quotes/" + zero},
	} {
		status, body := c.request(call.method, call.route, map[string]any{})
		if status != 500 || body["message"] != "系统内部错误，请稍后重试或联系管理员" {
			t.Fatalf("%s %s = %d %v", call.method, call.route, status, body)
		}
	}

	// 确认后可录入报价；报价明细文案按原版口径
	c.ok("POST", path+"/confirm", nil)
	assertBusiness(t, c, "POST", path+"/quotes", map[string]any{"supplier_id": supplier["id"]}, "报价明细不能为空")
	assertBusiness(t, c, "POST", path+"/quotes", map[string]any{
		"supplier_id": supplier["id"],
		"lines":       []any{map[string]any{"product_id": zero, "qty": 1, "price": 1}},
	}, "报价明细缺少商品")
	assertBusiness(t, c, "POST", path+"/quotes", map[string]any{
		"supplier_id": supplier["id"],
		"lines":       []any{map[string]any{"product_id": product["id"], "price": 1}},
	}, "报价明细数量必须大于 0")
	// 原版放行负单价（回放 gg14）
	c.ok("POST", path+"/quotes", map[string]any{
		"supplier_id": supplier["id"],
		"lines":       []any{map[string]any{"product_id": product["id"], "qty": 1, "price": -1}},
	})
}

// ── 四、元数据 / 动态实体 ───────────────────────────────────────────────────

// GG5：实体写路径（POST/PUT/DELETE /metadata/entities[/{id}]）与不存在的实体形态（回放 GG15/GG16）。
func TestSourceGGMetadataEntityWrite(t *testing.T) {
	c, _ := setup(t)
	zero := "00000000-0000-0000-0000-000000000000"

	// 缺 table_name → 10000「表名不能为空」
	assertBusiness(t, c, "POST", "/api/v1/metadata/entities", map[string]any{"code": "GG-A", "name": "GG实体A"}, "表名不能为空")

	created := c.ok("POST", "/api/v1/metadata/entities", map[string]any{
		"code": "GG-A", "name": "GG实体A", "table_name": "gg_a_t", "category": "custom",
	}).(map[string]any)
	if created["table_name"] != "gg_a_t" || created["category"] != "custom" {
		t.Fatalf("entity = %v", created)
	}
	path := "/api/v1/metadata/entities/" + created["id"].(string)
	if got := c.ok("GET", path, nil).(map[string]any); got["code"] != "GG-A" {
		t.Fatalf("get entity = %v", got)
	}
	updated := c.ok("PUT", path, map[string]any{"name": "GG实体A改名"}).(map[string]any)
	if updated["name"] != "GG实体A改名" {
		t.Fatalf("put entity = %v", updated)
	}
	// 不存在的 id：GET/PUT/DELETE 一律 500 + 通用文案
	for _, call := range []struct{ method, route string; body any }{
		{"GET", "/api/v1/metadata/entities/" + zero, nil},
		{"PUT", "/api/v1/metadata/entities/" + zero, map[string]any{"name": "x"}},
		{"DELETE", "/api/v1/metadata/entities/" + zero, nil},
	} {
		status, body := c.request(call.method, call.route, call.body)
		if status != 500 || body["message"] != "系统内部错误，请稍后重试或联系管理员" {
			t.Fatalf("%s %s = %d %v", call.method, call.route, status, body)
		}
	}
	c.ok("DELETE", path, nil)
}

// GG6：动态数据的实体不存在 → HTTP 200 + code 10000 + 通用文案（回放 GG13/GG14）。
func TestSourceGGDynamicEntityMissing(t *testing.T) {
	c, _ := setup(t)
	assertBusiness(t, c, "GET", "/api/v1/dynamic/GG-NONE", nil, "系统内部错误，请稍后重试或联系管理员")
	assertBusiness(t, c, "GET", "/api/v1/dynamic/GG-NONE/00000000-0000-0000-0000-000000000000", nil,
		"系统内部错误，请稍后重试或联系管理员")
}

// GG7：动态导入/导出的 entity 参数校验与表头契约（回放 GG15/GG17/GG33）。
func TestSourceGGDynamicImportExportContract(t *testing.T) {
	c, _ := setup(t)
	// 缺 entity → 400「entity 参数不能为空」
	for _, route := range []string{"/api/v1/export/meta", "/api/v1/export/meta-template"} {
		status, body := c.request("GET", route, nil)
		if status != 400 || body["message"] != "entity 参数不能为空" {
			t.Fatalf("GET %s = %d %v", route, status, body)
		}
	}
	// 实体不存在 → 10000「实体不存在: <编码>」
	assertBusiness(t, c, "GET", "/api/v1/export/meta?entity=GG-NONE", nil, "实体不存在: GG-NONE")

	// 建一个「有表无字段」的实体：原版不报「实体没有可用字段」，而是导出空表头、
	// 导入未知列时报 500「模板包含未知字段列: <表头>」（回放 GG29/GG33）
	entity := c.ok("POST", "/api/v1/metadata/entities", map[string]any{
		"code": "GG-EMPTY", "name": "GG空实体", "table_name": "gg_empty_t", "category": "custom",
	}).(map[string]any)
	_ = entity
	if status, _ := c.request("POST", "/api/v1/import/meta?entity=GG-EMPTY", nil); status != 400 {
		t.Fatalf("import without file = %d", status)
	}
	status, body := c.uploadImport("meta?entity=GG-EMPTY", "meta.csv", "编码\r\nA1\r\n")
	if status != 500 || body["message"] != "模板包含未知字段列: 编码" {
		t.Fatalf("unknown field column = %d %v", status, body)
	}
	// 模板表头形如「名称(code)」
	field := c.ok("POST", "/api/v1/metadata/fields", map[string]any{
		"entity_id": entity["id"], "code": "code", "name": "编码", "field_type": "text", "sort_order": 1,
	}).(map[string]any)
	_ = field
	templateStatus, _, payload := c.raw("GET", "/api/v1/export/meta-template?entity=GG-EMPTY", nil)
	if templateStatus != 200 || !strings.Contains(string(payload), "编码(code)") {
		t.Fatalf("meta template = %d %q", templateStatus, string(payload))
	}
}

// ── 五、导入校验文案 ────────────────────────────────────────────────────────

// GG8：各导入对象的必填文案与逐行错误前缀（回放 N1/GG18）。
func TestSourceGGImportRequiredMessages(t *testing.T) {
	c, _ := setup(t)
	// 逐行错误统一为「第N行导入失败: 」（原版回放 N1），非「第N行：」
	assertRowMessage := func(kind, file, content, want string) {
		t.Helper()
		status, body := c.uploadImport(kind, file, content)
		if status != 200 {
			t.Fatalf("import %s = %d %v", kind, status, body)
		}
		messages, _ := body["messages"].([]any)
		if len(messages) == 0 || messages[0] != want {
			t.Fatalf("import %s messages = %v, want %q", kind, messages, want)
		}
	}
	assertRowMessage("customers", "customers.csv", "\uFEFF编码,名称\r\n,", "第2行导入失败: 客户名称不能为空")
	assertRowMessage("products", "products.csv", "\uFEFF编码,名称\r\n,", "第2行导入失败: 商品名称不能为空")
	assertRowMessage("suppliers", "suppliers.csv", "\uFEFF编码,名称\r\n,", "第2行导入失败: 供应商名称不能为空")
	assertRowMessage("units", "units.csv", "\uFEFF编码,名称\r\n,", "第2行导入失败: 单位名称不能为空")
	assertRowMessage("warehouses", "warehouses.csv", "\uFEFF编码,名称\r\n,", "第2行导入失败: 仓库名称不能为空")
	assertRowMessage("locations", "locations.csv", "\uFEFF编码,名称\r\n,", "第2行导入失败: 库位名称不能为空")
	assertRowMessage("racks", "racks.csv", "\uFEFF编码,名称\r\n,", "第2行导入失败: 货架名称不能为空")
	assertRowMessage("users", "users.csv", "\uFEFF用户名,姓名\r\n,", "第2行导入失败: 用户名不能为空")
	assertRowMessage("opening-stock", "stock.csv", "\uFEFF商品编码,仓库编码\r\n,", "第2行导入失败: 商品编码不能为空")
	assertRowMessage("skus", "skus.csv", "\uFEFF款号,款名,颜色,尺码,SKU编码\r\n,,,,", "第2行导入失败: 款号与款名不能同时为空")
	assertRowMessage("skus", "skus.csv", "\uFEFF款号,款名,颜色,尺码,SKU编码\r\nX,,,", "第2行导入失败: 规格维度「颜色」不能为空")
}

// GG9：参照不存在与类型错误的文案（回放 N2/N3）。
func TestSourceGGImportReferenceAndFormatMessages(t *testing.T) {
	c, _ := setup(t)
	assertRowMessage := func(kind, file, content, want string) {
		t.Helper()
		status, body := c.uploadImport(kind, file, content)
		if status != 200 {
			t.Fatalf("import %s = %d %v", kind, status, body)
		}
		messages, _ := body["messages"].([]any)
		if len(messages) == 0 || messages[0] != want {
			t.Fatalf("import %s messages = %v, want %q", kind, messages, want)
		}
	}
	// 参照：分类走「自动建分类失败」，其余按「<中文名>不存在: 值」
	assertRowMessage("products", "products.csv", "\uFEFF编码,名称,分类名称\r\nGG-R1,GG参照1,GG无此分类",
		`第2行导入失败: 创建分类失败: ent: missing required field "Category.code"`)
	assertRowMessage("products", "products.csv", "\uFEFF编码,名称,单位名称\r\nGG-R2,GG参照2,GG无此单位",
		"第2行导入失败: 计量单位不存在: GG无此单位")
	assertRowMessage("opening-stock", "stock.csv", "\uFEFF商品编码,仓库编码\r\nGG无此商品,WH-DEFAULT",
		"第2行导入失败: 商品不存在: GG无此商品")
	assertRowMessage("users", "users.csv", "\uFEFF用户名,姓名,部门\r\ngg-u1,甲,GG无此部门",
		"第2行导入失败: 部门不存在: GG无此部门")
	// 类型错误：int/num 两种写法
	assertRowMessage("customers", "customers.csv", "\uFEFF编码,名称,账期(天)\r\nGG-F1,GG格式1,abc",
		`第2行导入失败: payment_term 格式错误: strconv.Atoi: parsing "abc": invalid syntax`)
	assertRowMessage("customers", "customers.csv", "\uFEFF编码,名称,信用额度\r\nGG-F2,GG格式2,abc",
		"第2行导入失败: credit_limit 格式错误: can't convert abc to decimal")
	assertRowMessage("products", "products.csv", "\uFEFF编码,名称,保质期(天)\r\nGG-F4,GG格式4,abc",
		"第2行导入失败: 保质期(天)必须为非负整数: abc")
	assertRowMessage("racks", "racks.csv", "\uFEFF编码,名称,行数\r\nGG-F5,GG格式5,abc",
		"第2行导入失败: rows 必须为非负整数: abc")
	assertRowMessage("racks", "racks.csv", "\uFEFF编码,名称,容量\r\nGG-F6,GG格式6,abc",
		"第2行导入失败: 容量必须为非负数: abc")
}

// GG10：损坏的 XLSX 报「XLSX 打开失败: …」（回放 GG28）；CSV 解析不出内容时按 0 行处理（回放 GG27）。
func TestSourceGGImportFileFailures(t *testing.T) {
	c, _ := setup(t)
	status, body := c.uploadImport("customers", "bad.xlsx", "not-an-excel-file")
	if status != 500 {
		t.Fatalf("broken xlsx = %d %v", status, body)
	}
	if got := body["message"].(string); got == "" || got[:len("XLSX 打开失败: ")] != "XLSX 打开失败: " {
		t.Fatalf("broken xlsx message = %v", got)
	}
	status, body = c.uploadImport("customers", "bad.csv", "\xff\xfe\x00\x01\x02\x03")
	if status != 200 {
		t.Fatalf("broken csv = %d %v", status, body)
	}
	if body["total"] != float64(0) {
		t.Fatalf("broken csv total = %v", body["total"])
	}
}
