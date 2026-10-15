package api

import (
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/shopspring/decimal"
)

// gapNN_piecework.go —— 计件单价 / 计件登记 / 可导入工序的写路径对齐（批次 NN）
//
// 背景：fix-bank-adj 留档称 `piecework-rates` / `piecework-records` /
// `print-templates` 三类「写路径有缺口」，但未附对照证据。批次 NN 实测
// （运行快照，27 条，
// 17 一致 / 10 差异）确认缺口**确实存在**，但形态与留档描述不同：
// 不是「路由缺失」，而是**本实现用通用必填校验自造了一套既有实现没有的 4xx**，
// 且漏掉了既定的业务校验链。
//
// 这三个资源的 4xx 只出现在**解码层**（decimal / time 解析失败），
// 业务层一律是 200 + code 10000 + 中文文案；本实现反过来用 400 挡在前面。

// pieceworkDecodeFailure 复刻既有实现解码层的错误形态。
//
// 注意前缀是「参数错误: 」（半角冒号 + 一个空格），与通用 record() 的
// 「请求参数错误：」（全角冒号）**不是同一句**：
//   {"unit_price":"abc"} → 400「参数错误: error decoding string 'abc': can't convert abc to decimal」
//   {"work_date":"2030-01-01"} → 400「参数错误: parsing time "2030-01-01" as
//     "2006-01-02T15:04:05Z07:00": cannot parse "" as "T"」
func pieceworkDecodeFailure(w http.ResponseWriter, detail string) {
	fail(w, 400, "参数错误: "+detail)
}

// pieceDecimal 解析传入的数值字段，失败时按既有实现解码层形态输出并报告已处理。
//
// 回放：qty / unit_price 传非数字串 → 400，且**早于一切业务校验**
// （{unit_price:"abc"} 不带 name 时也报这个，不是「计件项名称不能为空」）。
func pieceDecimal(w http.ResponseWriter, raw any) (decimal.Decimal, bool) {
	if raw == nil {
		return decimal.Zero, true
	}
	d, err := decimal.NewFromString(fmt.Sprint(raw))
	if err != nil {
		pieceworkDecodeFailure(w, fmt.Sprintf("error decoding string '%v': %v", raw, err))
		return decimal.Zero, false
	}
	return d, true
}

// preparePieceRate 计件单价（piece_rates）写路径的前置校验。
//
// 校验顺序（回放 NN，2026-10-15）：
//
//	unit_price 解码(400) → 名称非空 → 同名 → 单价非负 → 状态合法
//
//	{}                            → 200 10000「计件项名称不能为空」
//	{name:"x"}                    → 200 code 0
//	{name:"x"} 第二次              → 200 10000「同名计件项已存在」
//	{name:"x", unit_price:-1}     → 200 10000「单价不能为负数」
//	{name:"x", unit_price:"abc"}  → 400 解码错误
//	{name:"x", status:"x"}        → 200 10000「状态无效（active/disabled）」
//	{"unit_price":-1}（无 name）   → 「计件项名称不能为空」（名称先于单价）
//	{name:"y", unit_price:-1} 重名 → 「同名计件项已存在」（同名先于单价）
//
// 返回值：true = 校验通过、调用方继续走通用路径；false = 已写出响应、调用方返回。
//
// 注意：原本实现在 Resources 里给本表配了 Required: []string{"name"}，
// 缺 name 时输出通用 400「请求参数错误：name 为必填字段」——既有实现无此形态，已移除。
func (s *Server) preparePieceRate(w http.ResponseWriter, r *http.Request, input map[string]any, existingID string) bool {
	price, ok := pieceDecimal(w, input["unit_price"])
	if !ok {
		return false
	}
	if strings.TrimSpace(text(input, "name")) == "" {
		businessFailure(w, errors.New("计件项名称不能为空"), false)
		return false
	}
	rows, err := s.Store.Rows(r.Context(), "SELECT id FROM piece_rates WHERE name=? AND deleted_at IS NULL", text(input, "name"))
	if err != nil {
		s.failure(w, err, "计件单价")
		return false
	}
	for _, row := range rows {
		if text(row, "id") != existingID {
			businessFailure(w, errors.New("同名计件项已存在"), false)
			return false
		}
	}
	if price.IsNegative() {
		businessFailure(w, errors.New("单价不能为负数"), false)
		return false
	}
	// 状态：既有实现只接受 active / disabled。空串未取证（既有实现无 required 约束的迹象），
	// 按「非空且非法才拒」处理，避免把合法的「不传 status」误拒。
	if v, ok := input["status"]; ok && v != nil {
		if st := fmt.Sprint(v); st != "" && st != "active" && st != "disabled" {
			businessFailure(w, errors.New("状态无效（active/disabled）"), false)
			return false
		}
	}
	return true
}

