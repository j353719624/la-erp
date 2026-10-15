package business

import (
	"context"
	"database/sql"
	"errors"
	"github.com/shopspring/decimal"
)

func (s *Service) CreatePerformanceAssessment(ctx context.Context, input map[string]any) (map[string]any, error) {
	var result map[string]any
	err := s.transaction(ctx, func(tx *sql.Tx) error {
		raw, ok := input["items"].([]any)
		if !ok || len(raw) == 0 {
			// 批次 PP（2026-10-15）：原版逐字为「考核指标不能为空（可选择模板或录入指标）」
			// （tools/replay-batch-pp-statemachine.js 的建单探针）。括号是原版原文，不得省略。
			return errors.New("考核指标不能为空（可选择模板或录入指标）")
		}
		if value(input, "employee_name") == "" || value(input, "period") == "" {
			return errors.New("员工和期间不能为空")
		}
		h := s.base("perf_assessments")
		no, err := s.nextNumber(ctx, tx, "PF")
		if err != nil {
			return err
		}
		h["code"], h["employee_name"], h["period"], h["status"], h["total_score"] = no, value(input, "employee_name"), value(input, "period"), "draft", "0"
		for _, key := range []string{"employee_id", "department", "template_id", "template_name", "remark"} {
			if input[key] != nil {
				h[key] = input[key]
			}
		}
		if err := s.Store.InsertWith(ctx, tx, "perf_assessments", h); err != nil {
			return err
		}
		weighted, weights := decimal.Zero, decimal.Zero
		for _, v := range raw {
			m, ok := v.(map[string]any)
			// 批次 PP（2026-10-15）：原版缺 indicator（指标名称）时的逐字文案是
			// 「指标名称不能为空」，不是恢复端原先的「绩效明细格式错误」
			// （tools/replay-batch-pp-statemachine.js 的建单探针）。
			if !ok || value(m, "indicator") == "" {
				return errors.New("指标名称不能为空")
			}
			weight, err := Number(m["weight"])
			if err != nil || !weight.IsPositive() {
				if err != nil {
					return err
				}
				return errors.New("权重必须大于零")
			}
			score, err := Number(m["score"])
			if err != nil || score.IsNegative() || score.GreaterThan(decimal.NewFromInt(100)) {
				if err != nil {
					return err
				}
				return errors.New("分数必须在 0 到 100 之间")
			}
			item := s.base("perf_assessment_items")
			item["indicator"], item["weight"], item["score"], item["assessment_id"] = value(m, "indicator"), weight.String(), score.String(), h["id"]
			if m["remark"] != nil {
				item["remark"] = m["remark"]
			}
			if err := s.Store.InsertWith(ctx, tx, "perf_assessment_items", item); err != nil {
				return err
			}
			weights = weights.Add(weight)
			weighted = weighted.Add(weight.Mul(score))
		}
		if !weights.Equal(decimal.NewFromInt(100)) {
			return errors.New("绩效权重合计必须等于 100")
		}
		total := weighted.Div(decimal.NewFromInt(100))
		h["total_score"] = total.String()
		if err := s.Store.UpdateWith(ctx, tx, "perf_assessments", h["id"].(string), map[string]any{"total_score": total.String(), "updated_at": now()}); err != nil {
			return err
		}
		result = s.Store.Public("perf_assessments", h)
		return nil
	})
	return result, err
}
