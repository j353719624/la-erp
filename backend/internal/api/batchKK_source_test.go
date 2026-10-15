package api

import (
	"net/http"
	"testing"
)

// 本文件固化批次 KK 的取证结论（2026-10-15 原版回放 192.168.110.97:18886）。
//
// 起因：批次 KK 把路由对账从「只看路由存在性」升级为「逐方法语义比对」，
// 暴露出 6 组「路由在原版存在、恢复端却落 501」的写路径：
//
//	① price-lists  ② permissions  ③ shareholders  ④ console/companies
//	⑤ purchase-reconciliations/generate + piecework-records/import-processes
//	⑥ sales-contracts/options（被 {id} 通配吞掉）+ 收付款单列表过滤
//
// 每条断言都对应 evidence/backend-runtime/audit-batch-kk-20261015.json 里的步骤号。
// 断言原则与项目铁律一致：**原版有文案就逐字照抄**，不「优化」措辞。

const zeroUUID = "00000000-0000-0000-0000-000000000000"

// allDigits 判断字符串是否全为数字（用于校验编号格式）。
func allDigits(s string) bool {
	if s == "" {
		return false
	}
	for _, r := range s {
		if r < '0' || r > '9' {
			return false
		}
	}
	return true
}

// ── ① price-lists ────────────────────────────────────────────────────────

// TestKKPriceListWrites price-lists 写路径（回放 KK-1 ~ KK-11）。
func TestKKPriceListWrites(t *testing.T) {
	c, _ := setup(t)

	// KK-1：缺 name → 400 原版 validator 文案
	status, body := c.request("POST", "/api/v1/price-lists", map[string]any{})
	want := "请求参数错误: Key: 'createPriceListRequest.Name' Error:Field validation for 'Name' failed on the 'required' tag"
	if status != http.StatusBadRequest || body["message"] != want {
		t.Fatalf("POST /price-lists {} = %d %v, want 400/%s", status, body, want)
	}

	// KK-2：只有 name 就够，status 默认 active
	created := c.ok("POST", "/api/v1/price-lists", map[string]any{"name": "KK价目表"}).(map[string]any)
	if created["status"] != "active" {
		t.Fatalf("新建价目表 status = %v, want active", created["status"])
	}
	id, _ := created["id"].(string)
	if id == "" {
		t.Fatalf("创建未返回 id: %v", created)
	}

	// KK-3：原版**不查重**，同名可再建一条（恢复端不应加唯一性检查）
	again := c.ok("POST", "/api/v1/price-lists", map[string]any{"name": "KK价目表"}).(map[string]any)
	if again["id"] == id {
		t.Fatal("同名价目表应能创建出第二条（原版不查重）")
	}

	// KK-6：改名称 → 200，data 为 null
	status, body = c.request("PUT", "/api/v1/price-lists/"+id, map[string]any{"name": "KK改名"})
	if status != http.StatusOK || body["code"] != float64(0) || body["data"] != nil {
		t.Fatalf("PUT /price-lists/{id} = %d %v, want 200/0/null", status, body)
	}

	// KK-7 / KK-8：记录不存在时原版回 **500 通用文案**，不是 404
	for _, m := range []string{"PUT", "DELETE"} {
		status, body = c.request(m, "/api/v1/price-lists/"+zeroUUID, map[string]any{"name": "x"})
		if status != http.StatusInternalServerError || body["message"] != "系统内部错误，请稍后重试或联系管理员" {
			t.Fatalf("%s /price-lists/{不存在的id} = %d %v, want 500/通用文案", m, status, body)
		}
	}

	// KK-9 / KK-10：/price 子资源缺 id → 400「无效的价目表ID」
	for _, m := range []string{"PUT", "DELETE"} {
		status, body = c.request(m, "/api/v1/price-lists/price", map[string]any{"price": 1})
		if status != http.StatusBadRequest || body["message"] != "无效的价目表ID" {
			t.Fatalf("%s /price-lists/price = %d %v, want 400/无效的价目表ID", m, status, body)
		}
	}

	// KK-11：启用中的价目表不能删（业务错误形态：200 + code 10000）
	status, body = c.request("DELETE", "/api/v1/price-lists/"+id, nil)
	if status != http.StatusOK || body["code"] != float64(10000) || body["message"] != "启用中的价目表不能删除，请先停用" {
		t.Fatalf("DELETE 启用中的价目表 = %d %v, want 200/10000/启用中的价目表不能删除，请先停用", status, body)
	}

	// 停用后可删
	c.ok("PUT", "/api/v1/price-lists/"+id, map[string]any{"status": "inactive"})
	c.ok("DELETE", "/api/v1/price-lists/"+id, nil)
}

