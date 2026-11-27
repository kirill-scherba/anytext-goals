// Copyright 2026 Kirill Scherba. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

// mcp.go — the module's hand into the agent: the deeds.
//
// The installation registers this endpoint with the agent (the "mcp" field of module.json), and the
// agent reaches the same list a person sees on the screen. Goals are not here on purpose: they live
// in the installation's memory, and the agent already has memory_goal_* for them
// (27.11.2026).
package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
)

// mcp serves the MCP protocol: initialize, tools/list and tools/call, over plain JSON (a POST with a
// JSON-RPC body answers with one JSON-RPC answer — the transport a module behind the installation's
// proxy can rely on).
func (a *app) mcp(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodGet {
		// A discovery request: the tools are described by tools/list.
		writeJSON(w, http.StatusOK, map[string]any{"ok": true, "server": "goals", "version": version})
		return
	}
	var req struct {
		JSONRPC string          `json:"jsonrpc"`
		ID      json.RawMessage `json:"id"`
		Method  string          `json:"method"`
		Params  json.RawMessage `json:"params"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusOK, rpcError(nil, -32700, "разбор запроса: "+err.Error()))
		return
	}
	switch req.Method {
	case "initialize":
		writeJSON(w, http.StatusOK, rpcResult(req.ID, map[string]any{
			"protocolVersion": "2025-06-18",
			"capabilities":    map[string]any{"tools": map[string]any{}},
			"serverInfo":      map[string]any{"name": "goals", "version": version},
		}))
	case "notifications/initialized", "notifications/cancelled":
		w.WriteHeader(http.StatusAccepted)
	case "tools/list":
		writeJSON(w, http.StatusOK, rpcResult(req.ID, map[string]any{"tools": deedTools()}))
	case "tools/call":
		a.callTool(w, req.ID, req.Params)
	default:
		writeJSON(w, http.StatusOK, rpcError(req.ID, -32601, "метод не поддерживается: "+req.Method))
	}
}

// callTool runs one deed tool.
func (a *app) callTool(w http.ResponseWriter, id json.RawMessage, params json.RawMessage) {
	var call struct {
		Name      string         `json:"name"`
		Arguments map[string]any `json:"arguments"`
	}
	if err := json.Unmarshal(params, &call); err != nil {
		writeJSON(w, http.StatusOK, rpcError(id, -32602, "разбор аргументов: "+err.Error()))
		return
	}
	arg := func(key string) string {
		if v, ok := call.Arguments[key]; ok {
			if s, ok := v.(string); ok {
				return strings.TrimSpace(s)
			}
		}
		return ""
	}

	switch call.Name {
	case "deed_add":
		d, err := a.deeds.Add(arg("text"), arg("due"), arg("goal"))
		if err != nil {
			toolError(w, id, err)
			return
		}
		toolJSON(w, id, map[string]any{"deed": d, "text": fmt.Sprintf("записано: %s (%s)", d.Text, d.ID)})

	case "deed_list":
		onlyOpen := arg("open") == "true" || arg("open") == "1"
		all := a.deeds.List()
		out := make([]Deed, 0, len(all))
		for _, d := range all {
			if onlyOpen && d.Done {
				continue
			}
			out = append(out, d)
		}
		toolJSON(w, id, map[string]any{"deeds": out, "count": len(out)})

	case "deed_close":
		done := true
		d, err := a.deeds.Update(arg("id"), nil, nil, nil, &done)
		if err != nil {
			toolError(w, id, err)
			return
		}
		toolJSON(w, id, map[string]any{"deed": d, "text": "закрыто: " + d.Text})

	case "deed_update":
		var text, due, goal *string
		if v := arg("text"); v != "" {
			text = &v
		}
		if v, ok := call.Arguments["due"]; ok {
			s, _ := v.(string)
			due = &s
		}
		if v := arg("goal"); v != "" {
			goal = &v
		}
		var done *bool
		if v, ok := call.Arguments["done"]; ok {
			b, _ := v.(bool)
			done = &b
		}
		d, err := a.deeds.Update(arg("id"), text, due, goal, done)
		if err != nil {
			toolError(w, id, err)
			return
		}
		toolJSON(w, id, map[string]any{"deed": d})

	default:
		writeJSON(w, http.StatusOK, rpcError(id, -32602, "нет такого инструмента: "+call.Name))
	}
}

// deedTools describes the tools to the agent. The descriptions matter as much as the code: they are
// what the agent reads before deciding to use one.
func deedTools() []map[string]any {
	return []map[string]any{
		{
			"name": "deed_add",
			"description": "Записать короткое дело (то, что делается за дни, без времени и участников: " +
				"«позвонить в Рег.ру», «проверить отчёт»). Для того, что длится месяцами, есть цель " +
				"memory_goal_create; для того, что назначено на время или с людьми — календарь.",
			"inputSchema": map[string]any{
				"type": "object",
				"properties": map[string]any{
					"text": map[string]any{"type": "string", "description": "что сделать"},
					"due":  map[string]any{"type": "string", "description": "срок, дата ГГГГ-ММ-ДД (необязательно)"},
					"goal": map[string]any{"type": "string", "description": "id цели, которую это дело двигает (необязательно)"},
				},
				"required": []string{"text"},
			},
		},
		{
			"name":        "deed_list",
			"description": "Список дел: что висит и что уже закрыто. Спросить «что у меня на сегодня» — это сюда.",
			"inputSchema": map[string]any{
				"type": "object",
				"properties": map[string]any{
					"open": map[string]any{"type": "string", "description": "true — только незакрытые"},
				},
			},
		},
		{
			"name":        "deed_close",
			"description": "Закрыть дело: оно сделано. Нужен id из deed_list.",
			"inputSchema": map[string]any{
				"type":       "object",
				"properties": map[string]any{"id": map[string]any{"type": "string", "description": "id дела"}},
				"required":   []string{"id"},
			},
		},
		{
			"name":        "deed_update",
			"description": "Изменить дело: текст, срок, цель или отметку «сделано».",
			"inputSchema": map[string]any{
				"type": "object",
				"properties": map[string]any{
					"id":   map[string]any{"type": "string", "description": "id дела"},
					"text": map[string]any{"type": "string", "description": "новый текст"},
					"due":  map[string]any{"type": "string", "description": "новый срок ГГГГ-ММ-ДД, пусто — снять"},
					"goal": map[string]any{"type": "string", "description": "id цели"},
					"done": map[string]any{"type": "boolean", "description": "сделано или нет"},
				},
				"required": []string{"id"},
			},
		},
	}
}

// rpcResult and friends keep the answer shape in one place.
func rpcResult(id json.RawMessage, result any) map[string]any {
	return map[string]any{"jsonrpc": "2.0", "id": rawID(id), "result": result}
}

func rpcError(id json.RawMessage, code int, message string) map[string]any {
	return map[string]any{"jsonrpc": "2.0", "id": rawID(id), "error": map[string]any{"code": code, "message": message}}
}

func rawID(id json.RawMessage) any {
	if len(id) == 0 {
		return nil
	}
	return id
}

// toolJSON answers a tool call with JSON text: the agent reads both, and a person debugging with
// curl sees the same thing.
func toolJSON(w http.ResponseWriter, id json.RawMessage, v any) {
	data, err := json.MarshalIndent(v, "", "  ")
	if err != nil {
		toolError(w, id, err)
		return
	}
	writeJSON(w, http.StatusOK, rpcResult(id, map[string]any{
		"content":           []map[string]any{{"type": "text", "text": string(data)}},
		"structuredContent": v,
	}))
}

func toolError(w http.ResponseWriter, id json.RawMessage, err error) {
	writeJSON(w, http.StatusOK, rpcResult(id, map[string]any{
		"isError": true,
		"content": []map[string]any{{"type": "text", "text": err.Error()}},
	}))
}
