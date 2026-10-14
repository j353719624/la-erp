package api

import (
	"encoding/json"
	"net/http"
	"time"
)

// dashboardStreamInterval 看板 SSE 推送间隔（前端注释：「连接后立即收到一次，之后每 10s 刷新指标」）。
const dashboardStreamInterval = 10 * time.Second

// registerDashboardStream 老板看板实时推送。
//
// 前端 utils/sse.ts 用 fetch + ReadableStream 读取，按 `\n\n` 切事件、只解析 `data:` 行，
// 因此这里输出标准 SSE 帧：`data: {json}\n\n`，并立即 Flush（否则浏览器侧读不到增量）。
func (s *Server) registerDashboardStream() {
	s.mux.Handle("GET /api/v1/reports/dashboard/stream", s.authenticated(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		flusher, ok := w.(http.Flusher)
		if !ok {
			fail(w, 500, "当前连接不支持流式推送")
			return
		}
		w.Header().Set("Content-Type", "text/event-stream; charset=utf-8")
		w.Header().Set("Cache-Control", "no-cache")
		w.Header().Set("Connection", "keep-alive")
		w.Header().Set("X-Accel-Buffering", "no")
		w.WriteHeader(http.StatusOK)
		flusher.Flush()

		ctx := r.Context()
		ticker := time.NewTicker(dashboardStreamInterval)
		defer ticker.Stop()
		for {
			data, err := s.business().Dashboard(ctx)
			if err != nil {
				// 单次取数失败不中断流：跳过这一拍，等下一个周期重试
				// （连接由客户端的指数退避重连负责恢复）。
				_, _ = w.Write([]byte(": keep-alive\n\n"))
				flusher.Flush()
			} else if payload, err := json.Marshal(data); err == nil {
				_, _ = w.Write([]byte("data: "))
				_, _ = w.Write(payload)
				_, _ = w.Write([]byte("\n\n"))
				flusher.Flush()
			}
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
			}
		}
	})))
}
