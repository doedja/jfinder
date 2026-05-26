package llm

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/doedja/jfinder/internal/config"
	"github.com/doedja/jfinder/internal/util"
)

type Message struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type chatRequest struct {
	Model       string    `json:"model"`
	Messages    []Message `json:"messages"`
	Temperature float64   `json:"temperature"`
	Stream      bool      `json:"stream"`
}

type chatResponse struct {
	Choices []struct {
		Message Message `json:"message"`
	} `json:"choices"`
	Usage struct {
		PromptTokens          int `json:"prompt_tokens"`
		CompletionTokens      int `json:"completion_tokens"`
		PromptCacheHitTokens  int `json:"prompt_cache_hit_tokens"`
		PromptCacheMissTokens int `json:"prompt_cache_miss_tokens"`
	} `json:"usage"`
}

type Client struct {
	cfg          *config.Config
	http         *http.Client
	logger       *util.Logger
	baseURL      string
	extraHeaders map[string]string
}

func New(cfg *config.Config) *Client {
	var baseURL string
	var extraHeaders map[string]string

	switch cfg.LLMProvider {
	case "deepseek":
		baseURL = "https://api.deepseek.com/v1"
	case "openrouter":
		baseURL = "https://openrouter.ai/api/v1"
		extraHeaders = map[string]string{
			"HTTP-Referer": "https://jfinder.doedja.com",
			"X-Title":      "JFinder",
		}
	default:
		baseURL = "https://api.deepseek.com/v1"
	}

	return &Client{
		cfg:          cfg,
		http:         &http.Client{Timeout: 120 * time.Second},
		logger:       util.Default.Child("svc", "llm"),
		baseURL:      baseURL,
		extraHeaders: extraHeaders,
	}
}

func (c *Client) Chat(ctx context.Context, messages []Message, temperature float64, timeout time.Duration) (string, error) {
	if timeout > 0 {
		var cancel context.CancelFunc
		ctx, cancel = context.WithTimeout(ctx, timeout)
		defer cancel()
	}

	reqBody := chatRequest{
		Model:       c.cfg.LLMModel,
		Messages:    messages,
		Temperature: temperature,
		Stream:      false,
	}

	body, err := json.Marshal(reqBody)
	if err != nil {
		return "", fmt.Errorf("marshal request: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+"/chat/completions", bytes.NewReader(body))
	if err != nil {
		return "", fmt.Errorf("create request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+c.cfg.LLMAPIKey)

	for k, v := range c.extraHeaders {
		req.Header.Set(k, v)
	}

	resp, err := c.http.Do(req)
	if err != nil {
		return "", fmt.Errorf("http request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("LLM API error: status %d", resp.StatusCode)
	}

	var chatResp chatResponse
	if err := json.NewDecoder(resp.Body).Decode(&chatResp); err != nil {
		return "", fmt.Errorf("decode response: %w", err)
	}

	if len(chatResp.Choices) == 0 {
		return "", fmt.Errorf("LLM response: no choices")
	}

	content := strings.TrimSpace(chatResp.Choices[0].Message.Content)

	c.logger.Info("LLM Chat completion",
		"prompt_tokens", chatResp.Usage.PromptTokens,
		"completion_tokens", chatResp.Usage.CompletionTokens,
		"prompt_cache_hit_tokens", chatResp.Usage.PromptCacheHitTokens,
		"prompt_cache_miss_tokens", chatResp.Usage.PromptCacheMissTokens,
	)

	return content, nil
}
