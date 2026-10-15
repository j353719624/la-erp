package api

import (
	"context"
	"encoding/json"
	"fmt"
	"reflect"
	"sort"
	"strings"
	"testing"
)

func TestOriginalSerialNumberReplay(t *testing.T) {
	c, s := setup(t)
	raw, err := readEvidenceSnapshot(t, "backend-runtime/serials/serial-number-contracts.json")
	if err != nil {
		t.Fatal(err)
	}
	var cases []map[string]any
	if err = json.Unmarshal(raw, &cases); err != nil {
		t.Fatal(err)
	}
	product := c.ok("POST", "/api/v1/products", map[string]any{"code": "REC-DUP-FIN", "name": "REC-DUP-FIN"}).(map[string]any)
	wh := c.ok("GET", "/api/v1/warehouses", nil).(map[string]any)["list"].([]any)[0].(map[string]any)
	original := cases[2]["request_body"].(map[string]any)
	ids := map[string]string{original["product_id"].(string): product["id"].(string), original["warehouse_id"].(string): wh["id"].(string)}
	var normalize func(any) any
	normalize = func(v any) any {
		switch x := v.(type) {
		case map[string]any:
			out := map[string]any{}
			for k, v := range x {
				if k == "id" || k == "created_at" || k == "updated_at" || k == "registered_at" || k == "out_at" {
					continue
				}
				out[k] = normalize(v)
			}
			return out
		case []any:
			out := []any{}
			for _, v := range x {
				out = append(out, normalize(v))
			}
			sort.SliceStable(out, func(i, j int) bool { return fmt.Sprint(out[i]) < fmt.Sprint(out[j]) })
			return out
		case string:
			if mapped, ok := ids[x]; ok {
				return mapped
			}
			return x
		}
		return v
	}
	for i, record := range cases[2:] {
		endpoint := record["endpoint"].(string)
		for old, id := range ids {
			endpoint = strings.ReplaceAll(endpoint, old, id)
		}
		var input any
		if record["request_body"] != nil {
			encoded, err := json.Marshal(record["request_body"])
			if err != nil {
				t.Fatal(err)
			}
			payload := string(encoded)
			for old, id := range ids {
				payload = strings.ReplaceAll(payload, old, id)
			}
			if err := json.Unmarshal([]byte(payload), &input); err != nil {
				t.Fatal(err)
			}
		}
		status, body := c.request(record["method"].(string), endpoint, input)
		if status != int(record["status"].(float64)) {
			t.Fatalf("case %d %s status %d: %v", i+2, endpoint, status, body)
		}
		expected := record["body"].(map[string]any)
		if strings.HasPrefix(endpoint, "/api/v1/serial-numbers?") && record["method"] == "GET" {
			actualData, _ := body["data"].(map[string]any)
			expectedData, _ := expected["data"].(map[string]any)
			if actualData != nil && expectedData != nil {
				a, _ := actualData["list"].([]any)
				e, _ := expectedData["list"].([]any)
				for _, old := range e {
					row := old.(map[string]any)
					for _, n := range a {
						current := n.(map[string]any)
						if row["serial_no"] == current["serial_no"] {
							ids[row["id"].(string)] = current["id"].(string)
						}
					}
				}
			}
		}
		if !reflect.DeepEqual(normalize(expected), normalize(body)) {
			t.Fatalf("case %d %s expected %v actual %v", i+2, endpoint, normalize(expected), normalize(body))
		}
	}
	var n int
	if err := s.Store.DB.QueryRow("SELECT count(*) FROM serial_numbers WHERE serial_no IN ('REC-SN-004','REC-SN-005','REC-SN-008')").Scan(&n); err != nil {
		t.Fatal(err)
	}
	if n != 0 {
		t.Fatal("failed registration left partial rows", n)
	}
}
func TestSerialRegistrationInsertFailureRollsBackBatch(t *testing.T) {
	_, s := setup(t)
	if _, err := s.Store.DB.Exec("CREATE TRIGGER fail_serial BEFORE INSERT ON serial_numbers WHEN NEW.serial_no='FAIL-B' BEGIN SELECT RAISE(ABORT,'injected serial failure'); END"); err != nil {
		t.Fatal(err)
	}
	if _, err := s.business().RegisterSerials(context.Background(), map[string]any{"serial_nos": []any{"FAIL-A", "FAIL-B"}}); err == nil {
		t.Fatal("insertion failure ignored")
	}
	var n int
	if err := s.Store.DB.QueryRow("SELECT count(*) FROM serial_numbers").Scan(&n); err != nil {
		t.Fatal(err)
	}
	if n != 0 {
		t.Fatal("partial serial registration", n)
	}
}
