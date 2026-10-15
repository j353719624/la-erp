package api

import "testing"

func zzMk(t *testing.T, s *Server, id, period, sd, ed string) {
	if _, err := s.Store.DB.Exec(
		`INSERT INTO accounting_periods (id,created_at,updated_at,period,start_date,end_date,status,tenant_id)
		 VALUES (?, datetime('now'), datetime('now'), ?, ?, ?, 'open', '00000000-0000-0000-0000-000000000000')`,
		id, period, sd, ed); err != nil {
		t.Fatal(err)
	}
}

// 隔离复现 zerovalue 的两条（避开 period 占用）
func TestZZProbeZerovalueIsolated(t *testing.T) {
	// 场景1：空库 + 缺日期 → 原版 200 success
	c1, _ := setup(t)
	s1, b1 := c1.request("POST", "/api/v1/accounting-periods", map[string]any{"period": "2300-09"})
	t.Logf("空库+缺日期          -> %d %v   (原版=200 success)", s1, b1["message"])

	// 场景2：有基准 + 缺日期 → 原版 200 重叠
	c2, s2 := setup(t)
	zzMk(t, s2, "11111111-0000-0000-0000-000000000001", "2300-01",
		"2300-01-01 00:00:00+08:00", "2300-01-31 00:00:00+08:00")
	s2b, b2 := c2.request("POST", "/api/v1/accounting-periods", map[string]any{"period": "2300-09"})
	t.Logf("有基准+缺日期        -> %d %v   (原版=200 重叠)", s2b, b2["message"])

	// 场景3：有基准 + 显式零值 → 原版 200 success
	c3, s3 := setup(t)
	zzMk(t, s3, "11111111-0000-0000-0000-000000000001", "2300-01",
		"2300-01-01 00:00:00+08:00", "2300-01-31 00:00:00+08:00")
	s3b, b3 := c3.request("POST", "/api/v1/accounting-periods", map[string]any{
		"period": "2300-10", "start_date": "0001-01-01T00:00:00Z", "end_date": "0001-01-01T00:00:00Z"})
	t.Logf("有基准+显式零值      -> %d %v   (原版=200 success)", s3b, b3["message"])
}
