// Copyright 2026 Kirill Scherba. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

package main

import "testing"

// TestGoalsAreReadFromTheSentence: the memory answers with a sentence and a JSON array after it, and
// the sentence is not a contract — the array is.
func TestGoalsAreReadFromTheSentence(t *testing.T) {
	text := "Found 2 goals:\n[\n {\"id\":\"goal/1\",\"title\":\"Выпустить 0.5\",\"status\":\"active\",\"progress\":140,\"priority\":10},\n {\"id\":\"goal/2\",\"title\":\"Старое\",\"progress\":-5}\n]"
	goals, err := parseGoals(text)
	if err != nil {
		t.Fatalf("не разобралось: %v", err)
	}
	if len(goals) != 2 {
		t.Fatalf("целей: %d", len(goals))
	}
	if goals[0].Progress != 100 || goals[1].Progress != 0 {
		t.Fatalf("прогресс не приведён к 0..100: %+v", goals)
	}
	if goals[1].Status != "active" {
		t.Fatalf("статус по умолчанию: %q", goals[1].Status)
	}
}

// TestNoGoalsIsNotAnError: an empty memory answers without an array, and the screen must show an
// empty list instead of a failure.
func TestNoGoalsIsNotAnError(t *testing.T) {
	for _, text := range []string{"No goals found", "найдено 0 целей"} {
		if goals, err := parseGoals(text); err != nil || len(goals) != 0 {
			t.Fatalf("%q: %v %v", text, goals, err)
		}
	}
}
