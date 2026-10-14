// Fake PalmSystem / PalmServiceBridge for running Just Type headless.
//
// Loaded before enyo.js, so the real enyo.PalmService / enyo.DbService code
// runs unmodified and only the LS2 bridge underneath is replaced. Every call
// is recorded in FakeBus.calls; replies come from FakeBus.handlers, which are
// seeded from tests/fixtures/ (captured from a LuneOS device).

(function() {
	var loadJson = function(path) {
		var x = new XMLHttpRequest();
		x.open("GET", path, false);
		x.send(null);
		return JSON.parse(x.responseText);
	};

	var fixtures = {
		searchList: loadJson("fixtures/universalsearch-list.json"),
		searchPrefs: loadJson("fixtures/search-preferences.json"),
		launchPoints: loadJson("fixtures/launch-points.json"),
		installedApps: loadJson("fixtures/installed-apps.json")
	};

	var FakeBus = window.FakeBus = {
		fixtures: fixtures,
		calls: [],
		allCalls: [],	// never reset
		bridges: [],
		handlers: {},
		// "luna://com.foo/bar" and "palm://com.foo/bar/" -> "com.foo/bar"
		normalize: function(url) {
			return url.replace(/^(luna|palm):\/\//, "").replace(/\/+/g, "/").replace(/\/$/, "");
		},
		on: function(url, fn) {
			this.handlers[this.normalize(url)] = fn;
		},
		callsTo: function(url) {
			var n = this.normalize(url);
			return this.calls.filter(function(c) { return c.url == n; });
		},
		lastCallTo: function(url) {
			var c = this.callsTo(url);
			return c.length ? c[c.length - 1] : null;
		},
		reset: function() {
			this.calls.length = 0;
		},
		// Push a further reply to every live subscriber of url.
		publish: function(url, response) {
			var n = this.normalize(url);
			this.bridges.forEach(function(b) {
				if (b.url == n && !b.cancelled)
					b.reply(response);
			});
		}
	};

	window.PalmServiceBridge = function() {
		this.cancelled = false;
		FakeBus.bridges.push(this);
	};
	PalmServiceBridge.prototype.call = function(url, json) {
		this.url = FakeBus.normalize(url);
		var params = JSON.parse(json || "{}");
		FakeBus.calls.push({url: this.url, params: params});
		FakeBus.allCalls.push({url: this.url, params: params});
		var h = FakeBus.handlers[this.url];
		var response = h ? h(params) : {returnValue: false, errorCode: -1,
			errorText: "Unknown method (fake bus): " + this.url};
		if (response !== undefined)
			this.reply(response);
	};
	PalmServiceBridge.prototype.reply = function(response) {
		var self = this;
		setTimeout(function() {
			if (!self.cancelled && self.onservicecallback)
				self.onservicecallback(JSON.stringify(response));
		}, 0);
	};
	PalmServiceBridge.prototype.cancel = function() {
		this.cancelled = true;
	};

	window.PalmSystem = {
		launchParams: "{}",
		identifier: "com.palm.launcher 1000",
		version: "fake",
		deviceInfo: JSON.stringify({screenWidth: 800, screenHeight: 600, modelName: "fake"}),
		isActivated: true,
		launchFeedback: [],
		applyLaunchFeedback: function(x, y) { this.launchFeedback.push([x, y]); },
		stageReady: function() {},
		activate: function() {},
		deactivate: function() {},
		setWindowProperties: function() {},
		setWindowOrientation: function() {},
		receivePageUpDownInLandscape: function() {},
		enableFullScreenMode: function() {},
		addBannerMessage: function() { return 0; },
		removeBannerMessage: function() {},
		clearBannerMessages: function() {},
		playSoundNotification: function() {},
		keepAlive: function() {},
		shutdown: function() {},
		markFirstUseDone: function() {},
		simulateMouseClick: function() {},
		paste: function() {},
		copiedToClipboard: function() {},
		pastedFromClipboard: function() {},
		setManualKeyboardEnabled: function() {},
		keyboardShow: function() {},
		keyboardHide: function() {},
		getIdentifier: function() { return this.identifier; },
		// Synchronous file read the device WebKit provides; enyo uses it for config/g11n JSON.
		getResource: function(path, mode) {
			try {
				var x = new XMLHttpRequest();
				x.open("GET", path, false);
				x.send(null);
				if (!x.responseText)
					return undefined;
				return /json/.test(mode) ? JSON.parse(x.responseText) : x.responseText;
			} catch (e) {
				return undefined;
			}
		},
		locale: "en_us",
		localeRegion: "us",
		timeFormat: "HH12",
		timeZone: "Europe/Amsterdam",
		phoneRegion: "us",
		screenOrientation: "up",
		windowOrientation: "up"
	};

	// --- default luna handlers --------------------------------------------
	FakeBus.on("com.palm.universalsearch/getAllSearchPreference", function() {
		return fixtures.searchPrefs;
	});
	FakeBus.on("com.palm.universalsearch/getUniversalSearchList", function() {
		return fixtures.searchList;
	});
	FakeBus.on("com.webos.service.applicationManager/listLaunchPoints", function() {
		return fixtures.launchPoints;
	});
	FakeBus.on("com.palm.applicationManager/launchPointChanges", function() {
		return {returnValue: true, subscribed: true};
	});
	// Same matching luna-appmanager does: substring of title, case-insensitive.
	FakeBus.on("com.palm.applicationManager/searchApps", function(p) {
		var kw = (p.keyword || "").toLowerCase();
		var apps = fixtures.launchPoints.launchPoints.filter(function(lp) {
			return kw && (lp.title || "").toLowerCase().indexOf(kw) != -1;
		}).map(function(lp) { return {launchPoint: lp.launchPointId}; });
		return {returnValue: true, apps: apps};
	});
	// SAM launch: succeed only for apps that are actually installed.
	FakeBus.on("com.webos.service.applicationManager/launch", function(p) {
		if (fixtures.installedApps.indexOf(p.id) == -1)
			return {returnValue: false, errorCode: 2, errorText: "Cannot find proper launchPoint"};
		return {returnValue: true, appId: p.id};
	});
	FakeBus.on("com.palm.db/search", function() {
		return {returnValue: true, results: []};
	});
	FakeBus.on("com.palm.service.accounts/listAccounts", function() {
		return {returnValue: true, results: []};
	});
	FakeBus.on("com.palm.location/getAutoLocate", function() {
		return {returnValue: true, autoLocate: false};
	});

	// --- fake network for search-suggest web services ---------------------
	var RealXHR = window.XMLHttpRequest;
	FakeBus.httpRequests = [];
	FakeBus.httpHandler = function(url) { return [url, []]; };
	FakeBus.httpStatus = 200;
	window.XMLHttpRequest = function() {
		var real = new RealXHR(), fake = this, isHttp = false;
		this.open = function(method, url) {
			isHttp = /^https?:/.test(url);
			fake.url = url;
			if (!isHttp)
				return real.open.apply(real, arguments);
		};
		this.send = function(body) {
			if (!isHttp) {
				real.onreadystatechange = function() {
					fake.readyState = real.readyState;
					if (real.readyState == 4) {
						fake.status = real.status;
						fake.responseText = real.responseText;
					}
					fake.onreadystatechange && fake.onreadystatechange();
				};
				return real.send(body);
			}
			FakeBus.httpRequests.push(fake.url);
			setTimeout(function() {
				fake.readyState = 4;
				fake.status = FakeBus.httpStatus;
				fake.responseText = JSON.stringify(FakeBus.httpHandler(fake.url));
				fake.onreadystatechange && fake.onreadystatechange();
				fake.onload && fake.onload();
			}, 0);
		};
		this.setRequestHeader = function() { if (!isHttp) real.setRequestHeader.apply(real, arguments); };
		this.getResponseHeader = function(h) { return isHttp ? null : real.getResponseHeader(h); };
		this.getAllResponseHeaders = function() { return isHttp ? "" : real.getAllResponseHeaders(); };
		this.abort = function() { if (!isHttp) real.abort(); };
		this.overrideMimeType = function(m) { real.overrideMimeType && real.overrideMimeType(m); };
	};
})();
