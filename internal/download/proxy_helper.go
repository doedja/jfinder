package download

import (
	"net/http"
	"net/url"
	"time"

	"github.com/doedja/jfinder/internal/proxy"
)

func buildClient(cfg *proxy.Config, timeout time.Duration) *http.Client {
	if cfg == nil {
		return &http.Client{Timeout: timeout}
	}
	proxyURL, err := url.Parse(cfg.HTTP)
	if err != nil {
		return &http.Client{Timeout: timeout}
	}
	return &http.Client{
		Timeout: timeout,
		Transport: &http.Transport{
			Proxy: http.ProxyURL(proxyURL),
		},
	}
}