// ── ② permissions ────────────────────────────────────────────────────────

// TestKKPermissionWrites permissions 写路径（回放 KK-12 ~ KK-20、KK-t-*）。
func TestKKPermissionWrites(t *testing.T) {
	c, _ := setup(t)

	// KK-12：空载荷 → 一次列出**全部**四个缺失字段，顺序 Code/Name/Module/Type
	status, body := c.request("POST", "/api/v1/permissions", map[string]any{})
	want := "请求参数错误: " +
		"Key: 'CreatePermissionRequest.Code' Error:Field validation for 'Code' failed on the 'required' tag\n" +
		"Key: 'CreatePermissionRequest.Name' Error:Field validation for 'Name' failed on the 'required' tag\n" +
		"Key: 'CreatePermissionRequest.Module' Error:Field validation for 'Module' failed on the 'required' tag\n" +
		"Key: 'CreatePermissionRequest.Type' Error:Field validation for 'Type' failed on the 'required' tag"
	if status != http.StatusBadRequest || body["message"] != want {
		t.Fatalf("POST /permissions {} = %d\n got: %v\nwant: %s", status, body, want)
	}

	// KK-13/14/15：逐个补齐，缺失列表相应缩短（不是遇到第一个就停）
	cases := []struct {
		body map[string]any
		want []string
	}{
		{map[string]any{"code": "kk_a"}, []string{"Name", "Module", "Type"}},
		{map[string]any{"code": "kk_a", "name": "x"}, []string{"Module", "Type"}},
		{map[string]any{"code": "kk_a", "name": "x", "module": "m"}, []string{"Type"}},
	}
	for _, tc := range cases {
		status, body = c.request("POST", "/api/v1/permissions", tc.body)
		if status != http.StatusBadRequest {
			t.Fatalf("POST %v = %d %v, want 400", tc.body, status, body)
		}
		for _, field := range tc.want {
			needle := "Key: 'CreatePermissionRequest." + field + "'"
			if !contains(body["message"].(string), needle) {
				t.Fatalf("POST %v 的 message 未包含 %s: %v", tc.body, needle, body["message"])
			}
		}
	}

	// KK-t-*：type **不是枚举**，button/action/api/page/invalid_type 全部接受
	for _, tp := range []string{"button", "action", "api", "page", "menu", "invalid_type"} {
		created := c.ok("POST", "/api/v1/permissions", map[string]any{
			"code": "kk_type_" + tp, "name": "n", "module": "m", "type": tp,
		}).(map[string]any)
		if created["type"] != tp {
			t.Fatalf("type=%s 未落库: %v", tp, created)
		}
	}

	// KK-17：改名称 → 200，回传更新后的记录
	base := map[string]any{"code": "kk_edit", "name": "原名", "module": "m", "type": "menu"}
	perm := c.ok("POST", "/api/v1/permissions", base).(map[string]any)
	pid := perm["id"].(string)
	updated := c.ok("PUT", "/api/v1/permissions/"+pid, map[string]any{"name": "改名"}).(map[string]any)
	if updated["name"] != "改名" {
		t.Fatalf("PUT 后 name = %v, want 改名", updated["name"])
	}

	// KK-18：删除 → 200，data 为 null
	status, body = c.request("DELETE", "/api/v1/permissions/"+pid, nil)
	if status != http.StatusOK || body["code"] != float64(0) || body["data"] != nil {
		t.Fatalf("DELETE /permissions/{id} = %d %v, want 200/0/null", status, body)
	}

	// KK-19 / KK-20：记录不存在 → **200 + code 10000「权限不存在」**（不是 404）
	for _, m := range []string{"PUT", "DELETE"} {
		status, body = c.request(m, "/api/v1/permissions/"+zeroUUID, map[string]any{"name": "x"})
		if status != http.StatusOK || body["code"] != float64(10000) || body["message"] != "权限不存在" {
			t.Fatalf("%s /permissions/{不存在的id} = %d %v, want 200/10000/权限不存在", m, status, body)
		}
	}
}

