// Copyright 2026 Kirill Scherba. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

// ui.go — the screen of the module.
//
// The page is rendered once, with the styles and the script inside it, and a <base> that the
// installation tells us (X-AnyText-Prefix). That is how the other modules do it, and the reason is
// practical: a separate app.js request resolves against the page address, and a page opened without
// the trailing slash asks for the wrong path — the installation answers with its own HTML, and the
// browser reports "Unexpected token '<'" in app.js (27.11.2026).
package main

import (
	"embed"
	"html/template"
	"net/http"
	"strings"
)

//go:embed ui/index.html ui/app.js ui/style.css
var uiFS embed.FS

var (
	pageTemplate = template.Must(template.ParseFS(uiFS, "ui/index.html"))
	pageStyle    = template.CSS(mustAsset("ui/style.css"))
	pageScript   = template.JS(mustAsset("ui/app.js"))
)

func mustAsset(name string) string {
	data, err := uiFS.ReadFile(name)
	if err != nil {
		return ""
	}
	return string(data)
}

// page renders the screen. The prefix is the module's public path inside the installation: every
// relative address of the page is resolved against it.
func (a *app) page(w http.ResponseWriter, r *http.Request) {
	prefix := r.Header.Get("X-AnyText-Prefix")
	if prefix == "" {
		prefix = "/api/module/goals"
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	_ = pageTemplate.Execute(w, map[string]any{
		"Prefix":  strings.TrimRight(prefix, "/"),
		"Version": version,
		"Style":   pageStyle,
		"Script":  pageScript,
	})
}
