// Standalone recovered source backend. It does not invoke the original binary.
package main

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"go.yaml.in/yaml/v3"
	"io"
	"la-erp-recovered/backend/internal/api"
	"la-erp-recovered/backend/internal/database"
	"la-erp-recovered/backend/license"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"time"
)

type configuration struct {
	Upload struct {
		Path    string `yaml:"path"`
		MaxSize int    `yaml:"max_size"`
	} `yaml:"upload"`
	Server struct {
		Port int    `yaml:"port"`
		Host string `yaml:"host"`
		Mode string `yaml:"mode"`
	} `yaml:"server"`
	Database struct {
		Driver string `yaml:"driver"`
		DSN    string `yaml:"dsn"`
	} `yaml:"database"`
	JWT struct {
		Secret     string `yaml:"secret"`
		AccessTTL  int    `yaml:"access_token_ttl"`
		RefreshTTL int    `yaml:"refresh_token_ttl"`
	} `yaml:"jwt"`
	License struct {
		Enabled   bool   `yaml:"enabled"`
		File      string `yaml:"file"`
		PublicKey string `yaml:"public_key"`
		TrialDays int    `yaml:"trial_days"`
	} `yaml:"license"`
}

func persistedSecret(filename string) (string, error) {
	raw, err := os.ReadFile(filename)
	if err == nil {
		value := strings.TrimSpace(string(raw))
		if len(value) < 32 {
			return "", errors.New("JWT secret file must contain at least 32 characters")
		}
		return value, nil
	}
	if !os.IsNotExist(err) {
		return "", err
	}
	if err = os.MkdirAll(filepath.Dir(filename), 0700); err != nil {
		return "", err
	}
	raw = make([]byte, 32)
	if _, err = rand.Read(raw); err != nil {
		return "", err
	}
	value := hex.EncodeToString(raw)
	f, err := os.OpenFile(filename, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil {
		return "", err
	}
	_, err = f.WriteString(value + "\n")
	closeErr := f.Close()
	if err != nil {
		return "", err
	}
	return value, closeErr
}
func run() error {
	configPath := flag.String("c", "", "原格式 YAML 配置文件（此版本仅支持 SQLite）")
	dbPath := flag.String("db", "", "独立测试数据库路径")
	listen := flag.String("listen", "", "监听地址，如 127.0.0.1:18887")
	dev := flag.Bool("dev", false, "明确使用开发模式（仅绑定回环地址，不进行授权校验）")
	publicPath := flag.String("public-key", "", "授权公钥文件（迁移密钥时指定）")
	licensePath := flag.String("license", "", "授权文件路径")
	adminPassword := flag.String("initial-admin-password", "", "空数据库初始管理员密码（默认与原程序相同）")
	flag.Parse()
	var cfg configuration
	cfg.Server.Port = 18887
	cfg.Server.Host = "127.0.0.1"
	cfg.Database.Driver = "sqlite"
	cfg.Database.DSN = "data/la-erp-recovered.db"
	cfg.JWT.AccessTTL = 7200
	cfg.JWT.RefreshTTL = 604800
	cfg.License.Enabled = true
	cfg.License.File = "data/license.key"
	cfg.Upload.MaxSize = 10
	if *configPath != "" {
		raw, err := os.ReadFile(*configPath)
		if err != nil {
			return err
		}
		if err = yaml.Unmarshal(raw, &cfg); err != nil {
			return err
		}
	}
	if *dbPath != "" {
		cfg.Database.DSN = *dbPath
	}
	if cfg.Database.Driver != "sqlite" {
		return errors.New("PostgreSQL backend recovery is not implemented yet")
	}
	if cfg.Server.Host == "" {
		cfg.Server.Host = "127.0.0.1"
	}
	addr := net.JoinHostPort(cfg.Server.Host, strconv.Itoa(cfg.Server.Port))
	if *listen != "" {
		addr = *listen
	}
	if *dev {
		host, _, err := net.SplitHostPort(addr)
		if err != nil {
			return err
		}
		if host != "localhost" && !net.ParseIP(host).IsLoopback() {
			return errors.New("development mode must bind to loopback")
		}
		cfg.License.Enabled = false
	}
	if *licensePath != "" {
		cfg.License.File = *licensePath
	}
	if *publicPath != "" {
		cfg.License.PublicKey = *publicPath
	}
	status := map[string]any{"enabled": cfg.License.Enabled, "status": "disabled", "machine_id": "", "remaining_days": 0, "expires_at": "", "trial_days": cfg.License.TrialDays, "message": "开发模式"}
	var activeLicense *license.File
	var activePublicKey, activeMachine string
	if cfg.License.Enabled {
		machine, err := license.MachineID("/")
		if err != nil {
			return err
		}
		raw, err := os.ReadFile(cfg.License.File)
		if err != nil {
			return fmt.Errorf("recovered server currently requires a valid license file; trial subsystem not yet restored: %w", err)
		}
		var record license.File
		if err = json.Unmarshal(raw, &record); err != nil {
			return err
		}
		pub := license.OriginalPublicKey
		if cfg.License.PublicKey != "" {
			raw, err = os.ReadFile(cfg.License.PublicKey)
			if err != nil {
				return err
			}
			pub = strings.TrimSpace(string(raw))
		}
		if err = license.Verify(record, pub, machine, "pro", time.Now()); err != nil {
			return err
		}
		activeLicense = &record
		activePublicKey = pub
		activeMachine = machine
		status["status"] = "licensed"
		status["machine_id"] = machine
		status["expires_at"] = record.ExpiresAt
		status["message"] = "授权校验通过"
	}
	// Apply a backup restore queued by the API before opening SQLite.
	if pending, readErr := os.ReadFile(cfg.Database.DSN + ".restore.pending"); readErr == nil {
		source := strings.TrimSpace(string(pending))
		if source != "" {
			if _, statErr := os.Stat(source); statErr != nil {
				return fmt.Errorf("restore source unavailable: %w", statErr)
			}
			backupOld := cfg.Database.DSN + ".before-restore-" + time.Now().Format("20060102-150405")
			if _, statErr := os.Stat(cfg.Database.DSN); statErr == nil {
				if err := os.Rename(cfg.Database.DSN, backupOld); err != nil {
					return err
				}
			}
			in, err := os.Open(source)
			if err != nil {
				return err
			}
			defer in.Close()
			out, err := os.Create(cfg.Database.DSN)
			if err != nil {
				return err
			}
			if _, err = io.Copy(out, in); err != nil {
				out.Close()
				return err
			}
			if err = out.Close(); err != nil {
				return err
			}
			if err = os.Remove(cfg.Database.DSN + ".restore.pending"); err != nil {
				return err
			}
		}
	}
	store, err := database.Open(cfg.Database.DSN)
	if err != nil {
		return err
	}
	defer store.Close()
	password := *adminPassword
	if password == "" {
		password = os.Getenv("ERP_ADMIN_PASSWORD")
	}
	if password == "" {
		// 保留原版默认口令（对齐原版，不自造），但**必须让运维看见风险**：
		// 部署时若忘记设置，管理员账号会是众所周知的弱口令。
		password = "admin123"
		log.Printf("警告：未通过 -initial-admin-password 或 ERP_ADMIN_PASSWORD 设置初始管理员口令，" +
			"已沿用原版默认口令。仅用于空数据库首次初始化，正式环境请立即登录修改。")
	}
	if err = store.Seed(context.Background(), password); err != nil {
		return err
	}
	secret := cfg.JWT.Secret
	if secret == "" {
		secret = os.Getenv("ERP_JWT_SECRET")
	}
	if secret == "" {
		secret, err = persistedSecret(cfg.Database.DSN + ".jwt.secret")
		if err != nil {
			return err
		}
	}
	if len(secret) < 32 {
		return errors.New("JWT secret must contain at least 32 characters")
	}
	app := api.New(store, secret)
	if cfg.Upload.Path == "" {
		cfg.Upload.Path = filepath.Join(filepath.Dir(cfg.Database.DSN), "uploads")
	}
	if err = app.ConfigureUploads(cfg.Upload.Path, cfg.Upload.MaxSize); err != nil {
		return err
	}
	// 导入导出文件与数据库同目录存放（data/exports）。
	if err = app.ConfigureExports(filepath.Join(filepath.Dir(cfg.Database.DSN), "exports")); err != nil {
		return err
	}
	// 机器码取原版算法（Linux 机器标识 sha256），激活器写授权文件并校验签名。
	app.ConfigureLicense(func() string {
		machine, err := license.MachineID("/")
		if err != nil || machine == "" {
			return ""
		}
		return machine
	}, func(name string, content []byte) (map[string]any, error) {
		var record license.File
		// 原版该路径的错误文案未取证，故不自造中文：直接回传解析器的原始错误。
		if err := json.Unmarshal(content, &record); err != nil {
			return nil, err
		}
		machine, err := license.MachineID("/")
		if err != nil {
			return nil, err
		}
		public := license.OriginalPublicKey
		if cfg.License.PublicKey != "" {
			raw, err := os.ReadFile(cfg.License.PublicKey)
			if err != nil {
				return nil, err
			}
			public = strings.TrimSpace(string(raw))
		}
		if err := license.Verify(record, public, machine, "pro", time.Now()); err != nil {
			return nil, err
		}
		target := cfg.License.File
		if err := os.MkdirAll(filepath.Dir(target), 0o700); err != nil {
			return nil, err
		}
		if err := os.WriteFile(target, content, 0o600); err != nil {
			return nil, err
		}
		return map[string]any{"activated": true, "file": target, "message": "授权已激活"}, nil
	})
	if cfg.JWT.AccessTTL > 0 {
		app.Auth.AccessTTL = time.Duration(cfg.JWT.AccessTTL) * time.Second
	}
	if cfg.JWT.RefreshTTL > 0 {
		app.Auth.RefreshTTL = time.Duration(cfg.JWT.RefreshTTL) * time.Second
	}
	initialStatus := status
	handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		status := map[string]any{}
		for k, v := range initialStatus {
			status[k] = v
		}
		if activeLicense != nil {
			if err := license.Verify(*activeLicense, activePublicKey, activeMachine, "pro", time.Now()); err != nil {
				if r.URL.Path != "/api/v1/license/status" && r.URL.Path != "/health" {
					w.Header().Set("Content-Type", "application/json; charset=utf-8")
					w.WriteHeader(http.StatusForbidden)
					json.NewEncoder(w).Encode(map[string]any{"code": 403, "message": "授权已失效", "data": nil})
					return
				}
				status["status"] = "expired"
				status["message"] = "授权已失效"
			}
		}
		if r.Method == "GET" && r.URL.Path == "/api/v1/license/status" {
			w.Header().Set("Content-Type", "application/json; charset=utf-8")
			json.NewEncoder(w).Encode(map[string]any{"code": 0, "message": "success", "data": status})
			return
		}
		app.ServeHTTP(w, r)
	})
	server := &http.Server{Addr: addr, Handler: handler, ReadHeaderTimeout: 10 * time.Second, ReadTimeout: 30 * time.Second, WriteTimeout: 30 * time.Second, IdleTimeout: 90 * time.Second}
	stop := make(chan os.Signal, 1)
	signal.Notify(stop, os.Interrupt, syscall.SIGTERM)
	defer signal.Stop(stop)
	go func() {
		<-stop
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		server.Shutdown(ctx)
	}()
	log.Printf("Recovered source backend listening on %s; SQLite=%s; unrecovered operations return 501", addr, cfg.Database.DSN)
	err = server.ListenAndServe()
	if errors.Is(err, http.ErrServerClosed) {
		return nil
	}
	return err
}
func main() {
	if err := run(); err != nil {
		log.Fatal(err)
	}
}
