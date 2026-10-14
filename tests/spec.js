// Just Type UI tests: drive the real app through its controls and check the
// luna calls that reach the (fake) bus. Run with tests/run.sh.

(function() {
	var SAM_LAUNCH = "com.webos.service.applicationManager/launch";
	var results = [];
	var steps = [];

	var test = function(name, fn) { steps.push({name: name, fn: fn}); };

	var assert = function(cond, msg) {
		if (!cond)
			throw new Error(msg);
	};
	var assertEq = function(actual, expected, msg) {
		var a = JSON.stringify(actual), e = JSON.stringify(expected);
		if (a !== e)
			throw new Error(msg + ": expected " + e + ", got " + a);
	};

	// Resolve once cond() is truthy, fail after timeout ms.
	var waitFor = function(cond, what, timeout) {
		return new Promise(function(resolve, reject) {
			var start = Date.now();
			(function poll() {
				var v;
				try { v = cond(); } catch (e) { v = false; }
				if (v)
					return resolve(v);
				if (Date.now() - start > (timeout || 3000))
					return reject(new Error("timed out waiting for " + what));
				setTimeout(poll, 20);
			})();
		});
	};

	var app = function() { return enyo.$.justTypeApp; };
	var jt = function() { return app().$.justType; };
	var mv = function() { return jt().$.mainView; };
	var las = function() { return mv().$.launchAndSearch; };

	var visible = function(control) {
		var n = control && control.hasNode();
		return !!(n && n.offsetParent !== null && control.getShowing());
	};

	// Real DOM event sequence, so enyo's dispatcher routes it like a tap.
	var tap = function(control) {
		var node = control.hasNode();
		assert(node, "no DOM node for " + control.name);
		["mousedown", "mouseup", "click"].forEach(function(type) {
			node.dispatchEvent(new MouseEvent(type, {bubbles: true, cancelable: true, view: window, button: 0}));
		});
	};

	var type = function(text) {
		jt().clearSearchText();
		jt().$.searchField.setValue(text);
		jt().onValueChange(jt().$.searchField, {}, text);
	};

	// Wait for the debounced search to reach MainView.
	var search = function(text) {
		FakeBus.reset();
		type(text);
		return waitFor(function() { return mv().getSearchTerm() == text; }, "search for '" + text + "'");
	};

	var waitLaunch = function(what) {
		return waitFor(function() { return FakeBus.lastCallTo(SAM_LAUNCH); }, "SAM launch for " + what);
	};

	var itemsOf = function(group, kindName) {
		var out = [];
		var walk = function(c) {
			if (c.kind == kindName || c.kindName == kindName || (window[kindName] && c instanceof window[kindName]))
				out.push(c);
			(c.getControls ? c.getControls() : []).forEach(walk);
		};
		walk(group);
		return out;
	};

	// AppMenu items are only created the first time the menu opens.
	var menuItem = function(caption) {
		jt().$.appMenu.open();
		var found = null;
		for (var n in jt().$) {
			var c = jt().$[n];
			if (c instanceof enyo.AppMenuItem && c.caption == caption)
				found = c;
		}
		return found;
	};

	var appRoot = new URL("../", location.href).href;
	var imageLoads = function(src) {
		src = new URL(src, appRoot).href;
		return new Promise(function(resolve) {
			var img = new Image();
			img.onload = function() { resolve(img.naturalWidth > 0); };
			img.onerror = function() { resolve(false); };
			img.src = src;
		});
	};

	// ---------------------------------------------------------------------

	test("startup subscribes to search preferences, search list and launch points", function() {
		return waitFor(function() { return las().getLaunchAndSearchEngines().length > 0; }, "search engine list").then(function() {
			assert(FakeBus.callsTo("com.palm.universalsearch/getAllSearchPreference").length, "no getAllSearchPreference");
			assert(FakeBus.callsTo("com.palm.universalsearch/getUniversalSearchList").length, "no getUniversalSearchList");
			assert(FakeBus.callsTo("com.webos.service.applicationManager/listLaunchPoints").length, "no listLaunchPoints");
		});
	});

	test("app menu: Preferences opens the Just Type settings page", function() {
		var item = menuItem("Preferences");
		assert(item, "no Preferences menu item");
		FakeBus.reset();
		tap(item.$.item);
		return waitLaunch("Preferences").then(function(c) {
			assert(!jt().$.appMenu.isOpen, "menu stayed open");
			assertEq(c.params.id, "org.webosports.app.settings.searchpreferences", "Preferences app id");
		});
	});

	test("app menu: Help opens the Settings help app", function() {
		var item = menuItem("Help");
		assert(item, "no Help menu item");
		FakeBus.reset();
		tap(item.$.item);
		return waitLaunch("Help").then(function(c) {
			assert(!jt().$.appMenu.isOpen, "menu stayed open");
			assertEq(c.params.id, "org.webosports.app.settings.help", "Help app id");
		});
	});

	test("default engine row searches Google in the browser", function() {
		return search("luneos").then(function() {
			return waitFor(function() { return visible(las().$.defaultSearchEngineGroup); }, "default engine row");
		}).then(function() {
			assertEq(las().$.searchSuggestLabel.getContent(), "Search Google", "default engine label");
			FakeBus.reset();
			tap(las().$.defaultSearchEngineItem);
			return waitLaunch("default engine");
		}).then(function(c) {
			assertEq(c.params, {id: "org.webosports.app.atlas", params: {target: "https://www.google.com/search?q=luneos"}}, "launch");
		});
	});

	test("'Search Using...' lists the other enabled engines and each one launches", function() {
		return search("luneos").then(function() {
			var items = itemsOf(las().$.launchAndSearchListGroup, "LaunchAndSearchItem");
			assertEq(items.map(function(i) { return i.getSearchInfo().id; }), ["wikipedia", "duckduckgo"], "listed engines");
			var expected = {
				wikipedia: "https://en.wikipedia.org/wiki/Special:Search?search=luneos",
				duckduckgo: "https://www.duckduckgo.com/?q=luneos"
			};
			return items.reduce(function(p, item) {
				return p.then(function() {
					FakeBus.reset();
					tap(item);
					return waitLaunch(item.getSearchInfo().id);
				}).then(function(c) {
					assertEq(c.params, {id: "org.webosports.app.atlas", params: {target: expected[item.getSearchInfo().id]}},
						item.getSearchInfo().id + " launch");
				});
			}, Promise.resolve());
		});
	});

	test("Enter with no app/contact hits searches the default engine", function() {
		return search("zzqxjw").then(function() {
			return waitFor(function() {
				return mv().currentHighlightedControlObj === las().$.defaultSearchEngineItem;
			}, "default engine highlighted");
		}).then(function() {
			FakeBus.reset();
			jt().handleKeyPress(jt().$.searchField, {keyCode: 13, preventDefault: function() {}, stopPropagation: function() {}});
			return waitLaunch("Enter");
		}).then(function(c) {
			assertEq(c.params, {id: "org.webosports.app.atlas", params: {target: "https://www.google.com/search?q=zzqxjw"}}, "launch");
		});
	});

	test("Suggest fetches suggestions and a suggestion opens in the browser", function() {
		FakeBus.httpRequests.length = 0;
		FakeBus.httpHandler = function() { return ["luneos", ["luneos phone", "luneos release"]]; };
		return search("luneos").then(function() {
			assert(visible(las().$.searchSuggestButton), "Suggest button hidden");
			tap(las().$.searchSuggestButton);
			return waitFor(function() { return las().$.drawer.getControls().length == 2; }, "suggestion rows");
		}).then(function() {
			assertEq(FakeBus.httpRequests[0], "https://www.google.com/complete/search?client=firefox&hl=en&q=luneos", "suggest URL");
			FakeBus.reset();
			tap(las().$.drawer.getControls()[0]);
			return waitLaunch("suggestion");
		}).then(function(c) {
			assertEq(c.params, {id: "org.webosports.app.atlas", params: {target: "https://www.google.com/search?q=luneos%20phone"}}, "launch");
		});
	});

	test("a failed Suggest request stops the spinner", function() {
		FakeBus.httpRequests.length = 0;
		FakeBus.httpStatus = 400;
		return search("luneosx").then(function() {
			las().$.drawer.setOpen(false);
			tap(las().$.searchSuggestButton);
			return waitFor(function() { return FakeBus.httpRequests.length == 1; }, "suggest request");
		}).then(function() {
			return waitFor(function() { return !las().$.searchSuggestSpinner.getShowing(); }, "spinner to stop");
		}).then(function() {
			FakeBus.httpStatus = 200;
		}, function(e) {
			FakeBus.httpStatus = 200;
			throw e;
		});
	});

	test("'More...' appears with a loadable icon when >4 engines are enabled, and expands the list", function() {
		var list = JSON.parse(JSON.stringify(FakeBus.fixtures.searchList));
		list.UniversalSearchList.forEach(function(e) { e.enabled = true; });
		list.UniversalSearchList.push({id: "noicon", displayName: "No Icon", url: "https://example.org/?q=#{searchTerms}", type: "web", enabled: true});
		FakeBus.publish("com.palm.universalsearch/getUniversalSearchList", list);
		var more;
		return waitFor(function() {
			var items = itemsOf(las().$.launchAndSearchListGroup, "LaunchAndSearchItem");
			more = items.filter(function(i) { return i.getSearchInfo().id == "moresearchitem"; })[0];
			return more;
		}, "More... row").then(function() {
			return imageLoads(more.$.icon.src);
		}).then(function(ok) {
			assert(ok, "More... icon does not load: " + more.$.icon.src);
			tap(more);
			return waitFor(function() {
				return itemsOf(las().$.launchAndSearchListGroup, "LaunchAndSearchItem").length == 6;
			}, "expanded engine list");
		}).then(function() {
			var noIcon = itemsOf(las().$.launchAndSearchListGroup, "LaunchAndSearchItem").filter(function(i) {
				return i.getSearchInfo().id == "noicon";
			})[0];
			return imageLoads(noIcon.$.icon.src);
		}).then(function(ok) {
			assert(ok, "fallback engine icon does not load");
			FakeBus.publish("com.palm.universalsearch/getUniversalSearchList", FakeBus.fixtures.searchList);
		});
	});

	test("'Go to website' opens the typed address in the browser", function() {
		var lit = mv().$.launchItems;
		return search("www.webos-ports.org").then(function() {
			assert(visible(lit.$.goToWeb), "Go to website row hidden");
			FakeBus.reset();
			tap(lit.$.goToWeb);
			return waitLaunch("Go to website");
		}).then(function(c) {
			assertEq(c.params, {id: "org.webosports.app.atlas", params: {target: "www.webos-ports.org"}}, "launch");
		});
	});

	test("app search result launches the app", function() {
		var lps = mv().$.launchPointSearch;
		return search("calcu").then(function() {
			return waitFor(function() { return lps.$.appContainer.getControls().length == 1; }, "Calculator icon");
		}).then(function() {
			assertEq(lps.$.appContainer.getControls()[0].appInfo.id, "org.webosports.app.calculator", "found app");
			FakeBus.reset();
			tap(lps.$.appContainer.getControls()[0]);
			return waitLaunch("Calculator");
		}).then(function(c) {
			assertEq(c.params.id, "org.webosports.app.calculator", "launched app");
		});
	});

	test("developer-mode easter egg launches the Developer Mode settings app", function() {
		var lps = mv().$.launchPointSearch;
		var lp = FakeBus.fixtures.launchPoints.launchPoints.filter(function(l) {
			return l.id == "org.webosports.app.settings.devmodeswitcher";
		})[0];
		return search("webos20090606").then(function() {
			return waitFor(function() { return lps.$.appContainer.getControls().length == 1; }, "easter egg icon");
		}).then(function() {
			var c = lps.$.appContainer.getControls()[0];
			assertEq(c.appInfo.icon, lp.icon, "easter egg icon path");
			FakeBus.reset();
			tap(c);
			return waitLaunch("easter egg");
		}).then(function(c) {
			assertEq(c.params.id, "org.webosports.app.settings.devmodeswitcher", "launched app");
		});
	});

	test("email address offers the email quick action, which composes to it", function() {
		var list = JSON.parse(JSON.stringify(FakeBus.fixtures.searchList));
		list.ActionList = [{id: "com.palm.app.email", displayName: "New Email", url: "com.palm.app.email",
			launchParam: "{\"summary\":\"#{searchTerms}\"}", enabled: true, iconFilePath: "images/search-email.png"}];
		FakeBus.publish("com.palm.universalsearch/getUniversalSearchList", list);
		var acts = mv().$.actions;
		return waitFor(function() { return itemsOf(acts.$.actionListGroup, "ActionItem").length == 1; }, "action row").then(function() {
			FakeBus.reset();
			type("someone@webos-ports.org");
			return waitFor(function() { return acts.getPossibleActionItem() == "emailorweb"; }, "email detection");
		}).then(function() {
			tap(itemsOf(acts.$.actionListGroup, "ActionItem")[0]);
			return waitLaunch("email action");
		}).then(function(c) {
			assertEq(c.params, {id: "com.palm.app.email", params: {target: "mailto:someone@webos-ports.org"}}, "launch");
			FakeBus.publish("com.palm.universalsearch/getUniversalSearchList", FakeBus.fixtures.searchList);
		});
	});

	test("contact detail rows launch email, phone, messaging and contacts", function() {
		var host = new enyo.Control({});
		var row = function(details) {
			return host.createComponent({kind: "ContactDrawerItem", contactDetails: details, owner: host});
		};
		var cases = [
			[{addrType: "email", x_value: "a@b.org", contactId: "p1"},
				{id: "com.palm.app.email", params: {target: "mailto:a@b.org"}}],
			[{addrType: "phone", x_value: "5551234", contactId: "p1", x_type: "mobile"},
				{id: "org.webosports.app.phone", params: {address: "5551234", personId: "p1", label: "mobile", service: "phone", transport: "com.palm.telephony"}}],
			[{addrType: "im", x_value: "bob", contactId: "p1", x_type: "type_jabber"},
				{id: "org.webosports.app.messaging", params: {compose: {ims: [{value: "bob", type: "type_jabber"}], personId: "p1"}}}],
			[{addrType: "contact", contactId: "p1"},
				{id: "com.palm.app.contacts", params: {id: "p1", launchType: "showPerson"}}]
		];
		return cases.reduce(function(p, tc) {
			return p.then(function() {
				FakeBus.reset();
				var r = row(tc[0]);
				r.clickHandler(r, {target: r.hasNode && r.hasNode()});
				return waitLaunch(tc[0].addrType);
			}).then(function(c) {
				assertEq(c.params, tc[1], tc[0].addrType + " launch");
			});
		}, Promise.resolve());
	});

	test("every launch reached an installed app and nothing used the legacy open API", function() {
		var all = FakeBus.allCalls;
		var launches = all.filter(function(c) { return c.url == SAM_LAUNCH; });
		assert(launches.length >= 15, "too few launches recorded: " + launches.length);
		launches.forEach(function(c) {
			assert(FakeBus.fixtures.installedApps.indexOf(c.params.id) != -1, "launch of app that is not installed: " + c.params.id);
		});
		var legacy = all.filter(function(c) { return c.url == "com.palm.applicationManager/open"; });
		assertEq(legacy.length, 0, "calls to com.palm.applicationManager/open");
	});

	// ---------------------------------------------------------------------

	var errors = [];
	window.addEventListener("error", function(e) { errors.push(e.message + " @ " + e.filename + ":" + e.lineno); });

	window.runSpecs = function() {
		var report = function() {
			var failed = results.filter(function(r) { return !r.ok; }).length;
			var lines = results.map(function(r) { return (r.ok ? "ok   " : "FAIL ") + r.name + (r.ok ? "" : "\n       " + r.error); });
			errors.forEach(function(e) { lines.push("JS ERROR " + e); });
			lines.push("SUMMARY " + (results.length - failed) + "/" + results.length + " passed, " + errors.length + " uncaught JS errors");
			var pre = document.createElement("pre");
			pre.id = "spec-results";
			pre.textContent = "@@RESULTS@@\n" + lines.join("\n") + "\n@@END@@";
			document.body.appendChild(pre);
		};
		steps.reduce(function(p, s) {
			return p.then(function() {
				return Promise.resolve().then(s.fn).then(function() {
					results.push({name: s.name, ok: true});
				}, function(e) {
					results.push({name: s.name, ok: false, error: e && e.message || String(e)});
				});
			});
		}, Promise.resolve()).then(report, report);
	};
})();