// ── ③ shareholders ───────────────────────────────────────────────────────

// TestKKShareholderWrites shareholders 写路径（回放 KK-21 ~ KK-27）。
func TestKKShareholderWrites(t *testing.T) {
	c, _ := setup(t)

	// KK-21：缺 name → 400「股东名称不能为空」
	status, body := c.request("POST", "/api/v1/shareholders", map[string]any{})
	if status != http.StatusBadRequest || body["message"] != "股东名称不能为空" {
		t.Fatalf("POST /shareholders {} = %d %v, want 400/股东名称不能为空", status, body)
	}

	// KK-22：默认值 holder_type=natural / share_ratio="0" / capital="0" / is_active=true
	created := c.ok("POST", "/api/v1/shareholders", map[string]any{
		"name": "KK股东", "share_ratio": 0, "capital": 0,
	}).(map[string]any)
	for field, want := range map[string]any{
		"holder_type": "natural", "share_ratio": "0", "capital": "0", "is_active": true,
	} {
		if created[field] != want {
			t.Fatalf("新建股东 %s = %v, want %v", field, created[field], want)
		}
	}
	id := created["id"].(string)

	// KK-23：原版不查重
	c.ok("POST", "/api/v1/shareholders", map[string]any{"name": "KK股东", "share_ratio": 0, "capital": 0})

	// KK-24 / KK-25：改、删都返回 200 + data:null
	status, body = c.request("PUT", "/api/v1/shareholders/"+id, map[string]any{"name": "KK改"})
	if status != http.StatusOK || body["code"] != float64(0) || body["data"] != nil {
		t.Fatalf("PUT /shareholders/{id} = %d %v, want 200/0/null", status, body)
	}
	status, body = c.request("DELETE", "/api/v1/shareholders/"+id, nil)
	if status != http.StatusOK || body["code"] != float64(0) || body["data"] != nil {
		t.Fatalf("DELETE /shareholders/{id} = %d %v, want 200/0/null", status, body)
	}

	// KK-26 / KK-27：记录不存在 → **400「股东不存在」**（不是 404、不是 10000）
	for _, m := range []string{"PUT", "DELETE"} {
		status, body = c.request(m, "/api/v1/shareholders/"+zeroUUID, map[string]any{"name": "x"})
		if status != http.StatusBadRequest || body["message"] != "股东不存在" {
			t.Fatalf("%s /shareholders/{不存在的id} = %d %v, want 400/股东不存在", m, status, body)
		}
	}
}

// ── ④ console/companies ──────────────────────────────────────────────────

