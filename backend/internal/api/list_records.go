package api

import (
	"fmt"
	"net/http"

	"github.com/shopspring/decimal"
	"la-erp/backend/internal/database"
)

// contractProgress 汇总一张合同关联订单的「已执行 / 已收款」金额。
//
// 回归回放 II/II2/II5（2026-10-14，运行快照,2,5}-20261014.json）
// 用受控数据逐个确定的口径：
//   - 关联订单 = 该表的 linkColumn 指向本合同、未软删、且 status != 'cancelled'
//     （II2-14：取消一张 50 元订单后 order_count 2→1、ordered_amount 150→100，
//     且该订单仍可查到、只是状态变 cancelled，故是显式过滤而非软删）
//   - 草稿与已确认订单**都计入**（II-4/II-8：草稿订单照计；II3-5：确认后照计）
//   - 金额为订单 total_amount 之和（II-6：100 + 50 = 150）
//   - 比率 = 金额 / 合同金额 × 100，DivRound(2)，合同金额为 0 时为 "0"
//     （II-4「33.33」、II-6「50」、II-8「83.33」；II2-2 零额合同为「0」）
//   - paid_amount：既有实现**没有任何订单收款路由**，101 张销售订单的 paid_amount 全为 0
//     （批次 BB 结论，business/service.go），故取关联订单 paid_amount 之和，恒为 0
func (s *Server) contractProgress(r *http.Request, table, linkColumn, contractID string) (int, decimal.Decimal, decimal.Decimal) {
	count := 0
	amount := decimal.Zero
	paid := decimal.Zero
	if contractID == "" {
		return count, amount, paid
	}
	rows, err := s.Store.Rows(r.Context(),
		"SELECT total_amount,paid_amount FROM "+database.Quote(table)+
			" WHERE "+database.Quote(linkColumn)+"=? AND deleted_at IS NULL AND (status IS NULL OR status != 'cancelled')",
		contractID)
	if err != nil {
		return count, amount, paid
	}
	for _, row := range rows {
		count++
		amount = amount.Add(decimalOf(row["total_amount"]))
		paid = paid.Add(decimalOf(row["paid_amount"]))
	}
	return count, amount, paid
}

// ratePercent 计算 amount / total × 100 并保留 2 位小数；total 为 0 时返回 "0"。
// 用 DivRound(2) + String()：实测 150/300 →「50」而非「50.00」，
// 100/300 →「33.33」，即尾随零不保留。
func ratePercent(amount, total decimal.Decimal) string {
	if !total.IsPositive() {
		return "0"
	}
	return amount.Mul(decimal.NewFromInt(100)).DivRound(total, 2).String()
}

func decimalOf(value any) decimal.Decimal {
	result, err := decimal.NewFromString(fmt.Sprint(value))
	if err != nil {
		return decimal.Zero
	}
	return result
}

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
	// 回归回放 II（运行快照）：
	// 商品款列表返回 sku_count，= 该款下未软删的 SKU 商品数
	// （II-18 新建款为 0；II-19 生成 2×2=4 个 SKU 后 II-20 读到 4）。
	if res.Table == "product_spus" {
		var count int
		if err := s.Store.DB.QueryRowContext(r.Context(), "SELECT COUNT(*) FROM products WHERE spu_id=? AND deleted_at IS NULL", row["id"]).Scan(&count); err != nil {
			return nil, err
		}
		pub["sku_count"] = count
	}
	// 销售合同执行进度（仅列表侧，既有实现详情不含这几个字段）
	if res.Table == "sales_contracts" {
		count, ordered, paid := s.contractProgress(r, "sales_orders", "sales_contract_id", fmt.Sprint(row["id"]))
		total := decimalOf(row["total_amount"])
		pub["order_count"] = count
		pub["ordered_amount"] = ordered.String()
		pub["paid_amount"] = paid.String()
		pub["progress_rate"] = ratePercent(ordered, total)
		pub["receipt_rate"] = ratePercent(paid, total)
	}
	// 采购合同执行进度（同上，字段名按既有实现为 executed_amount / progress_rate）
	if res.Table == "purchase_contracts" {
		count, executed, _ := s.contractProgress(r, "purchase_orders", "contract_id", fmt.Sprint(row["id"]))
		total := decimalOf(row["total_amount"])
		pub["order_count"] = count
		pub["executed_amount"] = executed.String()
		pub["progress_rate"] = ratePercent(executed, total)
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
