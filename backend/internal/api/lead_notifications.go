package api

import (
	"net/http"
	"strconv"
	"time"
)

// A direct recipient takes precedence over a role recipient. No caller may
// read or acknowledge another user's notification, including administrators.
const notificationScope = "deleted_at IS NULL AND (user_id=? OR (user_id IS NULL AND role_code IN (SELECT r.code FROM sys_roles r JOIN sys_user_roles ur ON ur.role_id=r.id WHERE ur.user_id=? AND r.deleted_at IS NULL)))"

func (s *Server) registerLeadNotificationActions() {
	s.mux.Handle("POST /api/v1/leads/{id}/convert", s.protected("crm", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		input, err := decode(w, r)
		if err != nil {
			fail(w, 400, err.Error())
			return
		}
		result, err := s.business().ConvertLead(r.Context(), r.PathValue("id"), input)
		if err != nil {
			businessFailure(w, err, false)
			return
		}
		respond(w, 200, result)
	})))
	s.mux.Handle("POST /api/v1/leads/{id}/status", s.protected("crm", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		status := r.URL.Query().Get("status")
		if status == "" {
			fail(w, 400, "缺少 status")
			return
		}
		allowedStatus := map[string]bool{"new": true, "contacted": true, "qualified": true, "converted": true, "lost": true}
		if !allowedStatus[status] {
			fail(w, 400, "无效的线索状态")
			return
		}
		id := r.PathValue("id")
		if _, err := s.Store.Get(r.Context(), "leads", id); err != nil {
			businessFailure(w, err, false)
			return
		}
		if err := s.Store.Update(r.Context(), "leads", id, map[string]any{"status": status, "updated_at": time.Now()}); err != nil {
			businessFailure(w, err, false)
			return
		}
		row, err := s.Store.Get(r.Context(), "leads", id)
		if err != nil {
			businessFailure(w, err, false)
			return
		}
		respond(w, 200, s.public(r, Resource{Table: "leads"}, row))
	})))
	s.mux.Handle("GET /api/v1/notifications", s.authenticated(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		uid := current(r).UserID
		where := notificationScope
		if r.URL.Query().Get("unread_only") == "true" {
			where += " AND is_read=0"
		}
		var total int
		if err := s.Store.DB.QueryRowContext(r.Context(), "SELECT COUNT(*) FROM notifications WHERE "+where, uid, uid).Scan(&total); err != nil {
			businessFailure(w, err, false)
			return
		}
		page, _ := strconv.Atoi(r.URL.Query().Get("page"))
		if page < 1 {
			page = 1
		}
		size, _ := strconv.Atoi(r.URL.Query().Get("page_size"))
		if size < 1 {
			size = 20
		}
		if size > 200 {
			size = 200
		}
		rows, err := s.Store.Rows(r.Context(), "SELECT * FROM notifications WHERE "+where+" ORDER BY created_at DESC,id LIMIT ? OFFSET ?", uid, uid, size, (page-1)*size)
		if err != nil {
			businessFailure(w, err, false)
			return
		}
		items := []map[string]any{}
		for _, row := range rows {
			items = append(items, s.Store.Public("notifications", row))
		}
		respond(w, 200, map[string]any{"list": items, "total": total})
	})))
	s.mux.Handle("PUT /api/v1/notifications/{id}/read", s.authenticated(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		uid := current(r).UserID
		res, err := s.Store.DB.ExecContext(r.Context(), "UPDATE notifications SET is_read=1,read_at=?,updated_at=? WHERE id=? AND "+notificationScope, time.Now(), time.Now(), r.PathValue("id"), uid, uid)
		if err != nil {
			businessFailure(w, err, false)
			return
		}
		n, err := res.RowsAffected()
		if err != nil {
			businessFailure(w, err, false)
			return
		}
		if n == 0 {
			fail(w, 404, "通知不存在")
			return
		}
		respond(w, 200, map[string]any{"success": true})
	})))
	s.mux.Handle("GET /api/v1/notifications/unread-count", s.authenticated(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var n int
		uid := current(r).UserID
		err := s.Store.DB.QueryRowContext(r.Context(), "SELECT COUNT(*) FROM notifications WHERE "+notificationScope+" AND is_read=0", uid, uid).Scan(&n)
		if err != nil {
			businessFailure(w, err, false)
			return
		}
		respond(w, 200, map[string]any{"count": n})
	})))
	s.mux.Handle("PUT /api/v1/notifications/read-all", s.authenticated(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		uid := current(r).UserID
		res, err := s.Store.DB.ExecContext(r.Context(), "UPDATE notifications SET is_read=1,read_at=?,updated_at=? WHERE "+notificationScope+" AND is_read=0", time.Now(), time.Now(), uid, uid)
		if err != nil {
			businessFailure(w, err, false)
			return
		}
		n, _ := res.RowsAffected()
		respond(w, 200, map[string]any{"updated": n})
	})))
}