// TestKKCompanyWrites 部署控制台的公司写路径（回放 KK-29 / KK-code-* / KK-30 / KK-31）。
//
// 注意原版的检查顺序：**先格式后重复** —— code="Abc" 报的是格式错而非「已存在」，
// 因为 "abc" 已存在但 "Abc" 格式不合法。
func TestKKCompanyWrites(t *testing.T) {
	c, _ := setup(t)

	// 默认公司由 seed 写入
	seeded := c.ok("GET", "/api/v1/console/companies", nil).([]any)
	if len(seeded) != 1 || seeded[0].(map[string]any)["code"] != "default" {
		t.Fatalf("seed 后应只有 default 一家: %v", seeded)
	}

	const formatMsg = "公司编码需以小写字母开头，仅含小写字母/数字/下划线，2~20 位"
	// 格式非法：首字母大写、长度不足、含连字符、含中文
	for _, code := range []string{"Abc", "A", "kk-company", "KK公司", "1abc", ""} {
		status, body := c.request("POST", "/api/v1/console/companies", map[string]any{"code": code, "name": "x"})
		if status != http.StatusOK || body["code"] != float64(10000) || body["message"] != formatMsg {
			t.Fatalf("POST companies code=%q = %d %v, want 200/10000/%s", code, status, body, formatMsg)
		}
	}
	// 格式合法
	status, body := c.request("POST", "/api/v1/console/companies", map[string]any{"code": "kk_ok", "name": "KK公司"})
	if status != http.StatusOK || body["code"] != float64(0) {
		t.Fatalf("POST companies code=kk_ok = %d %v, want 200/0", status, body)
	}
	// KK-code-abc / KK-code-ab：重复 → 「公司编码 <code> 已存在」
	//   注意用小写形式探测，确保命中的是「已存在」而不是「格式错」
	if status, body := c.request("POST", "/api/v1/console/companies", map[string]any{"code": "kk_ok", "name": "KK公司B"}); status != http.StatusOK || body["code"] != float64(10000) {
		t.Fatalf("重复创建 kk_ok = %d %v, want 200/10000/已存在", status, body)
	}
	for _, dup := range []string{"default", "kk_ok"} {
		status, body = c.request("POST", "/api/v1/console/companies", map[string]any{"code": dup, "name": "x"})
		want := "公司编码 " + dup + " 已存在"
		if status != http.StatusOK || body["code"] != float64(10000) || body["message"] != want {
			t.Fatalf("POST companies code=%s(重复) = %d %v, want 200/10000/%s", dup, status, body, want)
		}
	}
	// 清单里能看到新建的公司（GET 已改为从 companies 表读）
	items := c.ok("GET", "/api/v1/console/companies", nil).([]any)
	found := false
	for _, item := range items {
		if item.(map[string]any)["code"] == "kk_ok" {
			found = true
		}
	}
	if !found {
		t.Fatalf("新建的公司未出现在 GET /console/companies: %v", items)
	}

	// KK-31：改不存在的公司 → 200 + 10000「公司不存在」
	// 注意不能用零 UUID —— seed 里 default 公司的 id 就是零 UUID，它真实存在。
	// 用一个格式合法但库中不存在的 UUID。
	const absentID = "00000000-0000-0000-0000-0000deadbeef"
	status, body = c.request("PUT", "/api/v1/console/companies/"+absentID, map[string]any{"name": "x"})
	if status != http.StatusOK || body["code"] != float64(10000) || body["message"] != "公司不存在" {
		t.Fatalf("PUT companies/{不存在的id} = %d %v, want 200/10000/公司不存在", status, body)
	}
}

// ── ⑤ purchase-reconciliations/generate 与 import-processes ──────────────

