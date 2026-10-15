package api

import (
	"fmt"
	"strings"
	"testing"
	"time"
)

// 本文件把批次 NN 的**计件与打印模板**两端对照取证固化成回归测试。
//
// 背景：fix-bank-adj 留档称这三类资源「写路径有缺口」但未附证据。批次 NN 实测
// （evidence/backend-runtime/audit-batch-nn-piecework-20261015.json 27 条、
// -piecework2-20261015.json 22 条）确认缺口存在，但形态与留档不同：
// 不是路由缺失，而是**恢复端用通用必填校验自造了一套原版没有的 4xx**，
// 且漏掉了原版真正的业务校验链。
//
// ⚠ 原版这三个资源的 4xx 只出现在**解码层**（decimal / time 解析失败），
// 业务层一律是 200 + code 10000 + 中文文案。恢复端原先正好反过来。
//
// 另有一处**功能性**缺口：`GET /piecework-records/importable-processes` 被通用
// `GET /piecework-records/{id}` 通配吞掉，前端「导入工序报工」页面加载不出列表
// （与批次 KK 的 `sales-contracts/options` 同类）。

const nnGenericServerError = "系统内部错误，请稍后重试或联系管理员"

// nnNameSeq 保证名字唯一。只靠 UnixNano 不够 —— 表驱动用例在构建 slice 时
// 会**连续求值**，Windows 的纳秒精度不足，相邻两条会拿到同一个时间戳，
// 于是后一条撞上前一条建的记录，全变成「同名计件项已存在」。
var nnNameSeq int64

// nnUniqueName 生成互不相同的名字 —— piece_rates 有同名唯一约束，
// 用例之间若重名会互相干扰（首条成功、后续全变「同名计件项已存在」）。
func nnUniqueName(tag string) string {
	nnNameSeq++
	return fmt.Sprintf("%s-%d-%d", tag, time.Now().UnixNano(), nnNameSeq)
}

// TestNNPieceRateValidation 计件单价的校验顺序与文案。
func TestNNPieceRateValidation(t *testing.T) {
	c, _ := setup(t)
	const decodeMsg = "参数错误: error decoding string 'abc': can't convert abc to decimal"

	for _, tc := range []struct {
		tag     string
		body    map[string]any
		http    int
		code    float64
		message string
	}{
		// unit_price 解码在**最前**：不带 name 也先报解码错
		{"空载荷", map[string]any{}, 200, 10000, "计件项名称不能为空"},
		{"unit_price 负、无 name", map[string]any{"unit_price": -1}, 200, 10000, "计件项名称不能为空"},
		{"unit_price 非数字、无 name", map[string]any{"unit_price": "abc"}, 400, 400, decodeMsg},
		{"新名 + unit_price 非数字", map[string]any{"name": nnUniqueName("NN"), "unit_price": "abc"}, 400, 400, decodeMsg},
		{"新名 + unit_price 负", map[string]any{"name": nnUniqueName("NN"), "unit_price": -1}, 200, 10000, "单价不能为负数"},
		{"新名 + status 非法", map[string]any{"name": nnUniqueName("NN"), "unit_price": 1, "status": "x"}, 200, 10000, "状态无效（active/disabled）"},
		{"新名 + unit_price 0", map[string]any{"name": nnUniqueName("NN"), "unit_price": 0}, 200, 0, "success"},
		{"新名 + status=disabled", map[string]any{"name": nnUniqueName("NN"), "unit_price": 1, "status": "disabled"}, 200, 0, "success"},
	} {
		t.Run(tc.tag, func(t *testing.T) {
			status, body := c.request("POST", "/api/v1/piecework-rates", tc.body)
			if status != tc.http || body["code"] != tc.code || body["message"] != tc.message {
				t.Fatalf("%s = %d %v, want %d/%v/%s", tc.tag, status, body, tc.http, tc.code, tc.message)
			}
		})
	}
}

// TestNNPieceRateDuplicate 同名唯一约束，且 PUT 时**排除自身**。
func TestNNPieceRateDuplicate(t *testing.T) {
	c, _ := setup(t)
	name := nnUniqueName("NN-DUP")
	doc := c.ok("POST", "/api/v1/piecework-rates", map[string]any{"name": name, "unit_price": 1}).(map[string]any)
	id := doc["id"].(string)

	if status, body := c.request("POST", "/api/v1/piecework-rates", map[string]any{"name": name, "unit_price": 2}); status != 200 ||
		body["code"] != float64(10000) || body["message"] != "同名计件项已存在" {
		t.Fatalf("重名建单 = %d %v, want 200/10000/同名计件项已存在", status, body)
	}
	// 同名但 PUT 自己 → 放行
	if status, body := c.request("PUT", "/api/v1/piecework-rates/"+id, map[string]any{"name": name, "unit_price": 5}); status != 200 || body["code"] != float64(0) {
		t.Fatalf("PUT 同名自身 = %d %v, want 200/0", status, body)
	}
	// PUT 空名 → 业务文案
	if status, body := c.request("PUT", "/api/v1/piecework-rates/"+id, map[string]any{"unit_price": 6}); status != 200 ||
		body["code"] != float64(10000) || body["message"] != "计件项名称不能为空" {
		t.Fatalf("PUT 空名 = %d %v, want 200/10000/计件项名称不能为空", status, body)
	}
}

