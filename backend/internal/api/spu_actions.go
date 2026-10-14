package api

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"

	"github.com/google/uuid"
	"la-erp-recovered/backend/internal/database"
)

// spuDim 商品款(SPU)的规格维度（product_spus.dims 的 json 结构）。
type spuDim struct {
	Code   string   `json:"code"`
	Name   string   `json:"name"`
	Values []string `json:"values"`
}

func (s *Server) registerSpuActions() {
	// POST /api/v1/spus/{id}/skus —— 按 维度1 × 维度2 × … 的笛卡尔积批量生成 SKU 商品。
	s.mux.Handle("POST /api/v1/spus/{id}/skus", s.protected("spu_generate_skus", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		spu, err := s.Store.Get(r.Context(), "product_spus", r.PathValue("id"))
		if err != nil {
			s.failure(w, err, "商品款")
			return
		}
		body, err := decode(w, r)
		if err != nil {
			fail(w, 400, err.Error())
			return
		}
		if body == nil {
			body = map[string]any{}
		}
		dims := spuDimsOf(spu)
		if len(dims) == 0 {
			fail(w, 400, "该商品款未配置规格维度，无法生成 SKU")
			return
		}
		combos := [][]string{{}}
		for _, dim := range dims {
			if len(dim.Values) == 0 {
				continue
			}
			next := make([][]string, 0, len(combos)*len(dim.Values))
			for _, prefix := range combos {
				for _, value := range dim.Values {
					next = append(next, append(append([]string{}, prefix...), value))
				}
			}
			combos = next
		}
		if len(combos) == 0 {
			fail(w, 400, "该商品款的规格维度没有可选值，无法生成 SKU")
			return
		}
		skipExisting := body["skip_existing"] == true || body["skip_existing"] == "true"
		now := database.Now()
		spuCode := text(spu, "code")
		spuName := text(spu, "name")
		tenant := database.ZeroUUID
		if v := text(spu, "tenant_id"); v != "" {
			tenant = v
		}
		createdCodes := []string{}
		createdRows := []map[string]any{}
		skipped := 0
		err = s.withTx(r, func(tx *sql.Tx) error {
			for index, combo := range combos {
				// 原版口径（回放 GG11 / MM-SPU2，2026-10-14）：
				//   code = 款号-两位流水（01 起，按笛卡尔积顺序）
				//   name = 款名（不拼维度值）
				//   spec = 维度值用 "/" 连接
				//   重复判定按规格组合，文案「规格组合已存在: 红/M（…）」
				code := fmt.Sprintf("%s-%02d", spuCode, index+1)
				spec := strings.Join(combo, "/")
				existing, err := database.QueryRows(r.Context(), tx,
					"SELECT id FROM products WHERE spu_id=? AND spec=? AND deleted_at IS NULL", text(spu, "id"), spec)
				if err != nil {
					return err
				}
				if len(existing) > 0 {
					if skipExisting {
						skipped++
						continue
					}
					return duplicateSKU{spec: spec}
				}
				row := map[string]any{
					"id":             uuid.NewString(),
					"created_at":     now,
					"updated_at":     now,
					"deleted_at":     nil,
					"code":           code,
					"status":         "active",
					"remark":         "",
					"tenant_id":      tenant,
					"created_by":     current(r).UserID,
					"name":           spuName,
					"spec":           spec,
					"product_type":   "goods",
					"is_batch":       false,
					"is_serial":      false,
					"safety_stock":   "0",
					"min_order_qty":  "0",
					"cost_method":    "weighted_avg",
					"is_combo":       false,
					"spu_id":         text(spu, "id"),
					"category_id":    spu["category_id"],
					"unit_id":        spu["unit_id"],
					"department_id":  spu["department_id"],
					"sale_price":     body["sale_price"],
					"purchase_price": body["purchase_price"],
				}
				if row["category_id"] == "" {
					row["category_id"] = nil
				}
				if row["unit_id"] == "" {
					row["unit_id"] = nil
				}
				if err := s.Store.InsertWith(r.Context(), tx, "products", row); err != nil {
					return err
				}
				createdCodes = append(createdCodes, code)
				createdRows = append(createdRows, s.Store.Public("products", row))
			}
			return nil
		})
		if err != nil {
			var dup duplicateSKU
			if errors.As(err, &dup) {
				verbatimFailure(w, verbatim{text: dup.Error()})
				return
			}
			s.failure(w, err, "商品")
			return
		}
		respond(w, 200, map[string]any{
			"created":  len(createdCodes),
			"skipped":  skipped,
			"codes":    createdCodes,
			"products": createdRows,
		})
	})))
}

// duplicateSKU 规格组合重复。文案逐字取自原版回放（2026-10-14，audit-batch-gg2）：
// HTTP 200 + code 10000「规格组合已存在: 红/M（如需补建请勾选跳过已存在）」。
type duplicateSKU struct{ spec string }

func (e duplicateSKU) Error() string { return "规格组合已存在: " + e.spec + "（如需补建请勾选跳过已存在）" }

// spuDimsOf 解析 product_spus.dims（json 列，可能是 string/[]byte/已解码值）。
func spuDimsOf(spu map[string]any) []spuDim {
	raw, ok := spu["dims"]
	if !ok || raw == nil {
		return nil
	}
	var encoded []byte
	switch value := raw.(type) {
	case string:
		encoded = []byte(value)
	case []byte:
		encoded = value
	default:
		encoded, _ = json.Marshal(raw)
	}
	var dims []spuDim
	if json.Unmarshal(encoded, &dims) != nil {
		return nil
	}
	return dims
}
