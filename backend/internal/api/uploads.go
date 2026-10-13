package api

import (
	"errors"
	"fmt"
	"github.com/google/uuid"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
)

var imageTypes = map[string]string{".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".gif": "image/gif", ".webp": "image/webp", ".bmp": "image/bmp"}
var imageName = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|jpeg|png|gif|webp|bmp)$`)

func (s *Server) ConfigureUploads(directory string, maxMB int) error {
	if maxMB <= 0 || maxMB > 1024 {
		return errors.New("upload.max_size must be between 1 and 1024 MB")
	}
	absolute, err := filepath.Abs(directory)
	if err != nil {
		return err
	}
	if err = os.MkdirAll(filepath.Join(absolute, "images"), 0700); err != nil {
		return err
	}
	s.uploadDirectory = absolute
	s.uploadMaxBytes = int64(maxMB) * 1024 * 1024
	return nil
}
func (s *Server) registerUploads() {
	s.mux.Handle("POST /api/v1/upload/image", s.protected("*", http.HandlerFunc(s.uploadImage)))
	s.mux.HandleFunc("GET /uploads/", s.serveImage)
}
func (s *Server) uploadImage(w http.ResponseWriter, r *http.Request) {
	if s.uploadDirectory == "" {
		fail(w, 501, "图片存储目录尚未配置")
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, s.uploadMaxBytes+(2<<20))
	err := r.ParseMultipartForm(1 << 20)
	if r.MultipartForm != nil {
		defer r.MultipartForm.RemoveAll()
	}
	tooLarge := func() { fail(w, 400, fmt.Sprintf("图片大小不能超过 %dMB", s.uploadMaxBytes/(1024*1024))) }
	if err != nil {
		var limit *http.MaxBytesError
		if errors.As(err, &limit) {
			tooLarge()
		} else {
			fail(w, 400, "请选择要上传的图片")
		}
		return
	}
	file, header, err := r.FormFile("file")
	if err != nil {
		fail(w, 400, "请选择要上传的图片")
		return
	}
	defer file.Close()
	ext := strings.ToLower(filepath.Ext(header.Filename))
	if _, ok := imageTypes[ext]; !ok {
		fail(w, 400, "仅支持图片文件（jpg/jpeg/png/gif/webp/bmp）")
		return
	}
	if header.Size > s.uploadMaxBytes {
		tooLarge()
		return
	}
	name := uuid.NewString() + ext
	dest := filepath.Join(s.uploadDirectory, "images", name)
	target, err := os.OpenFile(dest, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil {
		fail(w, 500, "图片保存失败")
		return
	}
	_, copyErr := io.Copy(target, file)
	closeErr := target.Close()
	if copyErr != nil || closeErr != nil {
		os.Remove(dest)
		fail(w, 500, "图片保存失败")
		return
	}
	respond(w, 200, map[string]any{"url": "/uploads/images/" + name})
}
func (s *Server) serveImage(w http.ResponseWriter, r *http.Request) {
	name := strings.TrimPrefix(r.URL.Path, "/uploads/images/")
	missing := func() { fail(w, 404, "路由不存在") }
	if s.uploadDirectory == "" || !strings.HasPrefix(r.URL.Path, "/uploads/images/") || !imageName.MatchString(name) {
		missing()
		return
	}
	root, err := os.OpenRoot(filepath.Join(s.uploadDirectory, "images"))
	if err != nil {
		missing()
		return
	}
	defer root.Close()
	file, err := root.Open(name)
	if err != nil {
		missing()
		return
	}
	defer file.Close()
	stat, err := file.Stat()
	if err != nil || !stat.Mode().IsRegular() {
		missing()
		return
	}
	w.Header().Set("Content-Type", imageTypes[filepath.Ext(name)])
	http.ServeContent(w, r, name, stat.ModTime(), file)
}
