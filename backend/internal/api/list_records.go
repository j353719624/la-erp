package api

import (
	"fmt"
	"net/http"
)

func (s *Server) listRecord(r *http.Request, res Resource, row map[string]any) (map[string]any, error) {
	if res.Table == "work_orders" {
		return s.business().WorkOrderListRecord(r.Context(), row)
	}
	if res.Table == "mps_plans" {
		return s.business().GetMPS(r.Context(), fmt.Sprint(row["id"]))
	}
	if res.Table == "routings" {
		return s.business().GetRouting(r.Context(), fmt.Sprint(row["id"]))
	}
	pub := s.public(r, res, row)
	if res.Table == "serial_numbers" || res.Table == "rework_orders" {
		delete(pub, "edges")
	}
	if res.Table == "bo_ms" {
		edges := map[string]any{}
		lines, err := s.Store.Rows(r.Context(), "SELECT * FROM bom_items WHERE bom_id=? AND deleted_at IS NULL ORDER BY line_no", row["id"])
		if err != nil {
			return nil, err
		}
		if len(lines) > 0 {
			items := []map[string]any{}
			for _, line := range lines {
				items = append(items, s.Store.Public("bom_items", line))
			}
			edges["items"] = items
		}
		if id, ok := row["product_id"].(string); ok && id != "" {
			product, err := s.Store.Get(r.Context(), "products", id)
			if err != nil {
				return nil, err
			}
			edges["product"] = s.Store.Public("products", product)
		}
		pub["edges"] = edges
	}
	if res.Table == "purchase_orders" {
		edges := map[string]any{}
		lines, err := s.Store.Rows(r.Context(), "SELECT * FROM purchase_order_lines WHERE order_id=? AND deleted_at IS NULL ORDER BY line_no", row["id"])
		if err != nil {
			return nil, err
		}
		if len(lines) > 0 {
			items := []map[string]any{}
			for _, line := range lines {
				items = append(items, s.Store.Public("purchase_order_lines", line))
			}
			edges["lines"] = items
		}
		if id, ok := row["supplier_id"].(string); ok && id != "" {
			supplier, err := s.Store.Get(r.Context(), "suppliers", id)
			if err != nil {
				return nil, err
			}
			edges["supplier"] = s.Store.Public("suppliers", supplier)
		}
		pub["edges"] = edges
	}
	if res.Table == "products" {
		var quantity string
		if err := s.Store.DB.QueryRowContext(r.Context(), "SELECT CAST(COALESCE(SUM(qty_available),0) AS TEXT) FROM inventory_balances WHERE product_id=?", row["id"]).Scan(&quantity); err != nil {
			return nil, err
		}
		pub["stock_qty"] = quantity
	}
	if res.Table == "suppliers" {
		// Supplier list is a flattened DTO, whereas create/get use the ORM JSON.
		result := map[string]any{}
		for _, key := range []string{"id", "code", "name", "category_id", "contact", "phone", "email", "address", "tax_no", "bank_account", "payment_term", "rating", "status", "remark", "created_at", "updated_at", "ext"} {
			value, ok := pub[key]
			if !ok {
				if key == "category_id" || key == "ext" {
					value = nil
				} else {
					value = ""
				}
			}
			result[key] = value
		}
		result["category_name"] = ""
		if id, ok := row["category_id"].(string); ok {
			if category, err := s.Store.Get(r.Context(), "categories", id); err == nil {
				result["category_name"] = fmt.Sprint(category["name"])
			}
		}
		return result, nil
	}
	return pub, nil
}
