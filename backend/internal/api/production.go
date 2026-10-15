package api

import (
	"errors"
	"la-erp/backend/internal/business"
	"net/http"
)

func (s *Server) workReports(w http.ResponseWriter, r *http.Request, mode string) {
	data, err := s.business().WorkReports(r.Context(), r.URL.Query(), mode)
	if err != nil {
		businessFailure(w, err, false)
		return
	}
	respond(w, 200, data)
}
func (s *Server) registerProduction() {
	s.mux.Handle("POST /api/v1/work-order-processes/bulk-report", s.protected("*", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		input, err := decode(w, r)
		if err != nil {
			fail(w, 400, err.Error())
			return
		}
		raw, ok := input["items"].([]any)
		if !ok || len(raw) == 0 {
			fail(w, 400, "报工明细不能为空")
			return
		}
		results := make([]map[string]any, 0, len(raw))
		for _, item := range raw {
			line, ok := item.(map[string]any)
			if !ok {
				fail(w, 400, "报工明细格式错误")
				return
			}
			id, _ := line["id"].(string)
			if id == "" {
				fail(w, 400, "报工工序不能为空")
				return
			}
			data, err := s.business().WorkProcessAction(r.Context(), id, "complete", line)
			if err != nil {
				businessFailure(w, err, false)
				return
			}
			results = append(results, data)
		}
		respond(w, 200, map[string]any{"items": results, "count": len(results)})
	})))
	s.mux.Handle("GET /api/v1/production-settings", s.protected("*", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		data, err := s.business().ProductionSettings(r.Context())
		if err != nil {
			businessFailure(w, err, false)
			return
		}
		respond(w, 200, data)
	})))
	s.mux.Handle("PUT /api/v1/production-settings", s.protected("*", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		input, err := decode(w, r)
		if err != nil {
			fail(w, 400, err.Error())
			return
		}
		data, err := s.business().SaveProductionSettings(r.Context(), input)
		if err != nil {
			businessFailure(w, err, false)
			return
		}
		respond(w, 200, data)
	})))
	s.mux.Handle("GET /api/v1/work-centers/load", s.protected("*", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		data, err := s.business().CapacityLoad(r.Context(), r.URL.Query().Get("days"))
		if err != nil {
			businessFailure(w, err, false)
			return
		}
		respond(w, 200, data)
	})))
	for _, mode := range []string{"pending", "stats"} {
		s.mux.Handle("GET /api/v1/work-order-processes/"+mode, s.protected("*", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { s.workReports(w, r, mode) })))
	}

	for _, action := range []string{"start", "complete", "revert"} {
		s.mux.Handle("POST /api/v1/work-order-processes/{id}/"+action, s.protected("*", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			input, err := decode(w, r)
			if err != nil {
				fail(w, 400, err.Error())
				return
			}
			data, err := s.business().WorkProcessAction(r.Context(), r.PathValue("id"), action, input)
			if err != nil {
				businessFailure(w, err, false)
				return
			}
			respond(w, 200, data)
		})))
	}

	for _, route := range []string{"work-centers", "routings"} {
		s.mux.Handle("DELETE /api/v1/"+route+"/{id}", s.protected("*", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			table := "routings"
			if route == "work-centers" {
				table = "work_centers"
			}
			if err := s.business().DeleteProductionMaster(r.Context(), table, r.PathValue("id")); err != nil {
				businessFailure(w, err, false)
				return
			}
			respond(w, 200, nil)
		})))
		for _, method := range []string{"POST", "PUT"} {
			path := "/api/v1/" + route
			if method == "PUT" {
				path += "/{id}"
			}
			s.mux.Handle(method+" "+path, s.protected("*", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				input, err := decode(w, r)
				if err != nil {
					fail(w, 400, err.Error())
					return
				}
				var data map[string]any
				if route == "work-centers" {
					data, err = s.business().WriteWorkCenter(r.Context(), r.PathValue("id"), input)
				} else {
					data, err = s.business().WriteRouting(r.Context(), r.PathValue("id"), input)
				}
				if err != nil {
					businessFailure(w, err, false)
					return
				}
				if route == "routings" && method == "PUT" {
					respond(w, 200, nil)
				} else {
					respond(w, 200, data)
				}
			})))
		}
	}
	for route, d := range business.ProductionDocuments {
		s.mux.Handle("DELETE /api/v1/"+route+"/{id}", s.protected("*", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if err := s.business().DeleteProductionDocument(r.Context(), d, r.PathValue("id")); err != nil {
				businessFailure(w, err, false)
				return
			}
			respond(w, 200, nil)
		})))
		if d.Kind == "return" {
			s.mux.Handle("POST /api/v1/"+route+"/{id}/cancel", s.protected("*", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				data, err := s.business().CancelProductionReturn(r.Context(), d, r.PathValue("id"))
				if err != nil {
					businessFailure(w, err, false)
					return
				}
				respond(w, 200, data)
			})))
		}
		s.mux.Handle("POST /api/v1/"+route, s.protected("*", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			input, err := decode(w, r)
			if err == nil {
				err = business.ValidFinanceDates(input, d.Date)
			}
			if err != nil {
				fail(w, 400, err.Error())
				return
			}
			data, err := s.business().CreateProductionDocument(r.Context(), d, input, current(r).UserID)
			if err != nil {
				businessFailure(w, err, false)
				return
			}
			respond(w, 200, data)
		})))
		s.mux.Handle("POST /api/v1/"+route+"/{id}/confirm", s.protected("*", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			data, err := s.business().ConfirmProductionDocument(r.Context(), d, r.PathValue("id"))
			if err != nil {
				businessFailure(w, err, false)
				return
			}
			respond(w, 200, data)
		})))
	}
	s.mux.Handle("DELETE /api/v1/work-orders/{id}", s.protected("*", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if err := s.business().DeleteWorkOrder(r.Context(), r.PathValue("id")); err != nil {
			businessFailure(w, err, false)
			return
		}
		respond(w, 200, nil)
	})))
	for _, route := range []string{"boms", "work-orders"} {
		for _, method := range []string{"POST", "PUT"} {
			path := "/api/v1/" + route
			if method == "PUT" {
				path += "/{id}"
			}
			s.mux.Handle(method+" "+path, s.protected("*", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				input, err := decode(w, r)
				if err == nil && route == "work-orders" {
					err = business.ValidFinanceDates(input, "planned_start_date", "planned_end_date")
				}
				if err != nil {
					fail(w, 400, err.Error())
					return
				}
				var data map[string]any
				if route == "boms" {
					data, err = s.business().WriteBOM(r.Context(), r.PathValue("id"), input)
				} else {
					data, err = s.business().WriteWorkOrder(r.Context(), r.PathValue("id"), current(r).UserID, input)
				}
				if err != nil {
					businessFailure(w, err, false)
					return
				}
				if method == "PUT" {
					respond(w, 200, nil)
				} else {
					respond(w, 200, data)
				}
			})))
		}
	}
	s.mux.Handle("DELETE /api/v1/boms/{id}", s.protected("*", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if err := s.business().DeleteBOM(r.Context(), r.PathValue("id")); err != nil {
			businessFailure(w, err, false)
			return
		}
		respond(w, 200, nil)
	})))
	s.mux.Handle("POST /api/v1/boms/{id}/activate", s.protected("*", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		data, err := s.business().ActivateBOM(r.Context(), r.PathValue("id"))
		if err != nil {
			if errors.Is(err, business.ErrBOMMissing) {
				businessFailure(w, err, false)
			} else {
				fail(w, 500, "系统内部错误，请稍后重试或联系管理员")
			}
			return
		}
		respond(w, 200, data)
	})))
	s.mux.Handle("POST /api/v1/boms/{id}/deactivate", s.protected("*", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		data, err := s.business().DeactivateBOM(r.Context(), r.PathValue("id"))
		if err != nil {
			if errors.Is(err, business.ErrBOMMissing) {
				businessFailure(w, err, false)
			} else {
				fail(w, 500, "系统内部错误，请稍后重试或联系管理员")
			}
			return
		}
		respond(w, 200, data)
	})))
	s.mux.Handle("GET /api/v1/boms/{id}/tree", s.protected("*", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		data, err := s.business().BOMTree(r.Context(), r.PathValue("id"))
		if err != nil {
			businessFailure(w, err, false)
			return
		}
		respond(w, 200, data)
	})))
	for _, action := range []string{"confirm", "approve", "cancel", "complete"} {
		s.mux.Handle("POST /api/v1/work-orders/{id}/"+action, s.protected("*", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			data, err := s.business().WorkOrderAction(r.Context(), r.PathValue("id"), current(r).UserID, action)
			if err != nil {
				businessFailure(w, err, false)
				return
			}
			respond(w, 200, data)
		})))
	}
	for _, mode := range []string{"bom-items", "material-availability", "materials"} {
		s.mux.Handle("GET /api/v1/work-orders/{id}/"+mode, s.protected("*", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			data, err := s.business().WorkOrderMaterials(r.Context(), r.PathValue("id"), mode)
			if err != nil {
				businessFailure(w, err, false)
				return
			}
			respond(w, 200, data)
		})))
	}
}