// TestKKReconciliationAndImport 动作端点（回放 KK-32 ~ KK-35 + 二次订正取证）。
//
// 订正：初版取证用的参数名 `period` 是错的。原版校验的是 period_start / period_end
// 两个**都必填**的日期；`period` 无论取什么值都走「期间格式无效」分支。
func TestKKReconciliationAndImport(t *testing.T) {
	c, _, _, party := testFixture(t, "KK-RECON")
	supplierID := party["supplier"].(map[string]any)["id"].(string)

	const periodMsg = "期间格式无效（应为 YYYY-MM-DD）"
	// 期间格式先校验：两个字段都必须能解析成 YYYY-MM-DD
	for _, payload := range []map[string]any{
		{},
		{"supplier_id": supplierID},
		{"supplier_id": supplierID, "period_start": "2026-10-01"},
		{"supplier_id": supplierID, "period_start": "bad", "period_end": "2026-10-31"},
		{"supplier_id": supplierID, "period_start": "2026-13-01", "period_end": "2026-10-31"},
		// 传原版不认的 period 参数，同样落到格式错分支
		{"supplier_id": supplierID, "period": "2026-10"},
	} {
		status, body := c.request("POST", "/api/v1/purchase-reconciliations/generate", payload)
		if status != http.StatusBadRequest || body["message"] != periodMsg {
			t.Fatalf("generate %v = %d %v, want 400/%s", payload, status, body, periodMsg)
		}
	}

	// 期间合法但缺/错供应商 → 200 + 10000「请选择供应商」
	// （注意：供应商校验在期间校验**之后**，故这里期间是合法的）
	for _, payload := range []map[string]any{
		{"period_start": "2026-10-01", "period_end": "2026-10-31"},
		{"supplier_id": zeroUUID, "period_start": "2026-10-01", "period_end": "2026-10-31"},
	} {
		status, body := c.request("POST", "/api/v1/purchase-reconciliations/generate", payload)
		if status != http.StatusOK || body["code"] != float64(10000) || body["message"] != "请选择供应商" {
			t.Fatalf("generate %v = %d %v, want 200/10000/请选择供应商", payload, status, body)
		}
	}

	// 全参数 → 成功建草稿
	created := c.ok("POST", "/api/v1/purchase-reconciliations/generate", map[string]any{
		"supplier_id": supplierID, "period_start": "2026-10-01", "period_end": "2026-10-31",
	}).(map[string]any)
	if created["status"] != "draft" {
		t.Fatalf("新对账单 status = %v, want draft", created["status"])
	}
	code, _ := created["code"].(string)
	// 形如 CGDZ202610150001：CGDZ + 8 位日期 + 3 位流水 = 15
	if len(code) != 15 || code[:4] != "CGDZ" || !allDigits(code[4:]) {
		t.Fatalf("对账单编号 = %q, want CGDZ{yyyymmdd}{3位流水}", code)
	}
	for _, field := range []string{"begin_balance", "period_in", "period_out", "end_balance"} {
		if created[field] != "0" {
			t.Fatalf("新对账单 %s = %v, want 0", field, created[field])
		}
	}
	if created["supplier_end_balance"] != nil || created["diff_amount"] != nil {
		t.Fatalf("supplier_end_balance / diff_amount 应为 null: %v", created)
	}
	// 同日第二张编号递增
	second := c.ok("POST", "/api/v1/purchase-reconciliations/generate", map[string]any{
		"supplier_id": supplierID, "period_start": "2026-09-01", "period_end": "2026-09-30",
	}).(map[string]any)
	code2, _ := second["code"].(string)
	if code2 == code {
		t.Fatalf("同日第二张编号应递增，两张都是 %q", code)
	}

	// KK-34 / KK-35：缺参数与空数组落到同一分支
	const importMsg = "请选择要导入的工序报工"
	for _, payload := range []map[string]any{{}, {"process_ids": []any{}}} {
		status, body := c.request("POST", "/api/v1/piecework-records/import-processes", payload)
		if status != http.StatusOK || body["code"] != float64(10000) || body["message"] != importMsg {
			t.Fatalf("POST import-processes %v = %d %v, want 200/10000/%s", payload, status, body, importMsg)
		}
	}
}

// ── ⑥ sales-contracts/options 与收付款单列表过滤 ─────────────────────────

// TestKKSalesContractOptions sales-contracts/options 之前被 {id} 通配吞掉，
// 请求返回 400「无效的 ID」，导致销售订单表单的「关联合同」下拉永远加载不出来。
//
// 原版实测：返回**裸数组**；支持 customer_id；排除 status='cancelled'；
// 但**包含 status='draft'**（过滤条件是「非 cancelled」而非「仅 active」）。
func TestKKSalesContractOptions(t *testing.T) {
	c, _, _, party := testFixture(t, "KK-OPT")
	cid := party["customer"].(map[string]any)["id"].(string)

	create := func(total string) map[string]any {
		return c.ok("POST", "/api/v1/sales-contracts", map[string]any{
			"customer_id": cid, "total_amount": total,
		}).(map[string]any)
	}
	draft := create("100")
	other := create("200")

	// 返回裸数组，不是 {list,total}
	items := c.ok("GET", "/api/v1/sales-contracts/options", nil)
	rows, ok := items.([]any)
	if !ok {
		t.Fatalf("options 应返回数组，实际 %T: %v", items, items)
	}
	if len(rows) != 2 {
		t.Fatalf("options 条数 = %d, want 2", len(rows))
	}

	// 草稿**也在**返回里（别误实现成只返回 active）
	byID := map[string]map[string]any{}
	for _, item := range rows {
		row := item.(map[string]any)
		byID[row["id"].(string)] = row
	}
	if row, ok := byID[draft["id"].(string)]; !ok || row["status"] != "draft" {
		t.Fatalf("draft 合同应出现在 options 里: %v", byID)
	}

	// customer_id 过滤命中
	filtered := c.ok("GET", "/api/v1/sales-contracts/options?customer_id="+cid, nil).([]any)
	if len(filtered) != 2 {
		t.Fatalf("按 customer 过滤条数 = %d, want 2", len(filtered))
	}
	// 零 UUID → 空数组（不是错误）
	empty := c.ok("GET", "/api/v1/sales-contracts/options?customer_id="+zeroUUID, nil).([]any)
	if len(empty) != 0 {
		t.Fatalf("零 UUID 应返回空数组，实际 %d 条", len(empty))
	}

	// 取消一张 → 从 options 中消失（排除 cancelled）
	c.ok("POST", "/api/v1/sales-contracts/"+other["id"].(string)+"/cancel", nil)
	after := c.ok("GET", "/api/v1/sales-contracts/options", nil).([]any)
	if len(after) != 1 {
		t.Fatalf("取消一张后 options 应剩 1 条，实际 %d", len(after))
	}
}

