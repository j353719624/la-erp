package business

import (
	"context"
	"database/sql"
	"errors"
	"github.com/shopspring/decimal"
)

func (s *Service) CreatePerformanceTemplate(ctx context.Context, input map[string]any) (map[string]any, error) {
	var result map[string]any
	err := s.transaction(ctx, func(tx *sql.Tx) error {
		raw, ok := input["items"].([]any)
		if !ok || len(raw) == 0 {
			return errors.New("模板明细不能为空")
		}
		if value(input, "name") == "" {
			return errors.New("模板名称不能为空")
		}
		h := s.base("perf_templates")
		h["name"] = value(input, "name")
		if input["remark"] != nil {
			h["remark"] = input["remark"]
		}
		if err := s.Store.InsertWith(ctx, tx, "perf_templates", h); err != nil {
			return err
		}
		weights := decimal.Zero
		for _, v := range raw {
			m, ok := v.(map[string]any)
			if !ok || value(m, "indicator") == "" {
				return errors.New("模板明细格式错误")
			}
			weight, err := Number(m["weight"])
			if err != nil || !weight.IsPositive() {
				if err != nil {
					return err
				}
				return errors.New("权重必须大于零")
			}
			item := s.base("perf_template_items")
			item["indicator"], item["weight"], item["template_id"] = value(m, "indicator"), weight.String(), h["id"]
			if m["description"] != nil {
				item["description"] = m["description"]
			}
			if err := s.Store.InsertWith(ctx, tx, "perf_template_items", item); err != nil {
				return err
			}
			weights = weights.Add(weight)
		}
		if !weights.Equal(decimal.NewFromInt(100)) {
			return errors.New("模板权重合计必须等于 100")
		}
		result = s.Store.Public("perf_templates", h)
		return nil
	})
	return result, err
}
