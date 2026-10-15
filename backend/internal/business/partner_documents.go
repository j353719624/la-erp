package business

import "context"

// GetPartnerDocument returns the partner document with its active detail rows.
// This preserves the frontend's detail contract while action accounting is
// still being src from the original runtime.
func (s *Service) GetPartnerDocument(ctx context.Context, table, id string) (map[string]any, error) {
	h, err := s.Store.Get(ctx, table, id)
	if err != nil {
		return nil, err
	}
	lineTable, fk := "", ""
	if table == "loan_orders" {
		lineTable, fk = "loan_order_lines", "loan_order_id"
	}
	if table == "consignment_orders" {
		lineTable, fk = "consignment_order_lines", "order_id"
	}
	rows, err := s.Store.Rows(ctx, "SELECT * FROM "+lineTable+" WHERE "+fk+"=? AND deleted_at IS NULL ORDER BY line_no,id", id)
	if err != nil {
		return nil, err
	}
	lines := make([]map[string]any, 0, len(rows))
	for _, row := range rows {
		lines = append(lines, s.Store.Public(lineTable, row))
	}
	result := s.Store.Public(table, h)
	result["lines"] = lines
	return result, nil
}
