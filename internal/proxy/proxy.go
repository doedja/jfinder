package proxy

import (
	"context"
	"fmt"
	"io"
	"math/rand/v2"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/doedja/jfinder/internal/config"
)

type Config struct {
	HTTP  string
	HTTPS string
}

type Service struct {
	mu          sync.Mutex
	proxies     []*Config
	lastRefresh time.Time
	cfg         *config.Config
}

func NewService(cfg *config.Config) *Service {
	return &Service{cfg: cfg}
}

func (s *Service) RefreshList(ctx context.Context) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	if s.cfg.ProxyURL == "" {
		s.proxies = nil
		return nil
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, s.cfg.ProxyURL, nil)
	if err != nil {
		return err
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return err
	}
	lines := strings.Split(string(body), "\n")
	var proxies []*Config
	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		parts := strings.Split(line, ":")
		if len(parts) != 4 {
			continue
		}
		ip, port, user, pass := parts[0], parts[1], parts[2], parts[3]
		proxyURL := fmt.Sprintf("http://%s:%s@%s:%s", user, pass, ip, port)
		u, err := url.Parse(proxyURL)
		if err != nil {
			continue
		}
		proxies = append(proxies, &Config{HTTP: u.String(), HTTPS: u.String()})
	}
	s.proxies = proxies
	s.lastRefresh = time.Now()
	return nil
}

func (s *Service) GetRandom(ctx context.Context) *Config {
	s.mu.Lock()
	if time.Since(s.lastRefresh) >= 5*time.Minute {
		s.mu.Unlock()
		s.RefreshList(ctx)
		s.mu.Lock()
	}
	if len(s.proxies) == 0 {
		s.mu.Unlock()
		return nil
	}
	cfg := s.proxies[rand.IntN(len(s.proxies))]
	s.mu.Unlock()
	return cfg
}
