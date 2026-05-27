package tasks

import (
	"sync"
	"time"

	"github.com/google/uuid"

	"github.com/doedja/jfinder/internal/config"
	"github.com/doedja/jfinder/internal/types"
	"github.com/doedja/jfinder/internal/util"
)

// DownloadManager manages download task statuses.
type DownloadManager struct {
	mu     sync.RWMutex
	tasks  map[string]*types.TaskStatus
	logger *util.Logger
	cfg    *config.Config
}

// NewDownloadManager creates a new DownloadManager and starts cleanup loop.
func NewDownloadManager(cfg *config.Config, logger *util.Logger) *DownloadManager {
	m := &DownloadManager{
		tasks:  make(map[string]*types.TaskStatus),
		logger: logger,
		cfg:    cfg,
	}
	go m.cleanupLoop()
	return m
}

// Get returns a copy of the task status or nil.
func (m *DownloadManager) Get(id string) *types.TaskStatus {
	m.mu.RLock()
	defer m.mu.RUnlock()
	task := m.tasks[id]
	if task == nil {
		return nil
	}
	cp := *task
	return &cp
}

// Delete removes a task and returns true if existed.
func (m *DownloadManager) Delete(id string) bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	_, ok := m.tasks[id]
	if ok {
		delete(m.tasks, id)
	}
	return ok
}

// Count returns total number of tasks.
func (m *DownloadManager) Count() int {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return len(m.tasks)
}

// ActiveCount returns number of tasks not in terminal state.
func (m *DownloadManager) ActiveCount() int {
	m.mu.RLock()
	defer m.mu.RUnlock()
	count := 0
	for _, t := range m.tasks {
		if t.Status != types.TaskComplete && t.Status != types.TaskError {
			count++
		}
	}
	return count
}

// All returns copies of all task statuses.
func (m *DownloadManager) All() []*types.TaskStatus {
	m.mu.RLock()
	defer m.mu.RUnlock()
	result := make([]*types.TaskStatus, 0, len(m.tasks))
	for _, t := range m.tasks {
		cp := *t
		result = append(result, &cp)
	}
	return result
}

// Create adds a new pending task and returns its ID.
func (m *DownloadManager) Create(totalPapers, totalCycles int) string {
	id := uuid.New().String()
	task := &types.TaskStatus{
		ID:               id,
		Status:           types.TaskPending,
		Progress:         0,
		Message:          "Initializing...",
		TotalPapers:      totalPapers,
		TotalCycles:      totalCycles,
		PapersFound:      0,
		PapersDownloaded: 0,
		CurrentCycle:     0,
		LastUpdate:       time.Now(),
	}
	m.mu.Lock()
	m.tasks[id] = task
	m.mu.Unlock()
	m.logger.Info("created download task", "id", id, "totalPapers", totalPapers, "totalCycles", totalCycles)
	return id
}

// Update locks the task and applies mutate, setting LastUpdate.
func (m *DownloadManager) Update(id string, mutate func(*types.TaskStatus)) {
	m.mu.Lock()
	defer m.mu.Unlock()
	task, ok := m.tasks[id]
	if !ok {
		return
	}
	mutate(task)
	task.LastUpdate = time.Now()
}

// StartProcessing sets status to processing with progress 5.
func (m *DownloadManager) StartProcessing(id, message string) {
	if message == "" {
		message = "Processing..."
	}
	m.Update(id, func(t *types.TaskStatus) {
		t.Status = types.TaskProcessing
		t.Progress = 5
		t.Message = message
	})
}

// UpdateCycleProgress adjusts progress based on cycle and total cycles.
func (m *DownloadManager) UpdateCycleProgress(id, message string, cycle, found int) {
	m.Update(id, func(t *types.TaskStatus) {
		if t.TotalCycles > 0 {
			progress := int(float64(cycle)/float64(t.TotalCycles)*85) + 5
			if progress < 5 {
				progress = 5
			} else if progress > 90 {
				progress = 90
			}
			t.Progress = progress
		}
		t.CurrentCycle = cycle
		t.PapersFound = found
		t.Message = message
	})
}