// TestNNPieceworkRecordValidation 计件登记的校验顺序与文案。
func TestNNPieceworkRecordValidation(t *testing.T) {
	c, _ := setup(t)
	const workDate = "2030-01-01T00:00:00+08:00"
	const decodeMsg = "参数错误: error decoding string 'abc': can't convert abc to decimal"
	// Go time.Parse 的原始错误输出，随 Go 版本可能变，只断言前缀
	const parsePrefix = `参数错误: parsing time "2030-01-01" as "2006-01-02T15:04:05Z07:00"`

	for _, tc := range []struct {
		tag     string
		body    map[string]any
		http    int
		code    float64
		message string
	}{
		// 数量检查**早于**日期与计件项
		{"空载荷", map[string]any{}, 200, 10000, "数量必须大于 0"},
		{"qty=0", map[string]any{"qty": 0}, 200, 10000, "数量必须大于 0"},
		{"qty=-1", map[string]any{"qty": -1}, 200, 10000, "数量必须大于 0"},
		{"qty 非数字", map[string]any{"qty": "abc"}, 400, 400, decodeMsg},
		{"qty=1 缺日期", map[string]any{"qty": 1}, 200, 10000, "作业日期不能为空"},
		{"qty=1 + 日期缺计件项", map[string]any{"qty": 1, "work_date": workDate}, 200, 10000, "计件项不能为空"},
		{"employee_id 不存在", map[string]any{"qty": 1, "work_date": workDate, "item_name": "项A", "employee_id": nnMissingID}, 200, 10000, "所选员工不存在或已被删除"},
		// employee_id 为空时**不校验**（只给 employee_name 也放行）
		{"只给 employee_name", map[string]any{"qty": 2, "work_date": workDate, "item_name": "项A", "employee_name": "张三"}, 200, 0, "success"},
	} {
		t.Run(tc.tag, func(t *testing.T) {
			status, body := c.request("POST", "/api/v1/piecework-records", tc.body)
			if status != tc.http || body["code"] != tc.code || body["message"] != tc.message {
				t.Fatalf("%s = %d %v, want %d/%v/%s", tc.tag, status, body, tc.http, tc.code, tc.message)
			}
		})
	}
	// 日期格式错：文案含 Go time.Parse 原始输出，只断言前缀
	status, body := c.request("POST", "/api/v1/piecework-records", map[string]any{"qty": 1, "work_date": "2030-01-01"})
	if status != 400 || body["code"] != float64(400) {
		t.Fatalf("work_date 非法 = %d %v, want 400/400", status, body)
	}
	if msg, _ := body["message"].(string); !strings.HasPrefix(msg, parsePrefix) {
		t.Fatalf("work_date 非法文案 = %q, want 前缀 %q", msg, parsePrefix)
	}
}

// TestNNPieceworkRecordCode 计件登记单号是**自动生成**的 JJ 流水号。
//
// 原恢复端把 code 列进了必填，调用方不传就在第一步被 400 挡掉；
// 通用 record() 的兜底值 `PIECEWORK_RECORD-<uuid12>` 也与原版不符。
func TestNNPieceworkRecordCode(t *testing.T) {
	c, _ := setup(t)
	doc := c.ok("POST", "/api/v1/piecework-records", map[string]any{
		"qty": 1, "work_date": "2030-01-01T00:00:00+08:00", "item_name": "项A", "employee_name": "张三",
	}).(map[string]any)
	code, _ := doc["code"].(string)
	day := time.Now().In(time.FixedZone("CST", 8*60*60)).Format("20060102")
	if !strings.HasPrefix(code, "JJ"+day) {
		t.Fatalf("code = %q, want JJ%s 前缀", code, day)
	}
	if len(code) != len("JJ"+day)+4 {
		t.Fatalf("code = %q, want JJ+日期+4 位流水", code)
	}
}