// TestKKPaymentListFilters 收/付款单列表的过滤参数（2026-10-15 实测）。
//
// 原版行为（易误实现）：
//
//	· 返回**裸数组**，且**忽略分页**（page_size=2 仍返回全部）
//	· status 生效
//	· 收款单支持 customer_id；付款单**不支持**（该表无此列，参数被忽略）
func TestKKPaymentListFilters(t *testing.T) {
	c, _, _, party := testFixture(t, "KK-PAY")
	cid := party["customer"].(map[string]any)["id"].(string)

	// 收款单必须带现金科目（cash_account_id），否则报「现金科目不存在」
	cash := c.ok("GET", "/api/v1/accounts?page=1&page_size=50", nil).(map[string]any)["list"].([]any)[0].(map[string]any)
	// 建两张不同状态的收款单
	for _, status := range []string{"draft", "confirmed"} {
		doc := c.ok("POST", "/api/v1/payment-receipts", map[string]any{
			"customer_id": cid, "receipt_date": "2026-10-15T00:00:00+08:00",
			"amount": 100, "receipt_type": "normal",
			"cash_account_id":   cash["id"],
			"cash_account_code": cash["code"],
			"cash_account_name": cash["name"],
			"remark":            "KK-" + status,
		}).(map[string]any)
		if status == "confirmed" {
			c.ok("POST", "/api/v1/payment-receipts/"+doc["id"].(string)+"/confirm", nil)
		}
	}

	list := func(query string) []any {
		data := c.ok("GET", "/api/v1/payment-receipts"+query, nil)
		rows, ok := data.([]any)
		if !ok {
			t.Fatalf("收款单列表应返回数组，实际 %T", data)
		}
		return rows
	}

	// 不分页：page_size 必须是**奇数**才会失败，故断言条数 >= 已建数量
	all := list("?page=1&page_size=1")
	if len(all) < 2 {
		t.Fatalf("原版忽略分页，page_size=1 也应返回全部，实际 %d 条", len(all))
	}
	// status 过滤生效
	confirmed := list("?status=confirmed")
	if len(confirmed) != 1 {
		t.Fatalf("status=confirmed 应命中 1 条，实际 %d", len(confirmed))
	}
	if row := confirmed[0].(map[string]any); row["status"] != "confirmed" {
		t.Fatalf("status 过滤结果不对: %v", row["status"])
	}
	// customer_id 过滤生效
	byCustomer := list("?customer_id=" + cid)
	if len(byCustomer) < 2 {
		t.Fatalf("按 customer 过滤应命中已建的 2 条，实际 %d", len(byCustomer))
	}
	// 零 UUID → 空数组
	if empty := list("?customer_id=" + zeroUUID); len(empty) != 0 {
		t.Fatalf("零 UUID 应返回空数组，实际 %d 条", len(empty))
	}
	// 付款单不支持 customer_id（该表无此列，参数被忽略）
	doc := c.ok("POST", "/api/v1/payments", map[string]any{
		"supplier_id": party["supplier"].(map[string]any)["id"], "payment_date": "2026-10-15T00:00:00+08:00",
		"amount": 100, "payment_type": "normal",
		"cash_account_id":   cash["id"],
		"cash_account_code": cash["code"],
		"cash_account_name": cash["name"],
	}).(map[string]any)
	_ = doc
	payments := c.ok("GET", "/api/v1/payments?customer_id="+zeroUUID, nil)
	if rows, ok := payments.([]any); !ok || len(rows) == 0 {
		t.Fatalf("付款单不支持 customer_id 过滤，零 UUID 时仍应返回全部，实际 %v", payments)
	}
}