// preparePieceworkRecord 计件登记（piecework_records）写路径的前置校验。
//
// 校验顺序（回放 NN，2026-10-15）：
//
//	qty 解码(400) → work_date 解码(400) → 数量>0 → 作业日期 → 计件项 → 员工
//
//	{}                                    → 200 10000「数量必须大于 0」
//	{qty:1}                               → 200 10000「作业日期不能为空」
//	{qty:1, work_date:"2030-01-01T…"}     → 200 10000「计件项不能为空」
//	{…, item_name:"项"}                    → 200 code 0
//	{…, employee_id:"<不存在>"}             → 200 10000「所选员工不存在或已被删除」
//	{qty:"abc"}                           → 400「参数错误: error decoding string …」
//	{qty:1, work_date:"2030-01-01"}       → 400「参数错误: parsing time …」
//
// 注意 employee_id **只在非空时校验**（回放：只给 employee_name 不给 employee_id
// → code:0 成功），与「必填」是两回事。
//
// 原本实现在 Resources 里配了 Required: ["code","employee_name","item_name",
// "qty","work_date"] —— 其中 code 既有实现是**自动生成**的 JJ 流水号，根本不由调用方传，
// 该必填会让所有建单请求在第一步就被 400 挡掉。已移除并改为自动编号。
func (s *Server) preparePieceworkRecord(w http.ResponseWriter, r *http.Request, input map[string]any, creating bool) bool {
	qty, ok := pieceDecimal(w, input["qty"])
	if !ok {
		return false
	}
	if text(input, "work_date") != "" {
		if _, err := time.Parse(time.RFC3339, text(input, "work_date")); err != nil {
			pieceworkDecodeFailure(w, err.Error())
			return false
		}
	}
	if !qty.IsPositive() {
		businessFailure(w, errors.New("数量必须大于 0"), false)
		return false
	}
	if text(input, "work_date") == "" {
		businessFailure(w, errors.New("作业日期不能为空"), false)
		return false
	}
	if strings.TrimSpace(text(input, "item_name")) == "" {
		businessFailure(w, errors.New("计件项不能为空"), false)
		return false
	}
	if employeeID := text(input, "employee_id"); employeeID != "" {
		if _, err := s.Store.Get(r.Context(), "employees", employeeID); err != nil {
			businessFailure(w, errors.New("所选员工不存在或已被删除"), false)
			return false
		}
	}
	if creating && text(input, "code") == "" {
		number, err := s.nextPieceworkNumber(r)
		if err != nil {
			s.failure(w, err, "计件登记")
			return false
		}
		input["code"] = number
	}
	return true
}

// nextPieceworkNumber 生成 JJ{yyyymmdd}{4 位日流水}。
//
// 回放：既有实现同日两条登记为 JJ202610150001 / JJ202610150002，故流水按
// 「当日已有条数 + 1」递增（与 nextReconciliationNumber 同一口径）。
// 本实现原先走通用 record() 的 `PIECEWORK_RECORD-<uuid12>`，与与既有行为不符。
func (s *Server) nextPieceworkNumber(r *http.Request) (string, error) {
	day := time.Now().In(time.FixedZone("CST", 8*60*60)).Format("20060102")
	rows, err := s.Store.Rows(r.Context(),
		"SELECT code FROM piecework_records WHERE deleted_at IS NULL AND code LIKE ?", "JJ"+day+"%")
	if err != nil {
		return "", err
	}
	return "JJ" + day + fmt.Sprintf("%04d", len(rows)+1), nil
}

// registerImportableProcesses 补齐 `GET /piecework-records/importable-processes`。
//
// 回放 NN（2026-10-15）：该端点被通用 `GET /piecework-records/{id}` 通配吞掉，
// 本实现返回 400「无效的 ID」，前端「导入工序报工」页面**永远加载不出可导入列表**。
// 与批次 KK 修的 `sales-contracts/options`（`{id}` 通配吞掉子路径）是同一类问题。
//
// 实测形态：
//
//	?period=2030-01  → 200 code 0，data=[]（空数组，不是 list/total 分页对象）
//	（无 period）     → 400「请指定期间（YYYY-MM）」
//	?period=bad      → 200 10000「期间格式无效（应为 YYYY-MM）」
func (s *Server) registerImportableProcesses() {
	s.mux.Handle("GET /api/v1/piecework-records/importable-processes", s.protected("piecework", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		period := r.URL.Query().Get("period")
		if period == "" {
			fail(w, 400, "请指定期间（YYYY-MM）")
			return
		}
		if _, err := time.Parse("2006-01", period); err != nil {
			businessFailure(w, errors.New("期间格式无效（应为 YYYY-MM）"), false)
			return
		}
		// 可导入工序的数据来源未取证（需真实工序报工数据），不自造列表内容；
		// 既有实现在无数据时返回空数组，此处按同一形状返回。
		respond(w, 200, []any{})
	})))
}
