// Copyright 2026 Kirill Scherba. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

// goals.go — the goals of the installation, read from its memory.
//
// A goal is a long-lived outcome with a progress: "ship 0.5", "finish the agent ecosystem". The
// memory of the installation already holds them (memory_goal_*), the agent already writes them, and
// the module is the screen where a person reads and moves them. There is no second copy of a goal
// anywhere (27.11.2026).
package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"sync/atomic"
	"time"
)

// Goal is one tracked outcome, as the memory describes it.
type Goal struct {
	ID          string   `json:"id"`
	Title       string   `json:"title"`
	Description string   `json:"description,omitempty"`
	Labels      []string `json:"labels,omitempty"`
	Status      string   `json:"status"`
	Priority    int      `json:"priority"`
	Progress    int      `json:"progress"`
	Deadline    string   `json:"deadline,omitempty"`
	CreatedAt   int64    `json:"created_at,omitempty"`
	UpdatedAt   int64    `json:"updated_at,omitempty"`
}

// goalClient calls the tools of one MCP server through the installation's gateway.
type goalClient struct {
	gateway string // the gateway base, e.g. http://127.0.0.1:7711
	server  string // the MCP server that holds the tools, e.g. memory-store-mcp
	http    *http.Client
	id      atomic.Int64
}

func newGoalClient(gateway, server string) *goalClient {
	return &goalClient{gateway: gateway, server: server, http: &http.Client{Timeout: 60 * time.Second}}
}

// call runs one MCP tool and returns the text of its answer.
func (c *goalClient) call(ctx context.Context, tool string, args map[string]any) (string, error) {
	body, err := json.Marshal(map[string]any{
		"jsonrpc": "2.0",
		"id":      c.id.Add(1),
		"method":  "tools/call",
		"params":  map[string]any{"name": tool, "arguments": args},
	})
	if err != nil {
		return "", err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.gateway+"/"+c.server, bytes.NewReader(body))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")

	resp, err := c.http.Do(req)
	if err != nil {
		return "", fmt.Errorf("шлюз %s не ответил: %w", c.gateway, err)
	}
	defer resp.Body.Close()
	data, err := io.ReadAll(io.LimitReader(resp.Body, 8<<20))
	if err != nil {
		return "", err
	}
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("шлюз ответил %s: %s", resp.Status, trimText(data))
	}
	var out struct {
		Result *struct {
			IsError bool `json:"isError"`
			Content []struct {
				Type string `json:"type"`
				Text string `json:"text"`
			} `json:"content"`
			StructuredContent json.RawMessage `json:"structuredContent"`
		} `json:"result"`
		Error *struct {
			Message string `json:"message"`
		} `json:"error"`
	}
	if err := json.Unmarshal(data, &out); err != nil {
		return "", fmt.Errorf("ответ шлюза не разобран: %w", err)
	}
	if out.Error != nil {
		return "", fmt.Errorf("%s", out.Error.Message)
	}
	if out.Result == nil {
		return "", fmt.Errorf("шлюз ответил без результата")
	}
	if out.Result.IsError {
		text := ""
		if len(out.Result.Content) > 0 {
			text = out.Result.Content[0].Text
		}
		return "", fmt.Errorf("%s", text)
	}
	if len(out.Result.StructuredContent) > 0 && string(out.Result.StructuredContent) != "null" {
		return string(out.Result.StructuredContent), nil
	}
	if len(out.Result.Content) > 0 {
		return out.Result.Content[0].Text, nil
	}
	return "", nil
}

// Goals lists the goals of the installation's memory.
func (c *goalClient) Goals(ctx context.Context) ([]Goal, error) {
	text, err := c.call(ctx, "memory_goal_list", map[string]any{})
	if err != nil {
		return nil, err
	}
	return parseGoals(text)
}

// parseGoals reads the goals out of an answer. The tool answers with a sentence and a JSON array
// after it ("Found 78 goals:\n[…]"): the array is what matters, and the sentence is not a contract.
func parseGoals(text string) ([]Goal, error) {
	start := strings.Index(text, "[")
	if start < 0 {
		// "No goals found", "найдено 0 целей" - an empty memory answers with a sentence and no array.
		// Anything else is a failure, and saying so is better than showing an empty screen.
		lower := strings.ToLower(text)
		if strings.Contains(lower, "goal") || strings.Contains(lower, "цел") || strings.Contains(lower, "не найдено") {
			return nil, nil
		}
		return nil, fmt.Errorf("в ответе памяти нет списка целей")
	}
	var goals []Goal
	if err := json.Unmarshal([]byte(text[start:]), &goals); err != nil {
		return nil, fmt.Errorf("список целей не разобран: %w", err)
	}
	for i := range goals {
		if goals[i].Progress < 0 {
			goals[i].Progress = 0
		}
		if goals[i].Progress > 100 {
			goals[i].Progress = 100
		}
		if goals[i].Status == "" {
			goals[i].Status = "active"
		}
	}
	return goals, nil
}

// Update moves one goal: progress, status, deadline, priority, title or description.
func (c *goalClient) Update(ctx context.Context, args map[string]any) error {
	_, err := c.call(ctx, "memory_goal_update", args)
	return err
}

// Create adds a goal.
func (c *goalClient) Create(ctx context.Context, args map[string]any) error {
	_, err := c.call(ctx, "memory_goal_create", args)
	return err
}

// Delete forgets a goal.
func (c *goalClient) Delete(ctx context.Context, id string) error {
	_, err := c.call(ctx, "memory_goal_delete", map[string]any{"id": id})
	return err
}

// asInt answers a number from a JSON value that may come as a float, a string or nothing at all.
func asInt(v any) int {
	switch x := v.(type) {
	case float64:
		return int(x)
	case int:
		return x
	case string:
		n, _ := strconv.Atoi(strings.TrimSpace(x))
		return n
	}
	return 0
}

// trimText shortens an answer for an error message.
func trimText(b []byte) string {
	s := strings.TrimSpace(string(b))
	if len(s) > 300 {
		return s[:300] + "…"
	}
	return s
}
