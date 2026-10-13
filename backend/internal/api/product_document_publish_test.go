package api

import (
	"context"
	"testing"
)

func TestProductDocumentPublishSupersedesEffectiveVersion(t *testing.T) {
	c, s := setup(t)
	products, err := s.Store.Rows(context.Background(), "SELECT id FROM products WHERE deleted_at IS NULL LIMIT 1")
	if err != nil || len(products) == 0 {
		t.Skip("no seeded product")
	}
	productID := products[0]["id"]
	one := c.ok("POST", "/api/v1/product-documents", map[string]any{"doc_no": "DOC-2099-01", "title": "第一版", "product_id": productID, "doc_type": "manual"}).(map[string]any)
	two := c.ok("POST", "/api/v1/product-documents", map[string]any{"doc_no": "DOC-2099-02", "title": "第二版", "product_id": productID, "doc_type": "manual"}).(map[string]any)
	c.ok("POST", "/api/v1/product-documents/"+one["id"].(string)+"/publish", map[string]any{})
	latest := c.ok("POST", "/api/v1/product-documents/"+two["id"].(string)+"/publish", map[string]any{}).(map[string]any)
	if latest["status"] != "effective" {
		t.Fatalf("latest not effective: %#v", latest)
	}
	rows, err := s.Store.Rows(context.Background(), "SELECT status FROM product_documents WHERE id=?", one["id"])
	if err != nil || len(rows) != 1 || rows[0]["status"] != "obsolete" {
		t.Fatalf("old version not obsolete: %#v %v", rows, err)
	}
}
