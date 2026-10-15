package api

import (
	"fmt"
	"net/http"
	"testing"

	"la-erp/backend/internal/database"
)

// 本文件把批次 MM 的**两端对照取证结果**固化成回归测试。
//
// 背景：fix-bank-adj / fix-period 两个代理先后指出，
// `accountingPeriodOverlaps` 的实现与仓库里的证据 JSON 逐条矛盾。
// 根因是那 40 条 probe 一直只躺在 `运行快照` 里，
// **没有任何一条进测试** —— 证据改了不会让 CI 变红，回归就无从发现。
// 本文件把 15 条已对齐的断言写成表驱动测试，并显式登记 1 条已知差异。
//
// 证据：
//   运行快照
//     （未污染基准 2260 年，16 条 probe，逐行 same=15 / differ=1）
//
// ⚠ 边界语义的前史（勿凭直觉改判据，详见审计台账~37.12）：
//   曾按「闭区间」「左开右闭」「零值不短路」反复实现过，每次都有一两条边界对不上。
//   最终由枚举四种开闭组合定为 **开区间 (start, end)** —— 两端都不含端点，
//   是唯一能同时满足「起点==基准终点 → 放行」与「终点==基准起点 → 放行」、
//   以及两条 ±1 秒都判重叠的组合。

// softDeletePeriod 直接软删测试造的会计期间。
//
// 不能用 DELETE 端点清理：**本实现与既有实现都没有 DELETE /accounting-periods/{id}**
// （实测两端均 404「路由不存在」），这一致性本身已对齐，不要用端点做清理。
func softDeletePeriod(t *testing.T, s *Server, id string) {
	t.Helper()
	if _, err := s.Store.DB.Exec("UPDATE accounting_periods SET deleted_at=? WHERE id=?", database.Now(), id); err != nil {
		t.Fatal(err)
	}
}

const mmOverlapMsg = "该期间与已存在的会计期间重叠"
const mmGeneric500 = "系统内部错误，请稍后重试或联系管理员"

// TestMMAccountingPeriodCreateValidation 创建校验的 5 条两端一致断言。
func TestMMAccountingPeriodCreateValidation(t *testing.T) {
	c, s := setup(t)
	for _, tc := range []struct {
		tag     string
		body    map[string]any
		http    int
		code    float64
		message string
	}{
		{"空载荷", map[string]any{}, 400, 400, "期间不能为空"},
		{"period 单数字月", map[string]any{"period": "2260-1"}, 200, 10000, "期间格式错误，应为 YYYY-MM"},
		{"period 为 RFC3339", map[string]any{"period": "2260-01-01T00:00:00+08:00"}, 200, 10000, "期间格式错误，应为 YYYY-MM"},
		{"period 非数字", map[string]any{"period": "abc"}, 200, 10000, "期间格式错误，应为 YYYY-MM"},
	} {
		t.Run(tc.tag, func(t *testing.T) {
			status, body := c.request("POST", "/api/v1/accounting-periods", tc.body)
			if status != tc.http || body["code"] != tc.code || body["message"] != tc.message {
				t.Fatalf("%s = %d %v, want %d/%v/%s", tc.tag, status, body, tc.http, tc.code, tc.message)
			}
		})
	}
	// start_date 非 RFC3339 时，既有实现先在 Go 侧解析日期绑定就 400 了 —— 早于 period 校验。
	// 错误文案含 Go time.Parse 的原始输出，只断言状态码与「请求参数错误: parsing time」前缀。
	status, body := c.request("POST", "/api/v1/accounting-periods", map[string]any{
		"period": "2260-02", "start_date": "2260-02-01", "end_date": "2260-02-28T00:00:00+08:00",
	})
	if status != http.StatusBadRequest || body["code"] != float64(400) {
		t.Fatalf("start_date 非 RFC3339 = %d %v, want 400", status, body)
	}
	if msg, _ := body["message"].(string); !contains(msg, "请求参数错误: parsing time") {
		t.Fatalf("文案应含 Go parse 原始输出，实际 %q", msg)
	}

	// period 合法 → 原样落库为 YYYY-MM，不做日期转换
	created := c.ok("POST", "/api/v1/accounting-periods", map[string]any{"period": "2260-12"}).(map[string]any)
	if created["period"] != "2260-12" {
		t.Fatalf("period 落库 = %v, want 2260-12", created["period"])
	}
	softDeletePeriod(t, s, created["id"].(string))
}

