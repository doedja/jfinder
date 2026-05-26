package util

import (
	"context"
	"math/rand"
	"time"
)

// WithRetry executes fn repeatedly with exponential backoff and jitter.
// maxRetries is the number of retries after the initial attempt (total attempts = maxRetries+1).
func WithRetry[T any](ctx context.Context, fn func(context.Context) (T, error), maxRetries int, baseDelay time.Duration) (T, error) {
	var zero T
	for i := 0; ; i++ {
		result, err := fn(ctx)
		if err == nil {
			return result, nil
		}
		if i >= maxRetries {
			return zero, err
		}
		delay := baseDelay * (1 << i) // exponential: baseDelay * 2^i
		delay += time.Duration(rand.Float64() * float64(500*time.Millisecond))
		Warn("Retry attempt", "attempt", i+1, "retry_delay", delay, "error", err)
		select {
		case <-ctx.Done():
			return zero, ctx.Err()
		case <-time.After(delay):
		}
	}
}

// WithRetryPointer is for functions that signal retryable failure by returning (nil, nil).
// Non-nil results are returned immediately; non-nil errors are bubbled immediately.
func WithRetryPointer[T any](ctx context.Context, fn func(context.Context) (*T, error), maxRetries int, baseDelay time.Duration) (*T, error) {
	for i := 0; ; i++ {
		res, err := fn(ctx)
		if err != nil {
			return nil, err
		}
		if res != nil {
			return res, nil
		}
		if i >= maxRetries {
			return nil, nil
		}
		delay := baseDelay * (1 << i)
		delay += time.Duration(rand.Float64() * float64(500*time.Millisecond))
		Warn("Retry attempt (pointer)", "attempt", i+1, "retry_delay", delay)
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-time.After(delay):
		}
	}
}
