package web

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"time"
)

// Tasker is the interface for objects with GetID and GetLastUpdate.
type Tasker interface {
	GetID() string
	GetLastUpdate() time.Time
}

// WriteProgressStream writes SSE events to w, polling via fetch every second.
// Stops when status is "complete" or "error", on context cancel, or task gone.
func WriteProgressStream(ctx context.Context, w http.ResponseWriter, taskID string, fetch func(id string) (payload any, status string, ok bool)) {
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")

	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming unsupported", http.StatusInternalServerError)
		return
	}

	ticker := time.NewTicker(1 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			payload, status, ok := fetch(taskID)
			if !ok {
				fmt.Fprintf(w, "data: {\"error\":\"task not found\"}\n\n")
				flusher.Flush()
				return
			}
			data, err := json.Marshal(payload)
			if err != nil {
				continue
			}
			fmt.Fprintf(w, "data: %s\n\n", data)
			flusher.Flush()
			if status == "complete" || status == "error" {
				return
			}
		}
	}
}