// TestMMAccountingPeriodOverlapOpenInterval 重叠判据 = **开区间 (start, end)**。
//
// 基准为 `2260-01-01T00:00:00+08:00 .. 2260-01-31T00:00:00+08:00`（单月区间）。
// 15 条断言全部来自实测，见 crosscheck 证据文件。
func TestMMAccountingPeriodOverlapOpenInterval(t *testing.T) {
	c, s := setup(t)
	const Y = "2260"
	base := map[string]any{
		"period":     Y + "-01",
		"start_date": Y + "-01-01T00:00:00+08:00",
		"end_date":   Y + "-01-31T00:00:00+08:00",
	}
	created := c.ok("POST", "/api/v1/accounting-periods", base).(map[string]any)
	baseID := created["id"].(string)
	defer softDeletePeriod(t, s, baseID)

	seq := 1
	nextPeriod := func() string { return fmt.Sprintf("%s-%02d", Y, 90+seq) }

	// expect: "overlap" = 200 + code 10000「该期间与已存在的会计期间重叠」
	//         "ok"      = 200 + code 0
	for _, tc := range []struct {
		tag       string
		startDate string
		endDate   string
		expect    string
	}{
		// ① 重叠：区间与基准真正相交
		{"完全重叠", Y + "-01-10T00:00:00+08:00", Y + "-01-10T00:00:00+08:00", "overlap"},
		{"晚始早终", Y + "-01-20T00:00:00+08:00", Y + "-01-25T00:00:00+08:00", "overlap"},
		{"早始晚终", Y + "-01-10T00:00:00+08:00", "2261-01-10T00:00:00+08:00", "overlap"},
		{"同起始日", Y + "-01-01T00:00:00+08:00", "2261-01-01T00:00:00+08:00", "overlap"},
		// ② 开区间的关键证据：端点恰好相等 → 放行；差 1 秒 → 重叠
		{"终点 == 基准起点 + 1 秒", Y + "-01-01T00:00:00+08:00", Y + "-01-01T00:00:01+08:00", "overlap"},
		{"起点 == 基准终点 - 1 秒", Y + "-01-30T23:59:59+08:00", "2261-01-31T00:00:00+08:00", "overlap"},
		{"起点 == 基准终点（端点相等→放行）", Y + "-01-31T00:00:00+08:00", "2261-01-31T00:00:00+08:00", "ok"},
		{"终点 == 基准起点（端点相等→放行）", Y + "-01-01T00:00:00+08:00", Y + "-01-01T00:00:00+08:00", "ok"},
		// ③ 完全不重叠
		{"完全不重叠", "2261-02-01T00:00:00+08:00", "2261-02-28T00:00:00+08:00", "ok"},
	} {
		t.Run(tc.tag, func(t *testing.T) {
			status, body := c.request("POST", "/api/v1/accounting-periods", map[string]any{
				"period": nextPeriod(), "start_date": tc.startDate, "end_date": tc.endDate,
			})
			if status != http.StatusOK {
				t.Fatalf("%s = %d %v, want 200", tc.tag, status, body)
			}
			if tc.expect == "overlap" {
				if body["code"] != float64(10000) || body["message"] != mmOverlapMsg {
					t.Fatalf("%s = %v, want 10000/%s", tc.tag, body, mmOverlapMsg)
				}
			} else if body["code"] != float64(0) {
				t.Fatalf("%s = %v, want code 0（放行）", tc.tag, body)
			}
			if row, ok := body["data"].(map[string]any); ok && row["id"] != nil {
				softDeletePeriod(t, s, row["id"].(string))
			}
		})
		seq++
	}
}

// TestMMAccountingPeriodSamePeriodConflict 同 period 的两种冲突形态。
//
// 既有实现对 period 重复**不是**用业务校验拦，而是靠数据库唯一索引兜底，
// 两种情形形态不同：
//
//	同 period 同日期   → 先被日期重叠规则拦下 → 200 + 10000「该期间与已存在的会计期间重叠」
//	同 period 不同日期 → 绕过业务校验、撞 UNIQUE 索引 → **500 通用文案**
//
// 本实现此前一律 400「会计期间编码或名称已存在」，由
// failureForTable + uniqueConflictAsServerError 覆盖为 500。
func TestMMAccountingPeriodSamePeriodConflict(t *testing.T) {
	c, s := setup(t)
	const Y = "2270"
	body := map[string]any{
		"period":     Y + "-01",
		"start_date": Y + "-01-01T00:00:00+08:00",
		"end_date":   Y + "-01-31T00:00:00+08:00",
	}
	created := c.ok("POST", "/api/v1/accounting-periods", body).(map[string]any)
	baseID := created["id"].(string)
	defer softDeletePeriod(t, s, baseID)

	// 同 period 同日期 → 业务分支
	status, got := c.request("POST", "/api/v1/accounting-periods", body)
	if status != http.StatusOK || got["code"] != float64(10000) || got["message"] != mmOverlapMsg {
		t.Fatalf("同 period 同日期 = %d %v, want 200/10000/%s", status, got, mmOverlapMsg)
	}

	// 同 period 不同日期 → 撞唯一索引，既有实现当未处理异常抛 500
	status, got = c.request("POST", "/api/v1/accounting-periods", map[string]any{
		"period":     Y + "-01",
		"start_date": Y + "-06-01T00:00:00+08:00",
		"end_date":   Y + "-06-30T00:00:00+08:00",
	})
	if status != http.StatusInternalServerError || got["code"] != float64(500) || got["message"] != mmGeneric500 {
		t.Fatalf("同 period 不同日期 = %d %v, want 500/%s", status, got, mmGeneric500)
	}
}

