package api

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
)

func (s *Server) registerSubcontracts() {
	for _, method := range []string{"POST", "PUT"} {
		path := "/api/v1/subcontract-orders"
		if method == "PUT" {
			path += "/{id}"
		}
		s.mux.Handle(method+" "+path, s.protected("*", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			input, err := decode(w, r)
			if err != nil {
				fail(w, 400, err.Error())
				return
			}
			data, err := s.business().WriteSubcontract(r.Context(), r.PathValue("id"), input)
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
	for _, action := range []string{"confirm", "complete", "cancel", "delete"} {
		path := "POST /api/v1/subcontract-orders/{id}/" + action
		if action == "delete" {
			path = "DELETE /api/v1/subcontract-orders/{id}"
		}
		s.mux.Handle(path, s.protected("*", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			data, err := s.business().SubcontractAction(r.Context(), r.PathValue("id"), action)
			if err != nil {
				businessFailure(w, err, false)
				return
			}
			respond(w, 200, data)
		})))
	}
}

func (s *Server) registerSubcontractReceive() {
	for _, action := range []string{"receive", "finish-receive"} {
		method := "POST /api/v1/subcontract-orders/{id}/" + action
		s.mux.Handle(method, s.protected("*", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			input, err := decode(w, r)
			if err != nil {
				fail(w, 400, err.Error())
				return
			}
			data, err := s.business().ReceiveSubcontract(r.Context(), r.PathValue("id"), input, action == "finish-receive")
			if err != nil {
				businessFailure(w, err, false)
				return
			}
			respond(w, 200, data)
		})))
	}
}

func decodeSubcontractLines(w http.ResponseWriter, r *http.Request) ([]map[string]any, error) {
	reader := http.MaxBytesReader(w, r.Body, 2<<20)
	decoder := json.NewDecoder(reader)
	decoder.UseNumber()
	var raw []map[string]any
	if err := decoder.Decode(&raw); err != nil || raw == nil {
		return nil, errors.New("请求参数错误：需要 JSON 数组")
	}
	var tail any
	if err := decoder.Decode(&tail); err != io.EOF {
		return nil, errors.New("请求参数错误：多余 JSON 数据")
	}
	return raw, nil
}

func (s *Server) registerSubcontractMaterials() {
	for _, action := range []string{"issue", "return-material"} {
		path := "POST /api/v1/subcontract-orders/{id}/" + action
		s.mux.Handle(path, s.protected("*", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			lines, err := decodeSubcontractLines(w, r)
			if err != nil {
				fail(w, 400, err.Error())
				return
			}
			data, err := s.business().SubcontractMaterials(r.Context(), r.PathValue("id"), lines, action == "return-material")
			if err != nil {
				businessFailure(w, err, false)
				return
			}
			respond(w, 200, data)
		})))
	}
}