// TestNNImportableProcesses 可导入工序端点不再被 {id} 通配吞掉。
func TestNNImportableProcesses(t *testing.T) {
	c, _ := setup(t)
	if status, body := c.request("GET", "/api/v1/piecework-records/importable-processes?period=2030-01", nil); status != 200 || body["code"] != float64(0) {
		t.Fatalf("带 period = %d %v, want 200/0", status, body)
	}
	// 原版返回**空数组**，不是 list/total 分页对象
	data := c.ok("GET", "/api/v1/piecework-records/importable-processes?period=2030-01", nil)
	if _, ok := data.([]any); !ok {
		t.Fatalf("data = %T %v, want 数组", data, data)
	}
	if status, body := c.request("GET", "/api/v1/piecework-records/importable-processes", nil); status != 400 ||
		body["message"] != "请指定期间（YYYY-MM）" {
		t.Fatalf("缺 period = %d %v, want 400/请指定期间（YYYY-MM）", status, body)
	}
	if status, body := c.request("GET", "/api/v1/piecework-records/importable-processes?period=bad", nil); status != 200 ||
		body["code"] != float64(10000) || body["message"] != "期间格式无效（应为 YYYY-MM）" {
		t.Fatalf("period 非法 = %d %v, want 200/10000/期间格式无效（应为 YYYY-MM）", status, body)
	}
}

// TestNNPrintTemplateWrite 打印模板的 POST 校验与写路径 notFound 形态。
//
// ⚠ 同一资源两套形态：GET 详情是 404「打印模板不存在」，而
// PUT / DELETE / duplicate 是 **500 通用文案**，勿统一。
func TestNNPrintTemplateWrite(t *testing.T) {
	c, _ := setup(t)
	for _, tc := range []struct {
		tag     string
		body    map[string]any
		http    int
		message string
	}{
		{"空载荷", map[string]any{}, 400, "doc_type 与 name 必填"},
		{"只有 doc_type", map[string]any{"doc_type": "sale_order"}, 400, "doc_type 与 name 必填"},
		{"只有 name", map[string]any{"name": nnUniqueName("NN")}, 400, "doc_type 与 name 必填"},
		{"doc_type 空串", map[string]any{"doc_type": "", "name": nnUniqueName("NN")}, 400, "doc_type 与 name 必填"},
		{"name 空串", map[string]any{"doc_type": "sale_order", "name": ""}, 400, "doc_type 与 name 必填"},
	} {
		t.Run(tc.tag, func(t *testing.T) {
			status, body := c.request("POST", "/api/v1/print-templates", tc.body)
			if status != tc.http || body["message"] != tc.message {
				t.Fatalf("%s = %d %v, want %d/%s", tc.tag, status, body, tc.http, tc.message)
			}
		})
	}
	// 写路径 notFound → 500 通用
	for _, tc := range []struct{ method, path string }{
		{"PUT", "/api/v1/print-templates/" + nnMissingID},
		{"DELETE", "/api/v1/print-templates/" + nnMissingID},
		{"POST", "/api/v1/print-templates/" + nnMissingID + "/duplicate"},
	} {
		status, body := c.request(tc.method, tc.path, map[string]any{})
		if status != 500 || body["code"] != float64(500) || body["message"] != nnGenericServerError {
			t.Fatalf("%s %s = %d %v, want 500/%s", tc.method, tc.path, status, body, nnGenericServerError)
		}
	}
	// GET 详情保持 404（与写路径不同形态）
	if status, body := c.request("GET", "/api/v1/print-templates/"+nnMissingID, nil); status != 404 || body["message"] != "打印模板不存在" {
		t.Fatalf("GET 不存在 id = %d %v, want 404/打印模板不存在", status, body)
	}
}

// TestNNPrintTemplateIdempotent PUT 空载荷放行、DELETE 幂等。
//
// 回放：原版 `PUT` 空载荷返回 200 code 0 并回传原记录；`DELETE` 对已软删的 id
// 再删一次仍返回 200 code 0（裸 UPDATE 命中行即成功），只有从未存在的 id 才 500。
func TestNNPrintTemplateIdempotent(t *testing.T) {
	c, _ := setup(t)
	doc := c.ok("POST", "/api/v1/print-templates", map[string]any{
		"doc_type": "sale_order", "name": nnUniqueName("NN"),
	}).(map[string]any)
	id := doc["id"].(string)

	if status, body := c.request("PUT", "/api/v1/print-templates/"+id, map[string]any{}); status != 200 || body["code"] != float64(0) {
		t.Fatalf("PUT 空载荷 = %d %v, want 200/0", status, body)
	}
	if status, body := c.request("DELETE", "/api/v1/print-templates/"+id, nil); status != 200 || body["code"] != float64(0) {
		t.Fatalf("DELETE 首次 = %d %v, want 200/0", status, body)
	}
	// 幂等：已删再删仍 code 0（Store.Update 带 deleted_at 过滤会把这里判成不存在）
	if status, body := c.request("DELETE", "/api/v1/print-templates/"+id, nil); status != 200 || body["code"] != float64(0) {
		t.Fatalf("DELETE 二次 = %d %v, want 200/0（幂等）", status, body)
	}
}
