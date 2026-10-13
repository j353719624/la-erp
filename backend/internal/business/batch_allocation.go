package business

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"github.com/shopspring/decimal"
	"la-erp-recovered/backend/internal/database"
	"sort"
	"time"
)

// allocateTrackedBatch preserves the submitted outgoing cost, as observed
// in the original automatic allocation branch. The caller owns the transaction.
func (s *Service) allocateTrackedBatch(ctx context.Context, tx *sql.Tx, h, l map[string]any, d Document, user, strategy string) error {
	if strategy != "fifo" && strategy != "fefo" {
		return ErrUnsupported
	}
	rows, err := database.QueryRows(ctx, tx, "SELECT * FROM inventory_balances WHERE product_id=? AND warehouse_id=? AND batch_no IS NOT NULL AND batch_no<>''", l["product_id"], h["warehouse_id"])
	if err != nil {
		return err
	}
	sort.SliceStable(rows, func(i, j int) bool {
		key := func(r map[string]any) string {
			if strategy == "fefo" {
				if v := value(r, "expiry_date"); v != "" {
					return normalizedBatchDate(r["expiry_date"])
				}
				return "9999"
			}
			if v := value(r, "production_date"); v != "" {
				return normalizedBatchDate(r["production_date"])
			}
			return normalizedBatchDate(r["created_at"])
		}
		a, b := key(rows[i]), key(rows[j])
		if a == b {
			a, b = normalizedBatchDate(rows[i]["created_at"]), normalizedBatchDate(rows[j]["created_at"])
		}
		if a == b {
			return value(rows[i], "id") < value(rows[j], "id")
		}
		return a < b
	})
	remaining := readDecimal(l, "qty")
	available := decimal.Zero
	for _, r := range rows {
		available = available.Add(readDecimal(r, "qty_available"))
	}
	if available.LessThan(remaining) {
		return errors.New("库存不足")
	}
	cost := readDecimal(l, "unit_cost")
	for _, r := range rows {
		if remaining.IsZero() {
			break
		}
		q := readDecimal(r, "qty_available")
		if !q.IsPositive() {
			continue
		}
		take := decimal.Min(q, remaining)
		after := q.Sub(take)
		if err := s.Store.UpdateWith(ctx, tx, "inventory_balances", value(r, "id"), map[string]any{"qty_available": after.String(), "last_out_at": now(), "updated_at": now()}); err != nil {
			return err
		}
		m := s.base("stock_movements")
		m["type"], m["source_type"], m["source_id"], m["source_no"] = "out", h["type"], h["id"], h[d.Number]
		m["product_id"], m["warehouse_id"], m["batch_no"] = l["product_id"], h["warehouse_id"], r["batch_no"]
		m["qty"], m["direction"], m["unit_cost"], m["total_cost"], m["balance_after"], m["operator_id"] = take.String(), -1, cost.String(), take.Mul(cost).String(), after.String(), user
		if err := s.Store.InsertWith(ctx, tx, "stock_movements", m); err != nil {
			return err
		}
		remaining = remaining.Sub(take)
	}
	return nil
}

func normalizedBatchDate(raw any) string {
	if t, ok := raw.(time.Time); ok {
		return t.UTC().Format("2006-01-02T15:04:05.000000000Z")
	}
	v := fmt.Sprint(raw)
	for _, layout := range []string{time.RFC3339Nano, "2006-01-02 15:04:05.999999999-07:00", "2006-01-02 15:04:05.999999999"} {
		if t, err := time.Parse(layout, v); err == nil {
			return t.UTC().Format("2006-01-02T15:04:05.000000000Z")
		}
	}
	return v
}
