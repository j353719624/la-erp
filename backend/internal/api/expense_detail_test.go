package api

import (
	"context"
	"testing"
)

func TestExpenseClaimDetailIncludesLinesEdge(t *testing.T) {
	c, s := setup(t)
	rows, err := s.Store.Rows(context.Background(), "SELECT id FROM expense_claims WHERE deleted_at IS NULL LIMIT 1")
	if err != nil || len(rows) == 0 {
		t.Skip("fixture has no expense claim")
	}
	id := rows[0]["id"].(string)
	data := c.ok("GET", "/api/v1/expense-claims/"+id, nil).(map[string]any)
	if _, ok := data["edges"].(map[string]any)["lines"]; !ok {
		t.Fatalf("expense lines edge missing: %#v", data)
	}
}
