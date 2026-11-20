package main

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
)

// ConnectionProfile is a saved connection. It deliberately has no password
// field so credentials can never end up on disk.
type ConnectionProfile struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	Host     string `json:"host"`
	Port     string `json:"port"`
	Database string `json:"database"`
	User     string `json:"user"`
	SSLMode  string `json:"sslMode"`
}

type connectionStore struct {
	mu   sync.Mutex
	path string
}

func newConnectionStore() *connectionStore {
	dir, err := os.UserConfigDir()
	if err != nil {
		return &connectionStore{}
	}
	return &connectionStore{path: filepath.Join(dir, "otter", "connections.json")}
}

func (s *connectionStore) ensurePath() error {
	if s.path == "" {
		return errors.New("could not locate the user config directory")
	}
	return nil
}

func (s *connectionStore) list() ([]ConnectionProfile, error) {
	if err := s.ensurePath(); err != nil {
		return nil, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.load()
}

// save upserts by ID, assigning a new ID when the profile is new.
func (s *connectionStore) save(p ConnectionProfile) (ConnectionProfile, error) {
	if err := s.ensurePath(); err != nil {
		return ConnectionProfile{}, err
	}

	p.Name = strings.TrimSpace(p.Name)
	p.Host = strings.TrimSpace(p.Host)
	p.Port = strings.TrimSpace(p.Port)
	p.Database = strings.TrimSpace(p.Database)
	p.User = strings.TrimSpace(p.User)
	if p.Port == "" {
		p.Port = "5432"
	}
	if p.SSLMode == "" {
		p.SSLMode = "disable"
	}

	if p.Name == "" {
		return ConnectionProfile{}, errors.New("name is required")
	}
	cfg := ConnectConfig{Host: p.Host, Port: p.Port, Database: p.Database, User: p.User, SSLMode: p.SSLMode}
	if err := cfg.validate(); err != nil {
		return ConnectionProfile{}, err
	}
	if p.ID == "" {
		id, err := newProfileID()
		if err != nil {
			return ConnectionProfile{}, err
		}
		p.ID = id
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	profiles, err := s.load()
	if err != nil {
		return ConnectionProfile{}, err
	}
	replaced := false
	for i := range profiles {
		if profiles[i].ID == p.ID {
			profiles[i] = p
			replaced = true
			break
		}
	}
	if !replaced {
		profiles = append(profiles, p)
	}
	if err := s.write(profiles); err != nil {
		return ConnectionProfile{}, err
	}
	return p, nil
}

func (s *connectionStore) remove(id string) error {
	if err := s.ensurePath(); err != nil {
		return err
	}
	s.mu.Lock()
	defer s.mu.Unlock()

	profiles, err := s.load()
	if err != nil {
		return err
	}
	kept := make([]ConnectionProfile, 0, len(profiles))
	for _, p := range profiles {
		if p.ID != id {
			kept = append(kept, p)
		}
	}
	return s.write(kept)
}

func (s *connectionStore) load() ([]ConnectionProfile, error) {
	data, err := os.ReadFile(s.path)
	if errors.Is(err, os.ErrNotExist) {
		return []ConnectionProfile{}, nil
	}
	if err != nil {
		return nil, err
	}
	var profiles []ConnectionProfile
	if err := json.Unmarshal(data, &profiles); err != nil {
		return nil, fmt.Errorf("connections file %s is not valid JSON: %w", s.path, err)
	}
	if profiles == nil {
		profiles = []ConnectionProfile{}
	}
	return profiles, nil
}

// write persists via a temp file + rename so a crash mid-write
// cannot truncate the existing profile list.
func (s *connectionStore) write(profiles []ConnectionProfile) error {
	if err := os.MkdirAll(filepath.Dir(s.path), 0o755); err != nil {
		return err
	}
	data, err := json.MarshalIndent(profiles, "", "  ")
	if err != nil {
		return err
	}
	tmp := s.path + ".tmp"
	if err := os.WriteFile(tmp, data, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, s.path)
}

func newProfileID() (string, error) {
	var b [8]byte
	if _, err := rand.Read(b[:]); err != nil {
		return "", err
	}
	return hex.EncodeToString(b[:]), nil
}

// parseConnectionURL turns postgresql://user:pass@host:port/db into fields.
// The password stays in memory only; profiles never include it.
func parseConnectionURL(raw string) (ConnectConfig, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return ConnectConfig{}, errors.New("enter a connection URL")
	}
	u, err := url.Parse(raw)
	if err != nil {
		return ConnectConfig{}, fmt.Errorf("invalid URL: %w", err)
	}
	if u.Scheme != "postgres" && u.Scheme != "postgresql" {
		return ConnectConfig{}, errors.New("URL must start with postgresql://")
	}

	var user, password string
	if u.User != nil {
		user = u.User.Username()
		password, _ = u.User.Password()
	}
	port := u.Port()
	if port == "" {
		port = "5432"
	}
	db := strings.TrimPrefix(u.Path, "/")
	if db == "" {
		return ConnectConfig{}, errors.New("URL is missing a database name")
	}

	cfg := ConnectConfig{
		Host:     u.Hostname(),
		Port:     port,
		Database: db,
		User:     user,
		Password: password,
		SSLMode:  u.Query().Get("sslmode"),
	}.withDefaults()
	if err := cfg.validate(); err != nil {
		return ConnectConfig{}, err
	}
	return cfg, nil
}
