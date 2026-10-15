package business

import (
	"context"
	"database/sql"
	"errors"
	"github.com/shopspring/decimal"
	"la-erp/backend/internal/database"
)

func (s *Service) GetSuggestion(ctx context.Context, id string) (map[string]any, error) {
	header, err := s.Store.Get(ctx, "purchase_suggestions", id)
	if err != nil {
		if errors.Is(err, database.ErrNotFound) {
			return nil, errors.New("采购建议单不存在")
		}
		return nil, err
	}
	result := s.Store.Public("purchase_suggestions", header)
	lines, err := s.Store.Rows(ctx, "SELECT * FROM purchase_suggestion_lines WHERE suggestion_id=? AND deleted_at IS NULL ORDER BY created_at", id)
	if err != nil {
		return nil, err
	}
	if len(lines) > 0 {
		out := []map[string]any{}
		for _, line := range lines {
			product, err := s.Store.Get(ctx, "products", value(line, "product_id"))
			if err != nil {
				return nil, err
			}
			row := s.Store.Public("purchase_suggestion_lines", line)
			row["edges"] = map[string]any{"product": s.Store.Public("products", product)}
			out = append(out, row)
		}
		result["edges"] = map[string]any{"lines": out}
	}
	return result, nil
}

func (s *Service) DeleteSuggestion(ctx context.Context, id string) error {
	return s.transaction(ctx, func(tx *sql.Tx) error {
		var count int
		if err := tx.QueryRowContext(ctx, "SELECT count(*) FROM purchase_suggestions WHERE id=?", id).Scan(&count); err != nil {
			return err
		}
		if count == 0 {
			return database.ErrNotFound
		}
		_, err := tx.ExecContext(ctx, "UPDATE purchase_suggestions SET deleted_at=?,updated_at=? WHERE id=?", now(), now(), id)
		return err
	})
}

// Conversion is atomic: order, order lines and suggestion status commit together.
// The original endpoint ignores supplied supplier/warehouse input and produces
// an unassigned draft priced from the product's purchase_price reference.
func (s *Service) ConvertSuggestion(ctx context.Context, id string) (map[string]any, error) {
	var result map[string]any
	err := s.transaction(ctx, func(tx *sql.Tx) error {
		header, err := s.Store.GetWith(ctx, tx, "purchase_suggestions", id)
		if err != nil {
			if errors.Is(err, database.ErrNotFound) {
				return errors.New("采购建议单不存在")
			}
			return err
		}
		if value(header, "status") != "draft" {
			return errors.New("只有草稿状态的采购建议才能转为采购订单")
		}
		lines, err := database.QueryRows(ctx, tx, "SELECT * FROM purchase_suggestion_lines WHERE suggestion_id=? AND deleted_at IS NULL AND status='pending' ORDER BY product_code,created_at", id)
		if err != nil {
			return err
		}
		if len(lines) == 0 {
			return errors.New("采购建议单没有待转行")
		}
		prices := map[string]decimal.Decimal{}
		qty, amount := decimal.Zero, decimal.Zero
		for _, line := range lines {
			product, err := s.plainProduct(ctx, tx, value(line, "product_id"))
			if err != nil {
				return err
			}
			price := readDecimal(product, "purchase_price")
			if price.IsNegative() {
				// 批次 CC 取证（2026-10-14，evidence/backend-runtime/audit-batch-cc-20261014.json）：
				// 原版**允许**负 purchase_price：POST /products 传 purchase_price=-5
				// → code:0，回读 -5（落库）。
				// 但要把该商品送进采购建议需先让它产生 purchase 类 MRP 需求，
				// 批次 CC 用 safety_stock=999999 构造仍未能使其进入任何建议单
				//（原版 MRP 的采购需求覆盖范围与恢复端一致，均不含该商品）。
				// 即「负采购价商品出现在待转建议行里」这一状态在原版实践中**难以构造**，
				// 无原版文案可对齐 —— 保留 ErrUnsupported 作兜底，不自造中文。
				// 若将来找到可复现路径，应按原版行为改为放行（负价会拉低采购总额，
				// 但那属于业务决策而非数据缺陷）。
				return ErrUnsupported
			}
			prices[value(line, "id")] = price
			quantity := readDecimal(line, "suggested_qty")
			qty = qty.Add(quantity)
			amount = amount.Add(quantity.Mul(price))
		}
		order := s.base("purchase_orders")
		number, err := s.nextNumber(ctx, tx, "PO")
		if err != nil {
			return err
		}
		order["order_no"], order["status"], order["currency"], order["payment_status"] = number, "draft", "CNY", "unpaid"
		order["remark"] = "由采购建议单 " + value(header, "suggestion_no") + " 生成"
		order["total_qty"], order["total_amount"] = qty.String(), amount.String()
		if err = s.Store.InsertWith(ctx, tx, "purchase_orders", order); err != nil {
			return err
		}
		for index, line := range lines {
			row := s.base("purchase_order_lines")
			price := prices[value(line, "id")]
			row["price"], row["amount"] = price.String(), readDecimal(line, "suggested_qty").Mul(price).String()
			for k, v := range map[string]any{"order_id": order["id"], "line_no": index + 1, "product_id": line["product_id"], "product_code": line["product_code"], "product_name": line["product_name"], "qty": line["suggested_qty"], "is_gift": false} {
				row[k] = v
			}
			if err = s.Store.InsertWith(ctx, tx, "purchase_order_lines", row); err != nil {
				return err
			}
			if err = s.Store.UpdateWith(ctx, tx, "purchase_suggestion_lines", value(line, "id"), map[string]any{"status": "ordered", "updated_at": now()}); err != nil {
				return err
			}
		}
		if err = s.Store.UpdateWith(ctx, tx, "purchase_suggestions", id, map[string]any{"status": "ordered", "updated_at": now()}); err != nil {
			return err
		}
		result = s.Store.Public("purchase_orders", order)
		return nil
	})
	return result, err
}
