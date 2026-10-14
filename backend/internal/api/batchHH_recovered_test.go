package api

import (
	"encoding/json"
	"net/http"
	"testing"
)

// 本文件固化批次 HH 的取证结论（2026-10-14 原版回放 192.168.110.97:18886）。
//
// 背景：backend/internal/api/read_resources.json 的 69 条通用读资源此前只核对了
// 「路由是否存在」，从未核对过响应契约。批次 HH 用
// tools/replay-batch-hh.js 向原版逐条回放列表与详情，实测出：
//   - 列表形状：69/69 均为 {total, list} —— 与恢复端一致，无差异
//   - 详情不存在的形态：原版分三类
//       ① HTTP 404 + code 404 +「<中文单据名>不存在」
//       ② HTTP 200 + code 10000 +「<中文名>不存在」
//       ③ HTTP 404/500 +「系统内部错误，请稍后重试或联系管理员」
//     恢复端原先一律 404 +「<表名>不存在」，38 条不符
//   - 详情路由有无：8 条资源原版没有详情路由（404「路由不存在」），
//     恢复端被通用读资源自动补出，已显式关掉
//
// 证据：evidence/backend-runtime/audit-batch-hh-20261014.json
// 差异对照：tools/probe-read-contract.js（对原版/恢复端跑同一份探测）

// TestBatchHHReadResourceListShape 列表形状：全部资源均为 {total, list}。
func TestBatchHHReadResourceListShape(t *testing.T) {
	c, _ := setup(t)
	var resources []readResource
	if err := json.Unmarshal(recoveredReadResources, &resources); err != nil {
		t.Fatal(err)
	}
	for _, item := range resources {
		status, body := c.request("GET", "/api/v1/"+item.Route+"?page=1&page_size=2", nil)
		if status != http.StatusOK || body["code"] != float64(0) {
			t.Fatalf("GET /%s = %d %v, want 200/0", item.Route, status, body)
		}
		data, ok := body["data"].(map[string]any)
		if !ok {
			t.Fatalf("GET /%s data 不是对象: %v", item.Route, body["data"])
		}
		if _, ok = data["list"]; !ok {
			t.Fatalf("GET /%s data 缺 list: %v", item.Route, data)
		}
		if _, ok = data["total"]; !ok {
			t.Fatalf("GET /%s data 缺 total: %v", item.Route, data)
		}
		if len(data) != 2 {
			t.Fatalf("GET /%s data 顶层字段应为 [list total]，实际 %v", item.Route, data)
		}
	}
}

// TestBatchHHDetailNotFoundContract 详情不存在的形态：逐条比对原版实测的
// HTTP 状态码、body.code 与逐字文案。
func TestBatchHHDetailNotFoundContract(t *testing.T) {
	c, _ := setup(t)
	var resources []readResource
	if err := json.Unmarshal(recoveredReadResources, &resources); err != nil {
		t.Fatal(err)
	}
	const zero = "00000000-0000-0000-0000-000000000000"
	for _, item := range resources {
		status, body := c.request("GET", "/api/v1/"+item.Route+"/"+zero, nil)
		if status != item.NotFoundHTTP {
			t.Fatalf("GET /%s/%s http = %d, want %d (body=%v)", item.Route, zero, status, item.NotFoundHTTP, body)
		}
		if body["code"] != float64(item.NotFoundCode) {
			t.Fatalf("GET /%s/%s code = %v, want %d", item.Route, zero, body["code"], item.NotFoundCode)
		}
		if body["message"] != item.NotFoundMessage {
			t.Fatalf("GET /%s/%s message = %v, want %q", item.Route, zero, body["message"], item.NotFoundMessage)
		}
	}
}

// TestBatchHHDetailSuccessPassThrough 成功路径必须原样透传：
// 详情改写层只在 404/500 且文案形如「…不存在」时介入，命中记录时不得改写。
func TestBatchHHDetailSuccessPassThrough(t *testing.T) {
	c, _ := setup(t)
	created := c.ok("POST", "/api/v1/toolings", map[string]any{
		"tooling_no": "HH-TL-1",
		"name":       "回归治具",
	}).(map[string]any)
	id, _ := created["id"].(string)
	if id == "" {
		t.Fatalf("创建工装未返回 id: %v", created)
	}
	status, body := c.request("GET", "/api/v1/toolings/"+id, nil)
	if status != http.StatusOK || body["code"] != float64(0) {
		t.Fatalf("GET /toolings/%s = %d %v, want 200/0", id, status, body)
	}
	data, ok := body["data"].(map[string]any)
	if !ok || data["id"] != id {
		t.Fatalf("GET /toolings/%s data = %v", id, body["data"])
	}
	// toolings 配置了 404「工装不存在」；命中记录时不得被改写。
	if body["message"] != "success" {
		t.Fatalf("GET /toolings/%s message = %v, want success", id, body["message"])
	}
}

// TestBatchHHDetailRouteAbsent 原版没有详情路由的 8 条资源：恢复端不得自动补出。
func TestBatchHHDetailRouteAbsent(t *testing.T) {
	c, _ := setup(t)
	absent := []string{
		"crm-activities",
		"bank/statements",
		"tax-accruals",
		"employee-changes",
		"sales-commissions/settlements",
		"equipment-maintenances",
		"work-order-processes",
		"notifications",
	}
	const zero = "00000000-0000-0000-0000-000000000000"
	for _, route := range absent {
		status, body := c.request("GET", "/api/v1/"+route+"/"+zero, nil)
		if status != http.StatusNotFound || body["message"] != "路由不存在" {
			t.Fatalf("GET /%s/%s = %d %v, want 404/路由不存在", route, zero, status, body)
		}
	}
}
