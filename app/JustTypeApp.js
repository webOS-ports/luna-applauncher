// @@@LICENSE
//
//      Copyright (c) 2010-2013 LG Electronics, Inc.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
//
// LICENSE@@@

enyo.kind({
	name:"JustTypeApp",
	kind:"Pane",
	components:[
	            {kind:"JustType"},
	            {kind:"AppLauncher"},
	            {kind: "ApplicationEvents", onWindowActivated: "handleWindowActivate", onWindowDeactivated:"handleWindowDeActivated"}
	            ],
	create:function() {
		this.inherited(arguments);
		/*
		 * The card shell shows and hides this window by sliding it in and out,
		 * so it is never activated or deactivated as a stage and
		 * handleWindowActivate() does not run. All it gets is the focus.
		 *
		 * That focus brings the field's own focus back with it, and focus that
		 * is restored does not ask for the on-screen keyboard: the field has
		 * the caret, a hardware keyboard types into it, and no keyboard
		 * appears until the field is tapped. A focus() call does ask, so make
		 * one as soon as the focus has arrived.
		 */
		this.composing = false;
		this.keyboardJob = null;
		window.addEventListener("focus", enyo.bind(this, "windowFocused"));
		window.addEventListener("blur", enyo.bind(this, "cancelKeyboardJob"));
	},

	rendered: function() {
		this.inherited(arguments);
		var node = this.searchNode();
		if (node && !node.justTypeComposition) {
			node.justTypeComposition = true;
			node.addEventListener("compositionstart", enyo.bind(this, function() { this.composing = true; }));
			node.addEventListener("compositionend", enyo.bind(this, function() { this.composing = false; }));
		}
	},

	searchNode: function() {
		return this.$.justType.$.searchField.$.input.hasNode();
	},

	windowFocused: function() {
		this.cancelKeyboardJob();
		// After the focus event, once the focus it restores is in place.
		this.keyboardJob = setTimeout(enyo.bind(this, "askForKeyboard"), 0);
	},

	cancelKeyboardJob: function() {
		if (this.keyboardJob) {
			clearTimeout(this.keyboardJob);
			this.keyboardJob = null;
		}
	},

	askForKeyboard: function() {
		this.keyboardJob = null;
		var node = this.searchNode();
		if (!node || !document.hasFocus())
			return;
		if (document.activeElement !== node) {
			node.focus();
			return;
		}
		// Taking the focus away would end what is being composed.
		if (this.composing)
			return;
		// Keep the caret where it is, so what a hardware keyboard has already
		// typed stays in order with what comes next.
		var selection = window.getSelection();
		var range = selection.rangeCount ? selection.getRangeAt(0).cloneRange() : null;
		node.blur();
		node.focus();
		if (range) {
			selection.removeAllRanges();
			selection.addRange(range);
		}
	},

	handleWindowActivate: function() {
		this.$.justType.forceFocus();
		this.$.justType.$.mainView.initializeControllerState();
	},
	
	handleWindowDeActivated: function() {
		this.$.justType.justTypeDeactivated();
	}
	            
});
