package util

import (
	"encoding/json"
	"os"
	"strings"
	"sync"
	"time"
)

var _ = sync.Mutex{}

var Default = New()

type level int

const (
	debugLevel level = iota
	infoLevel
	warnLevel
	errorLevel
)

var levelNames = map[level]string{
	debugLevel: "debug",
	infoLevel:  "info",
	warnLevel:  "warn",
	errorLevel: "error",
}

func parseLevel(s string) level {
	switch strings.ToLower(strings.TrimSpace(s)) {
	case "debug":
		return debugLevel
	case "info":
		return infoLevel
	case "warn", "warning":
		return warnLevel
	case "error":
		return errorLevel
	default:
		return infoLevel
	}
}

type Logger struct {
	mu     sync.Mutex
	level  level
	fields []interface{}
}

func New() *Logger {
	lvl := parseLevel(os.Getenv("LOG_LEVEL"))
	return &Logger{level: lvl}
}

func (l *Logger) Debug(msg string, kv ...any) { l.log(debugLevel, msg, kv...) }
func (l *Logger) Info(msg string, kv ...any)  { l.log(infoLevel, msg, kv...) }
func (l *Logger) Warn(msg string, kv ...any)  { l.log(warnLevel, msg, kv...) }
func (l *Logger) Error(msg string, kv ...any) { l.log(errorLevel, msg, kv...) }

func (l *Logger) Child(kv ...any) *Logger {
	child := &Logger{level: l.level}
	child.fields = append(child.fields, l.fields...)
	child.fields = append(child.fields, kv...)
	return child
}

func (l *Logger) log(lvl level, msg string, kv ...any) {
	if lvl < l.level {
		return
	}
	m := make(map[string]interface{}, 4+len(kv)/2)
	m["ts"] = time.Now().UTC().Format(time.RFC3339Nano)
	m["level"] = levelNames[lvl]
	m["msg"] = msg
	for i := 0; i+1 < len(kv); i += 2 {
		key, ok := kv[i].(string)
		if !ok {
			continue
		}
		m[key] = kv[i+1]
	}
	for i := 0; i+1 < len(l.fields); i += 2 {
		key, ok := l.fields[i].(string)
		if !ok {
			continue
		}
		if _, exists := m[key]; !exists {
			m[key] = l.fields[i+1]
		}
	}
	out := os.Stdout
	if lvl >= errorLevel {
		out = os.Stderr
	}
	_ = json.NewEncoder(out).Encode(m)
}

func Debug(msg string, kv ...any)  { Default.Debug(msg, kv...) }
func Info(msg string, kv ...any)   { Default.Info(msg, kv...) }
func Warn(msg string, kv ...any)   { Default.Warn(msg, kv...) }
func Error(msg string, kv ...any)  { Default.Error(msg, kv...) }
