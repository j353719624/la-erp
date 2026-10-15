package api

// 批次 PP（2026-10-15）：通用资源「非法 ID」守卫的逐字对齐。
//
// ## 背景
// tools/replay-batch-oo-badid.js 对 42 个资源 × GET/PUT/DELETE 全量取证
// （129 条，evidence/backend-runtime/audit-batch-oo-badid-20261015.json）：
// 恢复端通用 /api/v1/{res}/{id} 没有 UUID 格式守卫（或文案统一成「无效的 ID」），
// 非法 ID 直接漏到业务层：
//
//	GET     → 404「<Label>不存在」          原版 → 400「无效的商品ID」...
//	PUT     → 200|10000「<Label>不存在」    原版 → 400「无效的商品ID」...
//	DELETE  → 200|10000「<Label>不存在」    原版 → 400「无效的商品ID」...
//
// 且原版文案**逐资源不同**，实测三套：
//
//	无效的<Label>ID   —— 多数资源（商品/客户/供应商/...）
//	ID格式错误        —— payrolls / expense-claims / fixed-assets / leads / accounting-periods
//	无效的ID          —— approval-flows / payment-plans
//	无效的ID格式      —— accounts / vouchers（专门 handler，见 accounts.go / vouchers.go）
//
// ## 铁律
// 只映射实测到的表；查不到的表保持原行为（「无效的 ID」），**不得自造统一文案**。

// badIDMessages 以表名为键：原版对 GET/PUT/DELETE /{res}/{非UUID} 的逐字文案。
// 同一资源三个方法的文案完全一致（取证 129 条逐条核对）。
var badIDMessages = map[string]string{
	// ── 无效的<Label>ID ──────────────────────────────────────────────
	"products":                "无效的商品ID",
	"customers":               "无效的客户ID",
	"suppliers":               "无效的供应商ID",
	"units":                   "无效的计量单位ID",
	"warehouses":              "无效的仓库ID",
	"categories":              "无效的分类ID",
	"departments":             "无效的部门ID",
	"sys_users":               "无效的用户ID",
	"sys_roles":               "无效的角色ID",
	"sys_permissions":         "无效的权限ID",
	"locations":               "无效的库位ID",
	"racks":                   "无效的货架ID",
	"production_equipments":   "无效的设备ID",
	"toolings":                "无效的工装ID",
	"production_teams":        "无效的班组ID",
	"product_documents":       "无效的资料ID",
	"assembly_orders":         "无效的组装单ID",
	"employees":               "无效的员工ID",
	"labor_contracts":         "无效的合同ID",
	"attendance_requests":     "无效的考勤申请ID",
	"recruitment_positions":   "无效的职位ID",
	"recruitment_candidates":  "无效的候选人ID",
	"training_records":        "无效的培训记录ID",
	"perf_templates":          "无效的模板ID",
	"perf_assessments":        "无效的考核单ID",
	"piece_rates":             "无效的单价ID",
	"piecework_records":       "无效的登记ID",
	"crm_opportunities":       "无效的商机ID",
	"loan_orders":             "无效的单据ID",
	"consignment_orders":      "无效的单据ID",
	// ── 无效的ID格式（专门 handler 的资源）──────────────────────────
	// accounts 的 GET /{id} 走 read_resources.json 通道（s.get）；
	// vouchers 的 GET /{id} 同理。取证：tools/replay-batch-oo-catchall2.js B/C 组。
	"accounts":               "无效的ID格式",
	"vouchers":               "无效的ID格式",
	// ── 无效的ID ────────────────────────────────────────────────────
	"approval_flows":          "无效的ID",
	"payment_plans":           "无效的ID",
	// ── ID格式错误 ──────────────────────────────────────────────────
	"payroll_batches":         "ID格式错误",
	"expense_claims":          "ID格式错误",
	"fixed_assets":            "ID格式错误",
	"leads":                   "ID格式错误",
	"accounting_periods":      "ID格式错误",
	// ── 仅写路径可见的文案 ──────────────────────────────────────────
	// 这三张表的 GET/PUT 原版都是 404「路由不存在」（走 notFoundStyles /
	// writeRouteAbsent 处理，早于本映射），故本条目只对 DELETE 生效，不会误伤读路径。
	// 取证：audit-batch-oo-badid-20261015.json（DELETE 三方法逐条）。
	"equipment_maintenances":  "无效的记录ID",
	"crm_activities":          "无效的记录ID",
	"tax_accruals":            "无效的ID格式",
}

// badIDMessage 返回该表非法 UUID 时的原版文案；未取证的表回落原有「无效的 ID」。
func badIDMessage(table string) string {
	if msg, ok := badIDMessages[table]; ok {
		return msg
	}
	return "无效的 ID"
}

// ppWriteNotFound 以路由名为键：原版对 PUT/DELETE /{res}/{合法UUID不存在} 的特殊 notFound 形态
// （HTTP 400 + code 400，与 writeNotFoundBusiness 的 200+10000 不同类，不能复用）。
//
// 取证：tools/replay-batch-oo-badid2.js（2026-10-15，
// evidence/backend-runtime/audit-batch-oo-badid2-20261015.txt）：
//
//	DELETE /equipment-maintenances/{uuid} → 400「保养/维修记录不存在」
//	DELETE /tax-accruals/{uuid}           → 400「计提记录不存在」
//
// 未列出的路由保持原有行为，不得自造。
var ppWriteNotFound = map[string]string{
	"equipment-maintenances": "保养/维修记录不存在",
	"tax-accruals":           "计提记录不存在",
}
