package util

import (
	"net/http"
	"strings"
	"sync"
	"time"
)

type Limited struct {
	Code       int
	RetryAfter int
	Message    string
}

type Limiter struct {
	mu       sync.Mutex
	requests map[string][]time.Time
	active   map[string]int
	ticker   *time.Ticker
	stopCh   chan struct{}
}

func NewLimiter() *Limiter {
	l := &Limiter{
		requests: make(map[string][]time.Time),
		active:   make(map[string]int),
		ticker:   time.NewTicker(5 * time.Minute),
		stopCh:   make(chan struct{}),
	}
	go l.cleanupLoop()
	return l
}

func (l *Limiter) Check(ip string) *Limited {
	l.mu.Lock()
	defer l.mu.Unlock()

	now := time.Now()
	windowStart := now.Add(-1 * time.Minute)

	// slide window
	timestamps := l.requests[ip]
	var kept []time.Time
	for _, t := range timestamps {
		if t.After(windowStart) {
			kept = append(kept, t)
		}
	}
	l.requests[ip] = kept

	if len(kept) >= 10 {
		return &Limited{
			Code:       429,
			RetryAfter: 60,
			Message:    "rate limit exceeded: max 10 requests per minute",
		}
	}

	if l.active[ip] >= 3 {
		return &Limited{
			Code:       429,
			RetryAfter: 60,
			Message:    "too many concurrent tasks: max 3 per IP",
		}
	}

	l.requests[ip] = append(l.requests[ip], now)
	l.active[ip]++
	return nil
}

func (l *Limiter) Release(ip string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.active[ip] > 0 {
		l.active[ip]--
	}
}

func (l *Limiter) cleanupLoop() {
	for {
		select {
		case <-l.ticker.C:
			l.mu.Lock()
			now := time.Now()
			cutoff := now.Add(-1 * time.Minute)
			for ip, tss := range l.requests {
				var kept []time.Time
				for _, t := range tss {
					if t.After(cutoff) {
						kept = append(kept, t)
					}
				}
				if len(kept) == 0 {
					delete(l.requests, ip)
				} else {
					l.requests[ip] = kept
				}
			}
			l.mu.Unlock()
		case <-l.stopCh:
			l.ticker.Stop()
			return
		}
	}
}

// ClientIP extracts a client IP from request headers.
func ClientIP(headers http.Header) string {
	if fwd := headers.Get("X-Forwarded-For"); fwd != "" {
		parts := strings.SplitN(fwd, ",", 2)
		if ip := strings.TrimSpace(parts[0]); ip != "" {
			return ip
		}
	}
	if real := headers.Get("X-Real-IP"); real != "" {
		return real
	}
	return "unknown"
}
