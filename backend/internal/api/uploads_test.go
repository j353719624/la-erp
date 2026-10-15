package api

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/textproto"
	"reflect"
	"strings"
	"testing"
)

func TestOriginalImageUploadReplay(t *testing.T) {
	c, s := setup(t)
	if err := s.ConfigureUploads(t.TempDir(), 10); err != nil {
		t.Fatal(err)
	}
	raw, err := readEvidenceSnapshot(t, "backend-runtime/upload-flow-contracts.json")
	if err != nil {
		t.Fatal(err)
	}
	var cases []map[string]any
	if err = json.Unmarshal(raw, &cases); err != nil {
		t.Fatal(err)
	}
	ids, codes := map[string]string{}, map[string]string{}
	for _, table := range []string{"products", "warehouses"} {
		rows, err := s.Store.Rows(context.Background(), "SELECT id,code FROM "+table+" WHERE deleted_at IS NULL")
		if err != nil {
			t.Fatal(err)
		}
		for _, row := range rows {
			codes[fmt.Sprint(row["code"])] = fmt.Sprint(row["id"])
		}
	}
	var masters func(any)
	masters = func(v any) {
		switch x := v.(type) {
		case map[string]any:
			if id, ok := x["id"].(string); ok {
				if target := codes[fmt.Sprint(x["code"])]; target != "" {
					ids[id] = target
				}
			}
			for _, v := range x {
				masters(v)
			}
		case []any:
			for _, v := range x {
				masters(v)
			}
		}
	}
	for _, item := range cases {
		masters(item["body"])
	}
	replace := func(text string) string {
		for from, to := range ids {
			text = strings.ReplaceAll(text, from, to)
		}
		return text
	}
	for i, item := range cases {
		endpoint := replace(item["endpoint"].(string))
		method := item["method"].(string)
		contentType := "application/json"
		var payload bytes.Buffer
		if input, ok := item["request_body"].(map[string]any); ok {
			if f, ok := input["$multipart"].(map[string]any); ok {
				writer := multipart.NewWriter(&payload)
				if filename, ok := f["filename"].(string); ok {
					field, _ := f["field"].(string)
					if field == "" {
						field = "file"
					}
					mime, _ := f["mime"].(string)
					if mime == "" {
						mime = "application/octet-stream"
					}
					header := textproto.MIMEHeader{}
					header.Set("Content-Disposition", fmt.Sprintf("form-data; name=%q; filename=%q", field, filename))
					header.Set("Content-Type", mime)
					part, err := writer.CreatePart(header)
					if err != nil {
						t.Fatal(err)
					}
					encoded, _ := f["base64"].(string)
					data, err := base64.StdEncoding.DecodeString(encoded)
					if err != nil {
						t.Fatal(err)
					}
					if size, ok := f["size_bytes"].(float64); ok {
						padded := make([]byte, int(size))
						copy(padded, data)
						data = padded
					}
					if _, err = part.Write(data); err != nil {
						t.Fatal(err)
					}
				}
				if err = writer.Close(); err != nil {
					t.Fatal(err)
				}
				contentType = writer.FormDataContentType()
			} else {
				encoded, _ := json.Marshal(input)
				payload.WriteString(replace(string(encoded)))
			}
		}
		req, err := http.NewRequest(method, c.server.URL+endpoint, &payload)
		if err != nil {
			t.Fatal(err)
		}
		req.Header.Set("Content-Type", contentType)
		if item["authenticated"] != false {
			req.Header.Set("Authorization", "Bearer "+c.token)
		}
		res, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		body, err := io.ReadAll(res.Body)
		res.Body.Close()
		if err != nil {
			t.Fatal(err)
		}
		if res.StatusCode != int(item["status"].(float64)) {
			t.Fatalf("upload case %d %s expected status %v got %d: %s", i, endpoint, item["status"], res.StatusCode, body)
		}
		expected := item["body"].(map[string]any)
		if strings.HasPrefix(res.Header.Get("Content-Type"), "image/") {
			hash := sha256.Sum256(body)
			actual := map[string]any{"byte_length": float64(len(body)), "sha256": hex.EncodeToString(hash[:]), "content_type": res.Header.Get("Content-Type")}
			if !reflect.DeepEqual(expected, actual) {
				t.Fatalf("image case %d expected=%v actual=%v", i, expected, actual)
			}
			continue
		}
		var actual map[string]any
		if err = json.Unmarshal(body, &actual); err != nil {
			t.Fatal(err)
		}
		if actual["code"] != expected["code"] {
			t.Fatalf("upload case %d expected=%v actual=%v", i, expected, actual)
		}
		if e, ok := expected["data"].(map[string]any); ok {
			a, ok := actual["data"].(map[string]any)
			if !ok {
				t.Fatalf("upload case %d missing data", i)
			}
			if url, ok := e["url"].(string); ok {
				target, _ := a["url"].(string)
				if !strings.HasPrefix(target, "/uploads/images/") || !imageName.MatchString(strings.TrimPrefix(target, "/uploads/images/")) {
					t.Fatalf("invalid uploaded URL %q", target)
				}
				ids[url] = target
			}
			if id, ok := e["id"].(string); ok {
				ids[id] = a["id"].(string)
			}
			if strings.HasPrefix(endpoint, "/api/v1/stock-ins/") && method == "GET" {
				ePhotos := e["edges"].(map[string]any)["photos"].([]any)
				aPhotos := a["edges"].(map[string]any)["photos"].([]any)
				if len(ePhotos) != len(aPhotos) {
					t.Fatal("uploaded photo count differs")
				}
				for j, v := range ePhotos {
					ep := v.(map[string]any)
					ap := aPhotos[j].(map[string]any)
					if ap["url"] != replace(ep["url"].(string)) || ap["remark"] != ep["remark"] {
						t.Fatal("uploaded photo linkage differs")
					}
				}
			}
		} else if e, ok := expected["data"].([]any); ok {
			a := actual["data"].([]any)
			if len(e) != len(a) {
				t.Fatal("photo creation count differs")
			}
			for j, v := range e {
				ep := v.(map[string]any)
				ap := a[j].(map[string]any)
				ids[ep["id"].(string)] = ap["id"].(string)
				if ap["url"] != replace(ep["url"].(string)) {
					t.Fatal("photo URL differs")
				}
			}
		}
	}
	t.Logf("replayed %d original upload and file retrieval requests", len(cases))
}
