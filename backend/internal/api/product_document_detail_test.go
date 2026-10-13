package api

import (
	"context"
	"testing"
)

func TestProductDocumentDetailIncludesProduct(t *testing.T) {
	c, s := setup(t)
	products, err := s.Store.Rows(context.Background(), "SELECT id,name FROM products WHERE deleted_at IS NULL LIMIT 1")
	if err != nil || len(products) == 0 {
		t.Skip("no seeded product")
	}
	doc := c.ok("POST", "/api/v1/product-documents", map[string]any{"doc_no": "DOC-2099-03", "title": "关联商品文档", "product_id": products[0]["id"], "doc_type": "manual"}).(map[string]any)
	detail := c.ok("GET", "/api/v1/product-documents/"+doc["id"].(string), nil).(map[string]any)
	product := detail["edges"].(map[string]any)["product"].(map[string]any)
	if product["id"] != products[0]["id"] {
		t.Fatalf("unexpected product edge: %#v", detail)
	}
}
