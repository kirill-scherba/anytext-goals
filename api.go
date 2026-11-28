// Copyright 2026 Kirill Scherba. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

// api.go — the HTTP surface of the module: the screens read here, and the tools for the agent are in
// mcp.go.
package main

import (
	"context"
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
	"time"
)

// app is the module: one memory of goals, one file of deeds.
type app struct {
	gateway  string
	server   string
	deeds    *deedStore
	settings string
}

func (a *app) client() *goalClient { return newGoalClient(a.gateway, a.server) }

func (a *app) routes() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, map[string]any{"status": "ok", "version": version})
	})
	mux.HandleFunc("GET /api/status", a.status)
	mux.HandleFunc("GET /api/goals", a.goals)
	mux.HandleFunc("POST /api/goals", a.createGoal)
	mux.HandleFunc("POST /api/goals/update", a.updateGoal)
	mux.HandleFunc("POST /api/goals/delete", a.deleteGoal)
	mux.HandleFunc("GET /api/deeds", a.listDeeds)
	mux.HandleFunc("POST /api/deeds", a.addDeed)
	mux.HandleFunc("POST /api/deeds/update", a.updateDeed)
	mux.HandleFunc("POST /api/deeds/delete", a.deleteDeed)
	mux.HandleFunc("POST /mcp", a.mcp)
	mux.HandleFunc("GET /mcp", a.mcp)

	// The screen: one page with everything inside it, for the reason written in ui.go.
	mux.HandleFunc("GET /{$}", a.page)
	mux.HandleFunc("GET /ui", a.page)
	mux.HandleFunc("GET /ui/{$}", a.page)
	return mux
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func fail(w http.ResponseWriter, status int, err error) {
	writeJSON(w, status, map[string]any{"error": err.Error()})
}

func (a *app) status(w http.ResponseWriter, r *http.Request) {
	deeds := a.deeds.List()
	open := 0
	for _, d := range deeds {
		if !d.Done {
			open++
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"version": version, "deeds": len(deeds), "open": open, "gateway": a.gateway, "server": a.server,
	})
}

// goals answers the goals of the installation's memory.
func (a *app) goals(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 45*time.Second)
	defer cancel()
	goals, err := a.client().Goals(ctx)
	if err != nil {
		fail(w, http.StatusBadGateway, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"goals": goals})
}

// createGoal adds one goal to the installation's memory.
func (a *app) createGoal(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Title       string `json:"title"`
		Description string `json:"description"`
		Deadline    string `json:"deadline"`
		Priority    int    `json:"priority"`
		Labels      string `json:"labels"`
	}
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		fail(w, http.StatusBadRequest, err)
		return
	}
	if strings.TrimSpace(in.Title) == "" {
		fail(w, http.StatusBadRequest, errText("цель без названия"))
		return
	}
	args := map[string]any{"title": strings.TrimSpace(in.Title)}
	if in.Description != "" {
		args["description"] = in.Description
	}
	if in.Deadline != "" {
		args["deadline"] = in.Deadline
	}
	if in.Priority > 0 {
		args["priority"] = in.Priority
	}
	if in.Labels != "" {
		args["labels"] = in.Labels
	}
	ctx, cancel := context.WithTimeout(r.Context(), 45*time.Second)
	defer cancel()
	if err := a.client().Create(ctx, args); err != nil {
		fail(w, http.StatusBadGateway, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

// updateGoal moves one goal. Only the fields that came in the request are sent: a request that
// changes the progress must not wipe the deadline.
func (a *app) updateGoal(w http.ResponseWriter, r *http.Request) {
	var in struct {
		ID          string `json:"id"`
		Title       string `json:"title"`
		Description string `json:"description"`
		Status      string `json:"status"`
		Deadline    string `json:"deadline"`
		Priority    *int   `json:"priority"`
		Progress    *int   `json:"progress"`
		Labels      string `json:"labels"`
	}
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		fail(w, http.StatusBadRequest, err)
		return
	}
	if strings.TrimSpace(in.ID) == "" {
		fail(w, http.StatusBadRequest, errText("не указана цель"))
		return
	}
	args := map[string]any{"id": in.ID}
	if in.Title != "" {
		args["title"] = in.Title
	}
	if in.Description != "" {
		args["description"] = in.Description
	}
	if in.Status != "" {
		args["status"] = in.Status
	}
	if in.Deadline != "" {
		args["deadline"] = in.Deadline
	}
	if in.Priority != nil {
		args["priority"] = *in.Priority
	}
	if in.Labels != "" {
		// The memory takes a comma-separated list or a JSON array; "[]" clears.
		args["labels"] = in.Labels
	}
	if in.Progress != nil {
		p := *in.Progress
		if p < 0 {
			p = 0
		}
		if p > 100 {
			p = 100
		}
		args["progress"] = p
	}
	ctx, cancel := context.WithTimeout(r.Context(), 45*time.Second)
	defer cancel()
	if err := a.client().Update(ctx, args); err != nil {
		fail(w, http.StatusBadGateway, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (a *app) deleteGoal(w http.ResponseWriter, r *http.Request) {
	var in struct {
		ID string `json:"id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		fail(w, http.StatusBadRequest, err)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 45*time.Second)
	defer cancel()
	if err := a.client().Delete(ctx, in.ID); err != nil {
		fail(w, http.StatusBadGateway, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (a *app) listDeeds(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"deeds": a.deeds.List()})
}

func (a *app) addDeed(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Text string `json:"text"`
		Due  string `json:"due"`
		Goal string `json:"goal"`
	}
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		fail(w, http.StatusBadRequest, err)
		return
	}
	d, err := a.deeds.Add(in.Text, in.Due, in.Goal)
	if err != nil {
		fail(w, http.StatusBadRequest, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"deed": d})
}

func (a *app) updateDeed(w http.ResponseWriter, r *http.Request) {
	var in struct {
		ID   string  `json:"id"`
		Text *string `json:"text"`
		Due  *string `json:"due"`
		Goal *string `json:"goal"`
		Done *bool   `json:"done"`
	}
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		fail(w, http.StatusBadRequest, err)
		return
	}
	d, err := a.deeds.Update(in.ID, in.Text, in.Due, in.Goal, in.Done)
	if err != nil {
		fail(w, http.StatusNotFound, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"deed": d})
}

func (a *app) deleteDeed(w http.ResponseWriter, r *http.Request) {
	var in struct {
		ID string `json:"id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		fail(w, http.StatusBadRequest, err)
		return
	}
	if err := a.deeds.Delete(in.ID); err != nil {
		fail(w, http.StatusNotFound, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

// errText is a one-line error without fmt in every call.
type errText string

func (e errText) Error() string { return string(e) }

// intOr answers a number from a URL argument.
func intOr(raw string, fallback int) int {
	if n, err := strconv.Atoi(strings.TrimSpace(raw)); err == nil {
		return n
	}
	return fallback
}