// UpdateDownloadProgress updates progress during download phase (50-99).
// Uses the wider 50-99 range so the bar visibly moves between papers.
func (m *DownloadManager) UpdateDownloadProgress(id string, downloaded, total int) {
	progress := 50
	if total > 0 {
		progress = 50 + int(float64(downloaded)/float64(total)*49)
	}
	if progress < 50 {
		progress = 50
	} else if progress > 99 {
		progress = 99
	}
	m.Update(id, func(t *types.TaskStatus) {
		t.PapersDownloaded = downloaded
		t.Progress = progress
	})
}

// StartPaperDownload marks the start of a single paper's race attempt with a
// human-readable message ("Paper 2/3: <truncated title>"). Called before the
// download actually starts so the UI does not look frozen while one paper
// goes through several source attempts.
func (m *DownloadManager) StartPaperDownload(id string, current, total int, title string) {
	const maxTitle = 70
	t := title
	if len(t) > maxTitle {
		t = t[:maxTitle] + "..."
	}
	progress := 50
	if total > 0 {
		// position the bar at the start of the current paper's slice
		progress = 50 + int(float64(current-1)/float64(total)*49)
	}
	if progress < 50 {
		progress = 50
	} else if progress > 99 {
		progress = 99
	}
	m.Update(id, func(s *types.TaskStatus) {
		s.Progress = progress
		s.Message = "Paper " + itoa(current) + "/" + itoa(total) + ": " + t
	})
}

func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	neg := n < 0
	if neg {
		n = -n
	}
	var buf [20]byte
	i := len(buf)
	for n > 0 {
		i--
		buf[i] = byte('0' + n%10)
		n /= 10
	}
	if neg {
		i--
		buf[i] = '-'
	}
	return string(buf[i:])
}

// Complete sets task as complete with download/metadata URLs.
func (m *DownloadManager) Complete(id, downloadURL, metadataURL string) {
	m.Update(id, func(t *types.TaskStatus) {
		t.Status = types.TaskComplete
		t.Progress = 100
		t.Message = "Complete"
		t.DownloadURL = downloadURL
		t.MetadataURL = metadataURL
	})
}

// Fail sets task status to error with the given message.
func (m *DownloadManager) Fail(id, errMsg string) {
	m.Update(id, func(t *types.TaskStatus) {
		t.Status = types.TaskError
		t.Err = errMsg
		t.Message = errMsg
	})
}

func (m *DownloadManager) cleanupLoop() {
	ticker := time.NewTicker(10 * time.Minute)
	defer ticker.Stop()
	for range ticker.C {
		m.cleanup()
	}
}

func (m *DownloadManager) cleanup() {
	threshold := time.Now().Add(-m.cfg.TaskTTL)
	m.mu.Lock()
	defer m.mu.Unlock()
	for id, task := range m.tasks {
		if task.LastUpdate.Before(threshold) {
			delete(m.tasks, id)
		}
	}
	removed, err := util.CleanupOldTaskDirs(m.cfg.DownloadDir, m.cfg.TaskTTL)
	if err != nil {
		m.logger.Warn("failed to clean task dirs", "err", err)
	} else if removed > 0 {
		m.logger.Info("cleaned old task dirs", "count", removed)
	}
}

// GapManager manages gap analysis task statuses.
type GapManager struct {
	mu     sync.RWMutex
	tasks  map[string]*types.GapTaskStatus
	logger *util.Logger
	cfg    *config.Config
}

// NewGapManager creates a new GapManager and starts cleanup loop.
func NewGapManager(cfg *config.Config, logger *util.Logger) *GapManager {
	m := &GapManager{
		tasks:  make(map[string]*types.GapTaskStatus),
		logger: logger,
		cfg:    cfg,
	}
	go m.cleanupLoop()
	return m
}

// Get returns a copy of the gap task status or nil.
func (m *GapManager) Get(id string) *types.GapTaskStatus {
	m.mu.RLock()
	defer m.mu.RUnlock()
	task := m.tasks[id]
	if task == nil {
		return nil
	}
	cp := *task
	return &cp
}

