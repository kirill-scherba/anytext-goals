// Copyright 2026 Kirill Scherba. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

// deeds.go — the deeds of one person: what moves forward today.
//
// A deed is an intention with a result and no time slot: "call Reg.ru", "check the report". It is
// not a calendar event (that has a time and often a participant) and not a goal (that has a progress
// and lives for months). Deeds change every day, so they live here, in the module's own file, and
// not in the installation's memory, where they would only pollute the semantic search
// (27.11.2026).
package main

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
)

// Deed is one short intention. Done means it is finished; Due is a date ("2026-11-30") or empty;
// Goal is the id of the goal it moves, or empty.
type Deed struct {
	ID        string `json:"id"`
	Text      string `json:"text"`
	Done      bool   `json:"done"`
	Due       string `json:"due,omitempty"`
	Goal      string `json:"goal,omitempty"`
	CreatedAt int64  `json:"created_at,omitempty"`
	DoneAt    int64  `json:"done_at,omitempty"`
}

// deedStore is the file of deeds. One file, one process: the module is the only writer.
type deedStore struct {
	mu   sync.Mutex
	path string
	list []Deed
}

func newDeedStore(path string) *deedStore {
	s := &deedStore{path: path}
	s.load()
	return s
}

func (s *deedStore) load() {
	data, err := os.ReadFile(s.path)
	if err != nil {
		return
	}
	var list []Deed
	if err := json.Unmarshal(data, &list); err != nil {
		return
	}
	s.list = list
}

func (s *deedStore) save() error {
	if err := os.MkdirAll(filepath.Dir(s.path), 0o755); err != nil {
		return err
	}
	data, err := json.MarshalIndent(s.list, "", "  ")
	if err != nil {
		return err
	}
	tmp := s.path + ".tmp"
	if err := os.WriteFile(tmp, append(data, '\n'), 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, s.path)
}

// List answers every deed, open ones first and sorted by due date: the screen shows the day's work
// before the archive.
func (s *deedStore) List() []Deed {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := append([]Deed(nil), s.list...)
	sort.SliceStable(out, func(i, j int) bool {
		if out[i].Done != out[j].Done {
			return !out[i].Done
		}
		if out[i].Due != out[j].Due {
			if out[i].Due == "" {
				return false
			}
			if out[j].Due == "" {
				return true
			}
			return out[i].Due < out[j].Due
		}
		return out[i].CreatedAt < out[j].CreatedAt
	})
	return out
}

// Add creates a deed and answers it.
func (s *deedStore) Add(text, due, goal string) (Deed, error) {
	text = strings.TrimSpace(text)
	if text == "" {
		return Deed{}, fmt.Errorf("дело без текста")
	}
	d := Deed{ID: newDeedID(), Text: text, Due: strings.TrimSpace(due), Goal: strings.TrimSpace(goal), CreatedAt: time.Now().Unix()}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.list = append(s.list, d)
	if err := s.save(); err != nil {
		return Deed{}, err
	}
	return d, nil
}

// Update changes what a deed says, when it is due, which goal it moves, or whether it is done. An
// empty pointer argument leaves that field alone.
func (s *deedStore) Update(id string, text, due, goal *string, done *bool) (Deed, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for i := range s.list {
		if s.list[i].ID != id {
			continue
		}
		if text != nil && strings.TrimSpace(*text) != "" {
			s.list[i].Text = strings.TrimSpace(*text)
		}
		if due != nil {
			s.list[i].Due = strings.TrimSpace(*due)
		}
		if goal != nil {
			s.list[i].Goal = strings.TrimSpace(*goal)
		}
		if done != nil {
			s.list[i].Done = *done
			if *done {
				s.list[i].DoneAt = time.Now().Unix()
			} else {
				s.list[i].DoneAt = 0
			}
		}
		if err := s.save(); err != nil {
			return Deed{}, err
		}
		return s.list[i], nil
	}
	return Deed{}, fmt.Errorf("нет такого дела: %s", id)
}

// Delete removes a deed.
func (s *deedStore) Delete(id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	for i := range s.list {
		if s.list[i].ID == id {
			s.list = append(s.list[:i], s.list[i+1:]...)
			return s.save()
		}
	}
	return fmt.Errorf("нет такого дела: %s", id)
}

// newDeedID answers a short random id: a deed is created and closed often, and its id never appears
// outside this file.
func newDeedID() string {
	b := make([]byte, 5)
	if _, err := rand.Read(b); err != nil {
		return fmt.Sprintf("d%d", time.Now().UnixNano())
	}
	return "d" + hex.EncodeToString(b)
}
