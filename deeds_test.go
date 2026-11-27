// Copyright 2026 Kirill Scherba. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

package main

import (
	"path/filepath"
	"testing"
)

// TestDeedsLiveInOneFile: a deed is added, closed and deleted, and every step survives a restart of
// the module — the file is the only memory the module has.
func TestDeedsLiveInOneFile(t *testing.T) {
	path := filepath.Join(t.TempDir(), "deeds.json")
	s := newDeedStore(path)

	d, err := s.Add("позвонить в Рег.ру", "2026-11-30", "goal/1")
	if err != nil || d.ID == "" {
		t.Fatalf("дело не записано: %v", err)
	}
	if _, err := s.Add("  ", "", ""); err == nil {
		t.Fatal("дело без текста принято")
	}

	done := true
	if _, err := s.Update(d.ID, nil, nil, nil, &done); err != nil {
		t.Fatalf("не закрылось: %v", err)
	}

	again := newDeedStore(path)
	list := again.List()
	if len(list) != 1 || !list[0].Done || list[0].Text != "позвонить в Рег.ру" {
		t.Fatalf("после перезапуска: %+v", list)
	}
	if err := again.Delete(d.ID); err != nil {
		t.Fatalf("не удалилось: %v", err)
	}
	if len(newDeedStore(path).List()) != 0 {
		t.Fatal("дело осталось после удаления")
	}
}

// TestOpenDeedsComeFirst: the screen shows what is to be done before what is done.
func TestOpenDeedsComeFirst(t *testing.T) {
	s := newDeedStore(filepath.Join(t.TempDir(), "deeds.json"))
	first, _ := s.Add("закрытое", "", "")
	done := true
	_, _ = s.Update(first.ID, nil, nil, nil, &done)
	_, _ = s.Add("открытое", "", "")
	list := s.List()
	if len(list) != 2 || list[0].Text != "открытое" {
		t.Fatalf("порядок: %+v", list)
	}
}