// Delete removes a gap task and returns true if existed.
func (m *GapManager) Delete(id string) bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	_, ok := m.tasks[id]
	if ok {
		delete(m.tasks, id)
	}
	return ok
}

// Count returns total number of gap tasks.
func (m *GapManager) Count() int {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return len(m.tasks)
}

// ActiveCount returns number of gap tasks not in terminal state.
func (m *GapManager) ActiveCount() int {
	m.mu.RLock()
	defer m.mu.RUnlock()
	count := 0
	for _, t := range m.tasks {
		if t.Status != types.GapComplete && t.Status != types.GapError {
			count++
		}
	}
	return count
}

// All returns copies of all gap task statuses.
func (m *GapManager) All() []*types.GapTaskStatus {
	m.mu.RLock()
	defer m.mu.RUnlock()
	result := make([]*types.GapTaskStatus, 0, len(m.tasks))
	for _, t := range m.tasks {
		cp := *t
		result = append(result, &cp)
	}
	return result
}

// Create adds a new pending gap task and returns its ID.
func (m *GapManager) Create(topic string, targetPapers int, typesSlice []types.AnalysisType, depth types.AnalysisDepth) string {
	id := uuid.New().String()
	task := &types.GapTaskStatus{
		ID:         id,
		Type:       "gap-analysis",
		Status:     types.GapPending,
		Progress:   0,
		Stage:      "Initializing...",
		Topic:      topic,
		LastUpdate: time.Now(),
	}
	m.mu.Lock()
	m.tasks[id] = task
	m.mu.Unlock()
	m.logger.Info("created gap task", "id", id, "topic", topic)
	return id
}

// Update locks the gap task and applies mutate, setting LastUpdate.
func (m *GapManager) Update(id string, mutate func(*types.GapTaskStatus)) {
	m.mu.Lock()
	defer m.mu.Unlock()
	task, ok := m.tasks[id]
	if !ok {
		return
	}
	mutate(task)
	task.LastUpdate = time.Now()
}

// UpdateGapProgress updates gap task fields in one call.
func (m *GapManager) UpdateGapProgress(id string, status types.GapTaskState, stage string, progress, papersFound, gapsIdentified, directionsGenerated int) {
	m.Update(id, func(t *types.GapTaskStatus) {
		t.Status = status
		t.Stage = stage
		t.Progress = progress
		t.PapersFound = papersFound
		t.GapsIdentified = gapsIdentified
		t.DirectionsGenerated = directionsGenerated
	})
}

// UpdateComparisons updates comparisons count.
func (m *GapManager) UpdateComparisons(id string, comparisonsComplete int) {
	m.Update(id, func(t *types.GapTaskStatus) {
		t.ComparisonsComplete = comparisonsComplete
	})
}

// Complete sets gap task as complete with result/report URLs.
func (m *GapManager) Complete(id, resultURL, reportURL string) {
	m.Update(id, func(t *types.GapTaskStatus) {
		t.Status = types.GapComplete
		t.Progress = 100
		t.Stage = "Complete"
		t.ResultURL = resultURL
		t.ReportURL = reportURL
	})
}

// Fail sets gap task status to error.
func (m *GapManager) Fail(id, errMsg string) {
	m.Update(id, func(t *types.GapTaskStatus) {
		t.Status = types.GapError
		t.Err = errMsg
		t.Stage = errMsg
	})
}

func (m *GapManager) cleanupLoop() {
	ticker := time.NewTicker(10 * time.Minute)
	defer ticker.Stop()
	for range ticker.C {
		m.cleanup()
	}
}

func (m *GapManager) cleanup() {
	threshold := time.Now().Add(-m.cfg.TaskTTL)
	m.mu.Lock()
	defer m.mu.Unlock()
	for id, task := range m.tasks {
		if task.LastUpdate.Before(threshold) {
			delete(m.tasks, id)
		}
	}
	removed, err := util.CleanupOldTaskDirs(m.cfg.DownloadDir, m.cfg.TaskTTL)
	if err != nil {
		m.logger.Warn("failed to clean task dirs", "err", err)
	} else if removed > 0 {
		m.logger.Info("cleaned old task dirs", "count", removed)
	}
}