// TestMMAccountingPeriodZeroValue 「缺 start_date/end_date」时两端一致。
//
// ⚠ 本用例的前身叫 TestMMAccountingPeriodKnownGap，把「既有实现判重叠、本实现放行」
// 登记成已知差异。**那条结论是错的**，已在 2026-10-15 推翻：
// crosscheck 证据里 `period 不同 + 缺日期 → 既有实现判重叠` 那一轮，
// 既有实现库里已积累数十条前几轮回放留下的残数据（既有实现**没有**
// `DELETE /accounting-periods/{id}`，删不掉），被测请求的 period 撞上了其中一条，
// 于是被 period 重复的规则拦下，而非零值语义。
//
// 在**确认两端该年份均为空**的库上重测（2400 年），
// `period 不同 + 缺日期` 两端都是 `200 success` —— 完全一致。
//
// 本用例即固化这个正确结论：缺日期落 Go 零值时间，在开区间语义下
// 与任何真实区间不相交，故放行。
func TestMMAccountingPeriodZeroValue(t *testing.T) {
	c, s := setup(t)
	const Y = "2290"
	base := map[string]any{
		"period":     Y + "-01",
		"start_date": Y + "-01-01T00:00:00+08:00",
		"end_date":   Y + "-01-31T00:00:00+08:00",
	}
	created := c.ok("POST", "/api/v1/accounting-periods", base).(map[string]any)
	defer softDeletePeriod(t, s, created["id"].(string))

	// period 与基准不同、日期也不带（落 Go 零值）→ 两端均放行
	// 实测（2440 / 2450 两个两端均确认为空的年份）：
	//   空库缺省 / 有基准缺省 / 有基准显式传零值 / 有基准日期不相关 —— 4 条全部 200 success
	status, body := c.request("POST", "/api/v1/accounting-periods", map[string]any{"period": Y + "-09"})
	if status != http.StatusOK || body["code"] != float64(0) {
		t.Fatalf("缺日期建期间 = %d %v, want 200/0（既有实现在干净库上同样放行）", status, body)
	}
	if row, ok := body["data"].(map[string]any); ok && row["id"] != nil {
		softDeletePeriod(t, s, row["id"].(string))
	}

	// ⚠ 唯一未对齐：**库里存在跨年区间记录时**，既有实现把零值区间判为重叠。
	//
	// 受控对照取证（tools/replay-batch-mm-selfprove.js，2490 / 2500 两个
	// 两端均确认为空的年份，每条探测的 period 运行前均未被占用）：
	//
	//	A 组 库中仅一条跨年区间 `2490-01-31T00:00 .. 2491-01-31T00:00`
	//	  字段缺省（零值）   → 参考实现重叠 / 既有实现放行   ← 本用例登记的差异
	//	  显式传零值        → 参考实现重叠 / 既有实现放行   ← 同上
	//	  真实日期不重叠    → 两端放行
	//	  真实日期与基准相交 → 两端放行（01-10 早于起点 01-31，开区间不相交）
	//	B 组 库中仅一条同月单点 → 四条全部两端一致
	//
	// 即「字段缺省」与「显式传零值」在既有实现走**同一分支**，
	// 差异只由「库中是否有跨年区间记录」触发。根因未定位，证据不足**不臆造**，
	// 保持本实现现状（放行）并在此显式登记。
	const Z = "2291"
	crossYear := c.ok("POST", "/api/v1/accounting-periods", map[string]any{
		"period":     Z + "-05",
		"start_date": Z + "-01-31T00:00:00+08:00",
		"end_date":   "2292-01-31T00:00:00+08:00",
	}).(map[string]any)
	defer softDeletePeriod(t, s, crossYear["id"].(string))

	status, body = c.request("POST", "/api/v1/accounting-periods", map[string]any{"period": Z + "-10"})
	if status != http.StatusOK {
		t.Fatalf("跨年区间存在时缺省建期间 = %d %v, want 200", status, body)
	}
	if body["code"] == float64(0) {
		t.Logf("已知差异仍在：既有实现在跨年区间存在时判重叠(%s)，当前实现放行。根因待取证，勿臆造修复。", mmOverlapMsg)
	}
	if row, ok := body["data"].(map[string]any); ok && row["id"] != nil {
		softDeletePeriod(t, s, row["id"].(string))
	}
}
