package api

import "testing"

func TestNotificationRecipientIsolation(t *testing.T) {
	c, s := setup(t)
	var uid string
	if err := s.Store.DB.QueryRow("SELECT id FROM sys_users WHERE username='admin'").Scan(&uid); err != nil {
		t.Fatal(err)
	}
	for _, row := range []struct{ id, user string }{{"mine", uid}, {"other", "other-user"}} {
		if _, err := s.Store.DB.Exec("INSERT INTO notifications (id,created_at,updated_at,user_id,type,title,content,is_read) VALUES (?,datetime('now'),datetime('now'),?,'test','test','',0)", row.id, row.user); err != nil {
			t.Fatal(err)
		}
	}
	data := c.ok("GET", "/api/v1/notifications?unread_only=true", nil).(map[string]any)
	if data["total"] != float64(1) {
		t.Fatal(data)
	}
	if c.ok("GET", "/api/v1/notifications/unread-count", nil).(map[string]any)["count"] != float64(1) {
		t.Fatal("incorrect count")
	}
	if status, _ := c.request("PUT", "/api/v1/notifications/other/read", nil); status != 404 {
		t.Fatal(status)
	}
	if data := c.ok("PUT", "/api/v1/notifications/read-all", nil).(map[string]any); data["updated"] != float64(1) {
		t.Fatal(data)
	}
	var read int
	if err := s.Store.DB.QueryRow("SELECT is_read FROM notifications WHERE id='other'").Scan(&read); err != nil {
		t.Fatal(err)
	}
	if read != 0 {
		t.Fatal("another user's notification changed")
	}
	if c.ok("GET", "/api/v1/notifications?unread_only=true", nil).(map[string]any)["total"] != float64(0) {
		t.Fatal("read notification still returned")
	}
}
