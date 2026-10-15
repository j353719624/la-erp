package business

import (
	"context"
	"database/sql"
	"errors"
	"la-erp/backend/internal/database"
)

func (s *Service) PublishProductDocument(ctx context.Context, id string) (map[string]any, error) {
	var result map[string]any
	err := s.transaction(ctx, func(tx *sql.Tx) error {
		row, err := s.Store.GetWith(ctx, tx, "product_documents", id)
		if errors.Is(err, database.ErrNotFound) {
			return errors.New("产品文档不存在")
		}
		if err != nil {
			return err
		}
		if value(row, "status") == "effective" {
			return errors.New("产品文档已生效")
		}
		stamp := now()
		if _, err := tx.ExecContext(ctx, "UPDATE product_documents SET status='obsolete', updated_at=? WHERE deleted_at IS NULL AND status='effective' AND product_id=? AND doc_type=? AND id<>?", stamp, row["product_id"], row["doc_type"], id); err != nil {
			return err
		}
		if err := s.Store.UpdateWith(ctx, tx, "product_documents", id, map[string]any{"status": "effective", "effective_date": stamp, "updated_at": stamp}); err != nil {
			return err
		}
		result, err = s.Store.GetWith(ctx, tx, "product_documents", id)
		return err
	})
	if err != nil {
		return nil, err
	}
	return s.Store.Public("product_documents", result), nil
}
