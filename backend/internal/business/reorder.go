package business

import (
	"context"
	"database/sql"
	"github.com/shopspring/decimal"
	"la-erp-recovered/backend/internal/database"
)

// The original ignores product_id and counts available stock separately from
// outstanding sales commitments, even when those commitments have locked stock.
func (s *Service) ReorderSuggestions(ctx context.Context) (any, error) {
	out := []map[string]any{}
	err := s.transaction(ctx, func(tx *sql.Tx) error {
		products, err := database.QueryRows(ctx, tx, "SELECT * FROM products WHERE deleted_at IS NULL AND safety_stock>0 ORDER BY code")
		if err != nil {
			return err
		}
		balances, err := database.QueryRows(ctx, tx, "SELECT product_id,qty_available FROM inventory_balances")
		if err != nil {
			return err
		}
		available := map[string]decimal.Decimal{}
		for _, b := range balances {
			id := value(b, "product_id")
			available[id] = available[id].Add(readDecimal(b, "qty_available"))
		}
		orders := map[string]map[string]decimal.Decimal{}
		for _, family := range []string{"sales", "purchase"} {
			rows, err := database.QueryRows(ctx, tx, "SELECT l.product_id,l.qty,l.delivered_qty FROM "+family+"_order_lines l JOIN "+family+"_orders o ON o.id=l.order_id WHERE l.deleted_at IS NULL AND o.deleted_at IS NULL AND o.status IN ('confirmed','approved')")
			if err != nil {
				return err
			}
			pending := map[string]decimal.Decimal{}
			for _, r := range rows {
				id := value(r, "product_id")
				pending[id] = pending[id].Add(readDecimal(r, "qty").Sub(readDecimal(r, "delivered_qty")))
			}
			orders[family] = pending
		}
		for _, p := range products {
			id := value(p, "id")
			safety := readDecimal(p, "safety_stock")
			a, on, committed := available[id], orders["purchase"][id], orders["sales"][id]
			suggested := safety.Add(committed).Sub(a).Sub(on)
			if !suggested.IsPositive() {
				continue
			}
			out = append(out, map[string]any{"product_id": id, "product_code": value(p, "code"), "product_name": value(p, "name"), "safety_stock": safety.String(), "available": a.String(), "on_order": on.String(), "committed": committed.String(), "suggested_qty": suggested.String()})
		}
		return nil
	})
	return out, err
}
