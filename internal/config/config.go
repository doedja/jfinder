package config

import (
	"bufio"
	"errors"
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"
)

type Config struct {
	LLMAPIKey      string
	LLMModel       string
	LLMProvider    string
	ScopusAPIKey   string
	ScopusAPIURL   string
	ProxyURL       string
	AnnasAPIKey    string
	RapidAPIKey    string
	DownloadDir    string
	MaxUploadSize  int64
	TaskTTL        time.Duration
	Host           string
	Port           string
	UmamiWebsiteID string
	UmamiSrc       string
	BaseURL        string
	ContactEmail   string
}

func (c *Config) HasScopus() bool  { return c.ScopusAPIKey != "" }
func (c *Config) HasProxy() bool   { return c.ProxyURL != "" }
func (c *Config) HasAnnas() bool   { return c.AnnasAPIKey != "" || c.RapidAPIKey != "" }

func Load() (*Config, error) {
	env := make(map[string]string)
	f, err := os.Open(".env")
	if err == nil {
		defer f.Close()
		sc := bufio.NewScanner(f)
		for sc.Scan() {
			line := strings.TrimSpace(sc.Text())
			if line == "" || strings.HasPrefix(line, "#") {
				continue
			}
			eq := strings.IndexByte(line, '=')
			if eq == -1 {
				continue
			}
			key := strings.TrimSpace(line[:eq])
			val := strings.TrimSpace(line[eq+1:])
			if len(val) >= 2 && ((val[0] == '"' && val[len(val)-1] == '"') || (val[0] == '\'' && val[len(val)-1] == '\'')) {
				val = val[1 : len(val)-1]
			}
			if key != "" {
				env[key] = val
			}
		}
	}

	getEnv := func(key, def string) string {
		if v := os.Getenv(key); v != "" {
			return v
		}
		if v, ok := env[key]; ok {
			return v
		}
		return def
	}

	cfg := &Config{}
	cfg.LLMAPIKey = getEnv("LLM_API_KEY", "")
	if cfg.LLMAPIKey == "" {
		return nil, errors.New("LLM_API_KEY is required")
	}

	cfg.LLMProvider = getEnv("LLM_PROVIDER", "deepseek")
	allowedProviders := map[string]bool{"deepseek": true, "openrouter": true}
	if !allowedProviders[cfg.LLMProvider] {
		return nil, fmt.Errorf("invalid LLM_PROVIDER: %s (must be deepseek or openrouter)", cfg.LLMProvider)
	}

	defaultModel := "deepseek-chat"
	if cfg.LLMProvider == "openrouter" {
		defaultModel = "qwen/qwen-2.5-72b-instruct"
	}
	cfg.LLMModel = getEnv("LLM_MODEL", defaultModel)

	cfg.ScopusAPIKey = getEnv("SCOPUS_API_KEY", "")
	cfg.ScopusAPIURL = getEnv("SCOPUS_API_URL", "https://api.elsevier.com/content/search/scopus")
	cfg.ProxyURL = getEnv("PROXY_URL", "")
	cfg.AnnasAPIKey = getEnv("ANNAS_API_KEY", "")
	cfg.RapidAPIKey = getEnv("RAPIDAPI_KEY", "")
	cfg.DownloadDir = getEnv("DOWNLOAD_DIR", "./downloads")
	maxUploadStr := getEnv("MAX_UPLOAD_SIZE", "16777216")
	if mu, err := strconv.ParseInt(maxUploadStr, 10, 64); err == nil {
		cfg.MaxUploadSize = mu
	} else {
		cfg.MaxUploadSize = 16 * 1024 * 1024
	}
	taskTTLStr := getEnv("TASK_TTL", "1h")
	if d, err := time.ParseDuration(taskTTLStr); err == nil {
		cfg.TaskTTL = d
	} else {
		cfg.TaskTTL = time.Hour
	}
	cfg.Host = getEnv("HOST", "0.0.0.0")
	cfg.Port = getEnv("PORT", "3000")
	cfg.UmamiWebsiteID = getEnv("UMAMI_WEBSITE_ID", "")
	cfg.UmamiSrc = getEnv("UMAMI_SRC", "")
	cfg.BaseURL = getEnv("BASE_URL", "https://jfinder.doedja.com")
	cfg.ContactEmail = getEnv("CONTACT_EMAIL", "jfinder@doedja.com")

	return cfg, nil
}
