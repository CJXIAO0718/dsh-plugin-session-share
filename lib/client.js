window.__ModuleLoader__.load({
	id: "dsh-plugin-session-share",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let jsx_runtime = require("react/jsx-runtime");
		let primitives = require("@deepseek-ai/dsh-client-ui-primitives");
		const jsx = jsx_runtime.jsx;
		//#region lib/types/client/constants.js
		/** Browser-relative form of the Host route that renders one Session as a standalone document. */
		const SHARE_HTML_ROUTE = "/api/session.shareHtml".slice(1);
		/** Browser-relative form of the Host route that lists one Session's shareable messages. */
		const SHARE_INDEX_ROUTE = "/api/session.shareIndex".slice(1);
		/** Session Header contribution list this plugin adds one action to. */
		const SLOT = "conversation.session.header.utilities";
		/** Locale namespace owned by the share-as-HTML action. */
		const NS = "sessionShareHtml";
		const PREVIEW_ITEM = "preview";
		const DOWNLOAD_ITEM = "download";
		const PICK_ITEM = "pick";
		const ERROR_ITEM = "share-html-error";
		//#endregion
		//#region lib/types/client/primitives.js
		/**
		* Read one host primitive, treating any missing export as absent instead of throwing at load time.
		* @param name - export name on the primitives package.
		* @returns the primitive component, or null when this host build does not export it.
		*/
		function take(name) {
			const value = primitives === void 0 || primitives === null ? void 0 : primitives[name];
			return typeof value === "function" ? value : null;
		}
		/** Share-semantics icon exports to probe, best first: a host build ships at most one of them. */
		const SHARE_ICON_NAMES = ["IconShareOutlineRegular", "IconShareArrowOutlineRegular", "IconArrowUpFromSquareOutlineRegular", "IconArrowUpRightOutlineRegular", "IconSendOutlineRegular", "IconUploadOutlineRegular"];
		/** First share icon this host build exports, or null when it exports none of them. */
		const IconShare = (() => {
			for (let index = 0; index < SHARE_ICON_NAMES.length; index += 1) {
				const candidate = take(SHARE_ICON_NAMES[index]);
				if (candidate !== null) return candidate;
			}
			return null;
		})();
		/**
		* Three-node share glyph stroked with the current text colour, so the trigger keeps a share shape
		* even on a host build that exports no share icon at all.
		* @returns a 24x24 outline svg element.
		*/
		function shareGlyph() {
			return jsx("svg", {
				viewBox: "0 0 24 24",
				width: "15",
				height: "15",
				fill: "none",
				stroke: "currentColor",
				strokeWidth: "1.8",
				strokeLinecap: "round",
				strokeLinejoin: "round",
				"aria-hidden": "true",
				focusable: "false",
				children: [
					jsx("circle", { cx: "18", cy: "5.5", r: "2.6", key: "to" }),
					jsx("circle", { cx: "6", cy: "12", r: "2.6", key: "from" }),
					jsx("circle", { cx: "18", cy: "18.5", r: "2.6", key: "back" }),
					jsx("path", { d: "M8.3 10.6 15.7 6.9M8.3 13.4l7.4 4.5", key: "links" })
				]
			});
		}
		/** @returns the trigger visual: the host share icon, else the inline share glyph. */
		function shareIconElement() {
			return IconShare !== null ? jsx(IconShare, {}) : shareGlyph();
		}
		//#endregion

		//#region lib/types/client/css.js
		const css = [
				"._shareHtml_fallback{position:relative;display:inline-flex;align-items:center;justify-content:center;flex:none;width:28px;height:24px}",
				"._shareHtml_trigger{display:inline-flex;align-items:center;justify-content:center;flex:none;width:28px;height:24px;padding:0;border:none;border-radius:6px;background:transparent;color:inherit;font:inherit;line-height:1;cursor:pointer}",
				"._shareHtml_trigger svg{width:15px;height:15px;display:block}",
				"._shareHtml_trigger[aria-busy=\"true\"]{opacity:.55;cursor:progress}",
				"._shareHtml_portal{position:fixed;top:0;left:0;width:0;height:0;overflow:visible;z-index:2147483000}",
				"._shareHtml_fixed{position:fixed;top:0;left:0;width:0;height:0;overflow:visible;z-index:2147483000}",
				"._shareHtml_menu{position:fixed;top:0;right:0;z-index:2147483000;min-width:190px;display:flex;flex-direction:column;gap:2px;padding:4px;border-radius:8px;border:1px solid color-mix(in srgb,currentColor 22%,transparent);background:color-mix(in srgb,currentColor 8%,transparent);color:inherit;backdrop-filter:blur(6px);box-shadow:0 8px 24px color-mix(in srgb,currentColor 16%,transparent)}",
				"._shareHtml_item{display:flex;align-items:center;gap:8px;width:100%;padding:6px 8px;border:none;border-radius:6px;background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer}",
				"._shareHtml_item:hover:enabled{background:color-mix(in srgb,currentColor 12%,transparent)}",
				"._shareHtml_item:disabled{opacity:.55;cursor:default}",
				"._shareHtml_error{padding:4px 8px;font-size:12px;color:var(--dsw-alias-state-error-primary,CanvasText)}",
				"._shareHtml_overlay{position:fixed;inset:0;z-index:2147483001;display:flex;align-items:center;justify-content:center;padding:48px 40px;background:color-mix(in srgb,currentColor 55%,transparent);backdrop-filter:blur(2px)}",
				"._shareHtml_previewPanel{position:relative;display:flex;flex-direction:column;width:100%;height:100%;min-width:0;min-height:0;overflow:hidden;border-radius:12px;border:1px solid color-mix(in srgb,CanvasText 18%,transparent);background:Canvas;color:var(--dsw-alias-label-primary,CanvasText);box-shadow:0 16px 48px color-mix(in srgb,currentColor 24%,transparent)}",
				"._shareHtml_previewBar{display:flex;align-items:center;gap:8px;flex:none;height:48px;padding:0 16px;border-bottom:1px solid color-mix(in srgb,CanvasText 12%,transparent)}",
				"._shareHtml_previewTitle{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:14px;color:color-mix(in srgb,CanvasText 72%,transparent)}",
				"._shareHtml_previewActions{display:flex;align-items:center;gap:8px;flex:none;margin-left:auto}",
				"._shareHtml_previewBody{display:flex;flex:1;min-height:0;overflow:hidden}",
				"._shareHtml_frame{display:block;flex:1;width:100%;height:100%;min-height:0;border:none;background:Canvas}",
				"._shareHtml_close{display:inline-flex;align-items:center;justify-content:center;flex:none;width:32px;height:32px;padding:0;border:1px solid color-mix(in srgb,CanvasText 18%,transparent);border-radius:8px;background:transparent;color:inherit;font:inherit;font-size:18px;line-height:1;cursor:pointer}",
				"._shareHtml_close:hover{background:color-mix(in srgb,CanvasText 10%,transparent)}",
				"._shareHtml_close:focus-visible{outline:2px solid color-mix(in srgb,CanvasText 55%,transparent)}",
				"._shareHtml_download{display:inline-flex;align-items:center;justify-content:center;flex:none;height:32px;padding:0 12px;border:1px solid color-mix(in srgb,CanvasText 18%,transparent);border-radius:8px;background:transparent;color:inherit;font:inherit;font-size:13px;line-height:1;cursor:pointer}",
				"._shareHtml_download:hover{background:color-mix(in srgb,CanvasText 10%,transparent)}",
				"._shareHtml_download:focus-visible{outline:2px solid color-mix(in srgb,CanvasText 55%,transparent)}",
				"._shareHtml_picker{position:fixed;inset:0;z-index:2147483001;display:flex;align-items:center;justify-content:center;padding:48px 40px;background:color-mix(in srgb,currentColor 55%,transparent);backdrop-filter:blur(2px)}",
				"._shareHtml_pickerPanel{position:relative;display:flex;flex-direction:column;gap:12px;width:min(720px,92vw);max-width:100%;max-height:100%;padding:20px;border-radius:12px;border:1px solid color-mix(in srgb,CanvasText 16%,transparent);background:Canvas;color:var(--dsw-alias-label-primary,CanvasText);box-shadow:0 16px 48px color-mix(in srgb,currentColor 24%,transparent)}",
				"._shareHtml_pickerHead{display:flex;align-items:center;gap:8px;flex:none;height:48px;margin:-20px -20px 0;padding:0 20px;border-bottom:1px solid color-mix(in srgb,CanvasText 12%,transparent);font-weight:600}",
				"._shareHtml_pickerTitle{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
				"._shareHtml_pickerClose{display:inline-flex;align-items:center;justify-content:center;flex:none;margin-left:auto;width:32px;height:32px;padding:0;border:1px solid color-mix(in srgb,CanvasText 18%,transparent);border-radius:8px;background:transparent;color:inherit;font:inherit;font-size:18px;line-height:1;cursor:pointer}",
				"._shareHtml_pickerClose:hover{background:color-mix(in srgb,CanvasText 10%,transparent)}",
				"._shareHtml_pickerClose:focus-visible{outline:2px solid color-mix(in srgb,CanvasText 55%,transparent)}",
				"._shareHtml_pickerTools{display:flex;align-items:center;gap:8px;flex-wrap:wrap}",
				"._shareHtml_pickerTool{padding:5px 10px;border:1px solid color-mix(in srgb,CanvasText 22%,transparent);border-radius:8px;background:transparent;color:inherit;font:inherit;font-size:12px;line-height:1.4;cursor:pointer}",
				"._shareHtml_pickerTool:hover:enabled{background:color-mix(in srgb,CanvasText 10%,transparent)}",
				"._shareHtml_pickerTool:disabled{opacity:.45;cursor:default}",
				"._shareHtml_primary{padding:7px 16px;border:none;border-radius:8px;background:color-mix(in srgb,CanvasText 88%,transparent);color:Canvas;font:inherit;font-size:13px;font-weight:600;line-height:1.4;cursor:pointer}",
				"._shareHtml_primary:hover:enabled{background:color-mix(in srgb,CanvasText 96%,transparent)}",
				"._shareHtml_primary:disabled{opacity:.45;cursor:default}",
				"._shareHtml_pickerCount{margin-left:auto;font-size:12px;color:color-mix(in srgb,CanvasText 62%,transparent)}",
				"._shareHtml_pickerList{display:flex;flex-direction:column;max-height:60vh;overflow:auto;padding:2px 0}",
				"._shareHtml_pickerRow{display:flex;align-items:flex-start;gap:10px;width:100%;padding:10px 12px;border:none;border-bottom:1px solid color-mix(in srgb,CanvasText 10%,transparent);border-radius:8px;background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer}",
				"._shareHtml_pickerRow:hover{background:color-mix(in srgb,CanvasText 7%,transparent)}",
				"._shareHtml_pickerRow:focus-visible{outline:2px solid color-mix(in srgb,CanvasText 55%,transparent);outline-offset:-2px}",
				"._shareHtml_pickerRow[aria-checked=\"true\"]{background:color-mix(in srgb,CanvasText 12%,transparent)}",
				"._shareHtml_pickerRow[data-kind=\"assistant\"]{background:transparent;box-shadow:none}",
				"._shareHtml_pickerRow[data-kind=\"user\"]{background:color-mix(in srgb,var(--dsw-alias-state-business-primary,CanvasText) 6%,transparent);box-shadow:inset 3px 0 0 color-mix(in srgb,var(--dsw-alias-state-business-primary,CanvasText) 70%,transparent)}",
				"._shareHtml_pickerRow[data-kind=\"user\"]:hover{background:color-mix(in srgb,var(--dsw-alias-state-business-primary,CanvasText) 13%,transparent)}",
				"._shareHtml_pickerRow[data-kind=\"user\"][aria-checked=\"true\"]{background:color-mix(in srgb,var(--dsw-alias-state-business-primary,CanvasText) 21%,transparent)}",
				"._shareHtml_pickerRow[data-kind=\"user\"]:focus-visible{outline:2px solid color-mix(in srgb,var(--dsw-alias-state-business-primary,CanvasText) 68%,transparent);outline-offset:-2px}",
				"._shareHtml_pickerCheck{flex:none;margin:3px 0 0}",
				"._shareHtml_pickerBody{display:flex;flex-direction:column;gap:2px;flex:1;min-width:0}",
				"._shareHtml_pickerLine{display:flex;align-items:center;gap:8px;min-width:0}",
				"._shareHtml_pickerWhoUser{display:inline-flex;align-items:center;justify-content:flex-start;gap:6px;flex:none;min-width:52px;padding:1px 9px;border-radius:999px;background:color-mix(in srgb,var(--dsw-alias-state-business-primary,CanvasText) 76%,CanvasText);color:Canvas;font-size:12px;font-weight:600;line-height:1.6;white-space:nowrap}",
				"._shareHtml_pickerWhoAssistant{display:inline-flex;align-items:center;justify-content:flex-start;gap:6px;flex:none;min-width:52px;padding:1px 9px;border-radius:999px;border:1px solid color-mix(in srgb,CanvasText 26%,transparent);background:transparent;color:color-mix(in srgb,CanvasText 86%,transparent);font-size:12px;font-weight:400;line-height:1.6;white-space:nowrap}",
				"._shareHtml_pickerMarkUser{width:7px;height:7px;flex:none;border-radius:2px;background:Canvas;transform:rotate(45deg)}",
				"._shareHtml_pickerMarkAssistant{width:9px;height:9px;flex:none;border-radius:50%;background:var(--dsw-alias-state-business-primary,CanvasText);box-shadow:0 0 0 2px color-mix(in srgb,var(--dsw-alias-state-business-primary,CanvasText) 22%,transparent)}",
				"._shareHtml_pickerWhoName{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
				"._shareHtml_pickerLabel{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:14px;line-height:1.5}",
				"._shareHtml_pickerMeta{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;line-height:1.5;color:color-mix(in srgb,currentColor 62%,transparent)}",
				"._shareHtml_pickerStatus{font-size:12px;color:var(--dsw-alias-state-error-primary,CanvasText)}",
				"._shareHtml_pickerHint{font-size:12px;color:color-mix(in srgb,currentColor 62%,transparent)}",
				"._shareHtml_pickerFooter{display:flex;align-items:center;justify-content:flex-end;gap:8px;padding-top:12px;border-top:1px solid color-mix(in srgb,CanvasText 12%,transparent)}"
		].join("");

		const cssTagId = "share-html";
		const classes = {
			fallback: "_shareHtml_fallback",
			trigger: "_shareHtml_trigger",
			menu: "_shareHtml_menu",
			item: "_shareHtml_item",
			error: "_shareHtml_error",
			portal: "_shareHtml_portal",
			fixed: "_shareHtml_fixed",
			overlay: "_shareHtml_overlay",
			previewPanel: "_shareHtml_previewPanel",
			previewBar: "_shareHtml_previewBar",
			previewTitle: "_shareHtml_previewTitle",
			previewActions: "_shareHtml_previewActions",
			previewBody: "_shareHtml_previewBody",
			frame: "_shareHtml_frame",
			close: "_shareHtml_close",
			download: "_shareHtml_download",
			picker: "_shareHtml_picker",
			pickerPanel: "_shareHtml_pickerPanel",
			pickerHead: "_shareHtml_pickerHead",
			pickerTitle: "_shareHtml_pickerTitle",
			pickerClose: "_shareHtml_pickerClose",
			pickerTools: "_shareHtml_pickerTools",
			pickerTool: "_shareHtml_pickerTool",
			primary: "_shareHtml_primary",
			pickerCount: "_shareHtml_pickerCount",
			pickerList: "_shareHtml_pickerList",
			pickerRow: "_shareHtml_pickerRow",
			pickerCheck: "_shareHtml_pickerCheck",
			pickerBody: "_shareHtml_pickerBody",
			pickerLine: "_shareHtml_pickerLine",
			whoUser: "_shareHtml_pickerWhoUser",
			whoAssistant: "_shareHtml_pickerWhoAssistant",
			whoName: "_shareHtml_pickerWhoName",
			markUser: "_shareHtml_pickerMarkUser",
			markAssistant: "_shareHtml_pickerMarkAssistant",
			pickerLabel: "_shareHtml_pickerLabel",
			pickerMeta: "_shareHtml_pickerMeta",
			pickerStatus: "_shareHtml_pickerStatus",
			pickerHint: "_shareHtml_pickerHint",
			pickerFooter: "_shareHtml_pickerFooter"
		};

		/** Inject this plugin's stylesheet once per document. */
		function injectCss() {
			if (typeof document === "undefined" || document === null) return;
			if (typeof document.querySelector === "function" && document.querySelector("style[data-plugin-css=" + JSON.stringify(cssTagId) + "]") !== null) return;
			const tag = document.createElement("style");
			tag.dataset.plugin = cssTagId;
			tag.dataset.pluginCss = cssTagId;
			tag.textContent = css;
			if (document.head !== void 0 && document.head !== null && typeof document.head.appendChild === "function") document.head.appendChild(tag);
		}
		injectCss();
		//#endregion
		//#region lib/types/client/actions.js
		/**
		* Collapse an untrusted Session id into the download filename owned by the Host endpoint.
		* @param sessionId - Session being shared.
		* @returns one safe browser download filename.
		*/
		function shareFilename(sessionId) {
			return "dsh-session-" + String(sessionId).replace(/[^A-Za-z0-9_-]/g, "_") + ".html";
		}
		/**
		* Build the document-relative Host URL for one share request.
		* @param sessionId - Session being shared.
		* @param download - whether the Host should answer as an attachment.
		* @returns the query-bearing route.
		*/
		function shareUrl(sessionId, download) {
			const query = "?sessionId=" + encodeURIComponent(String(sessionId));
			return SHARE_HTML_ROUTE + query + (download === true ? "&download=1" : "");
		}
		/**
		* Build the document-relative Host URL that lists one Session's shareable messages.
		* @param sessionId - Session being shared.
		* @returns the query-bearing index route.
		*/
		function shareIndexUrl(sessionId) {
			return SHARE_INDEX_ROUTE + "?sessionId=" + encodeURIComponent(String(sessionId));
		}
		/**
		* Build the render URL restricted to an explicit selection.
		* @param sessionId - Session being shared.
		* @param ids - entry ids in list order, each already shaped like m12.
		* @returns the query-bearing render route carrying the pick list.
		*/
		function sharePickUrl(sessionId, ids) {
			return SHARE_HTML_ROUTE + "?sessionId=" + encodeURIComponent(String(sessionId)) + "&pick=" + ids.join(",");
		}
		/**
		* Append one portalled layer to the best document host this build offers.
		* @param node - the layer to attach.
		* @returns whether a host accepted it.
		*/
		function appendLayer(node) {
			try {
				if (canPortal() === true) {
					document.body.appendChild(node);
					return true;
				}
			} catch (cause) {
				noteFailure("layer body append refused", cause);
			}
			try {
				if (typeof document !== "undefined" && document !== null && document.documentElement !== void 0 && document.documentElement !== null && typeof document.documentElement.appendChild === "function") {
					document.documentElement.appendChild(node);
					return true;
				}
			} catch (cause) {
				noteFailure("layer root append refused", cause);
			}
			return false;
		}
		/**
		* Hand an already-verified URL to the browser download manager.
		* @param url - document-relative Host download route.
		* @param filename - browser download filename.
		*/
		function startDownload(url, filename) {
			const anchor = document.createElement("a");
			anchor.href = url;
			anchor.download = filename;
			anchor.rel = "noopener";
			anchor.click();
		}
		/**
		* @param status - HTTP status, or 0 for a transport failure.
		* @returns an Error carrying that status for the menu label.
		*/
		function httpFailure(status) {
			const failure = new Error(status === 0 ? "network-error" : "HTTP " + status);
			failure.status = status;
			return failure;
		}
		/** @param error - anything a rejected promise may carry. @returns a display string. */
		function messageOf(error) {
			return error instanceof Error ? error.message : String(error);
		}
		/** @param error - anything a rejected promise may carry. @returns the menu label for that failure. */
		function failureLabel(error) {
			const status = error !== null && error !== void 0 && typeof error.status === "number" && error.status > 0 ? error.status : 0;
			return status === 0 ? messageOf(error) : "HTTP " + status;
		}
		/**
		* Cheap same-origin pre-flight of the render route; cookies ride along automatically.
		* @param url - document-relative Host route.
		* @returns a promise settling with the response, or rejecting with the HTTP status.
		*/
		function probe(url) {
			return fetch(url, { method: "HEAD" }).then((response) => {
				if (response !== void 0 && response !== null && response.ok === true) return response;
				throw httpFailure(response !== void 0 && response !== null && typeof response.status === "number" ? response.status : 0);
			});
		}
		/** @param node - node to pull out of the document. */
		function detachNode(node) {
			if (node === null || node === void 0) return;
			if (typeof node.remove === "function") {
				node.remove();
				return;
			}
			const parent = node.parentNode;
			if (parent !== null && parent !== void 0 && typeof parent.removeChild === "function") parent.removeChild(node);
		}
		/**
		* Containment test that tolerates detached nodes and DOM stubs.
		* @param node - candidate ancestor.
		* @param target - candidate descendant.
		* @returns whether target sits inside node.
		*/
		function containsNode(node, target) {
			if (node === null || node === void 0 || target === null || target === void 0) return false;
			if (node === target) return true;
			return typeof node.contains === "function" && node.contains(target) === true;
		}
		/** @returns whether this document can host a portalled layer. */
		function canPortal() {
			return typeof document !== "undefined" && document !== null && typeof document.createElement === "function" && document.body !== void 0 && document.body !== null && typeof document.body.appendChild === "function";
		}
		/**
		* Read the viewport box of the menu trigger.
		* @param node - element the menu is anchored to.
		* @returns the box, or null when layout is unavailable.
		*/
		function triggerRect(node) {
			if (node === null || node === void 0 || typeof node.getBoundingClientRect !== "function") return null;
			const rect = node.getBoundingClientRect();
			if (rect === null || rect === void 0 || typeof rect.bottom !== "number" || typeof rect.right !== "number") return null;
			return rect;
		}
		/**
		* Right-align a viewport-anchored menu under its trigger.
		* @param rect - trigger box, or null to keep the in-flow CSS anchor.
		* @returns the inline style carrying the viewport coordinates.
		*/
		function menuStyle(rect) {
			if (rect === null) return void 0;
			const width = typeof window !== "undefined" && window !== null && typeof window.innerWidth === "number" ? window.innerWidth : 0;
			return {
				position: "fixed",
				top: Math.round(rect.bottom + 6) + "px",
				right: Math.round(Math.max(0, width - rect.right)) + "px",
				zIndex: "2147483000"
			};
		}
		//#endregion
		//#region lib/types/client/preview.js
		/** @returns the missing API the in-app preview layer needs, or null when it can run. */
		function previewBlocker() {
			if (typeof Blob !== "function") return "Blob";
			if (typeof URL === "undefined" || URL === null || typeof URL.createObjectURL !== "function" || typeof URL.revokeObjectURL !== "function") return "createObjectURL";
			if (typeof document === "undefined" || document === null || document.body === void 0 || document.body === null) return "document";
			return null;
		}
		/**
		* Mount the full-viewport preview layer for one rendered document. The mask keeps the panel
		* away from every viewport edge, and both buttons sit inside the panel's own top-right corner,
		* so they never land on the window controls of a desktop host.
		* @param text - HTML document text fetched from the render route.
		* @param target - element that opened the layer; focus returns here on close.
		* @param action - optional download offer plus the localized bar labels.
		* @returns a teardown function that forgets the blob URL and restores focus.
		*/
		function mountPreview(text, target, action) {
			const previous = document.activeElement;
			const focusBack = target !== null && target !== void 0 && typeof target.focus === "function" ? target : previous;
			const offer = action !== void 0 && action !== null && typeof action.url === "string" && action.url !== "" ? action : null;
			const objectUrl = URL.createObjectURL(new Blob([text], { type: "text/html" }));
			const overlay = document.createElement("div");
			overlay.className = classes.overlay;
			overlay.setAttribute("role", "dialog");
			overlay.setAttribute("aria-modal", "true");
			const panel = document.createElement("div");
			panel.className = classes.previewPanel;
			const bar = document.createElement("div");
			bar.className = classes.previewBar;
			const heading = document.createElement("span");
			heading.className = classes.previewTitle;
			heading.textContent = offer === null || typeof offer.title !== "string" ? "" : offer.title;
			bar.appendChild(heading);
			const actions = document.createElement("div");
			actions.className = classes.previewActions;
			bar.appendChild(actions);
			panel.appendChild(bar);
			const body = document.createElement("div");
			body.className = classes.previewBody;
			const frame = document.createElement("iframe");
			frame.className = classes.frame;
			frame.setAttribute("sandbox", "allow-same-origin");
			frame.setAttribute("title", "HTML preview");
			frame.src = objectUrl;
			body.appendChild(frame);
			panel.appendChild(body);
			const dismiss = document.createElement("button");
			dismiss.setAttribute("type", "button");
			dismiss.className = classes.close;
			dismiss.setAttribute("aria-label", offer === null || typeof offer.closeLabel !== "string" ? "Close" : offer.closeLabel);
			dismiss.setAttribute("title", dismiss.getAttribute("aria-label"));
			dismiss.textContent = "×";
			if (offer !== null) {
				const save = document.createElement("button");
				save.setAttribute("type", "button");
				save.className = classes.download;
				save.setAttribute("aria-label", typeof offer.label === "string" ? offer.label : "Download");
				save.textContent = typeof offer.label === "string" ? offer.label : "Download";
				save.addEventListener("click", () => {
					note("preview download", { url: offer.url });
					startDownload(offer.url, typeof offer.filename === "string" ? offer.filename : shareFilename("session"));
				});
				actions.appendChild(save);
			}
			actions.appendChild(dismiss);
			overlay.appendChild(panel);
			let disposed = false;
			function teardown() {
				if (disposed === true) return;
				disposed = true;
				if (typeof document.removeEventListener === "function") document.removeEventListener("keydown", onKeyDown, true);
				detachNode(overlay);
				if (typeof URL.revokeObjectURL === "function") URL.revokeObjectURL(objectUrl);
				if (focusBack !== null && focusBack !== void 0 && typeof focusBack.focus === "function") focusBack.focus();
			}
			function onKeyDown(event) {
				if (event !== null && event !== void 0 && (event.key === "Escape" || event.key === "Esc")) teardown();
			}
			overlay.addEventListener("click", (event) => {
				if (event !== null && event !== void 0 && event.target === overlay) teardown();
			});
			dismiss.addEventListener("click", () => {
				teardown();
			});
			if (typeof document.addEventListener === "function") document.addEventListener("keydown", onKeyDown, true);
			document.body.appendChild(overlay);
			return teardown;
		}
		/**
		* Read a render-route answer as document text.
		* @param response - fetch response for the share route.
		* @returns the HTML text, rejecting on any non-2xx answer or unreadable body.
		*/
		function readDocument(response) {
			if (response === null || response === void 0) throw httpFailure(0);
			if (response.ok !== true) throw httpFailure(typeof response.status === "number" ? response.status : 0);
			if (typeof response.text !== "function") throw new Error("unreadable-document");
			return response.text();
		}
		//#endregion
		//#region lib/types/client/picker.js
		/**
		* Keep only the index rows this picker can render as one selectable message.
		* @param body - parsed index payload.
		* @returns the entry list, empty when the payload carries none.
		*/
		function entriesOf(body) {
			const raw = body !== null && body !== void 0 && Array.isArray(body.entries) ? body.entries : [];
			const kept = [];
			for (let index = 0; index < raw.length; index += 1) {
				const entry = raw[index];
				if (entry === null || entry === void 0 || typeof entry.id !== "string" || entry.id === "") continue;
				kept.push(entry);
			}
			return kept;
		}
		/**
		* Format one entry timestamp for its picker row.
		* @param time - epoch milliseconds (or seconds) reported by the index.
		* @returns a clock label, or null when the entry reported no usable time.
		*/
		function timeLabel(time) {
			if (typeof time !== "number" || Number.isFinite(time) !== true || time <= 0) return null;
			try {
				const at = new Date(time < 1e12 ? time * 1000 : time);
				if (Number.isNaN(at.getTime()) === true) return null;
				const pad = (value) => (value < 10 ? "0" + value : String(value));
				return pad(at.getHours()) + ":" + pad(at.getMinutes());
			} catch (cause) {
				return null;
			}
		}
		/**
		* Compose the muted second line of one picker row: time, tool count, context count.
		* @param entry - index entry to describe.
		* @param t - localization lookup.
		* @returns the meta text, empty when the entry reported nothing to add.
		*/
		function metaLine(entry, t) {
			const parts = [];
			const stamp = timeLabel(entry.time);
			if (stamp !== null) parts.push(stamp);
			if (typeof entry.tools === "number" && entry.tools > 0) parts.push(String(t("picker.tools")) + " " + entry.tools);
			if (typeof entry.context === "number" && entry.context > 0) parts.push(String(t("picker.context")) + " " + entry.context);
			return parts.length === 0 ? "" : parts.join(" · ");
		}
		/**
		* Build one native button for the picker chrome.
		* @param label - visible text.
		* @param className - plugin class carrying the styling.
		* @returns the button element.
		*/
		function pickerButton(label, className) {
			const button = document.createElement("button");
			button.setAttribute("type", "button");
			button.className = className;
			button.textContent = label;
			return button;
		}
		/**
		* Mount the message picker layer: list one Session's shareable messages, collect a selection and
		* hand it to the renderer.
		* @param config - session id, localization, and the close/preview callbacks.
		* @returns a teardown function that detaches the layer and its listeners.
		*/
		function mountPicker(config) {
			const t = typeof config.t === "function" ? config.t : (key) => key;
			const previous = document.activeElement;
			const overlay = document.createElement("div");
			overlay.className = classes.picker;
			overlay.setAttribute("role", "dialog");
			overlay.setAttribute("aria-modal", "true");
			overlay.setAttribute("aria-label", t("picker.title"));
			const panel = document.createElement("div");
			panel.className = classes.pickerPanel;
			const head = document.createElement("div");
			head.className = classes.pickerHead;
			const heading = document.createElement("span");
			heading.className = classes.pickerTitle;
			heading.textContent = t("picker.title");
			head.appendChild(heading);
			const dismiss = pickerButton("×", classes.pickerClose);
			dismiss.setAttribute("aria-label", t("picker.close"));
			dismiss.setAttribute("title", t("picker.close"));
			head.appendChild(dismiss);
			const tools = document.createElement("div");
			tools.className = classes.pickerTools;
			const selectAll = pickerButton(t("picker.selectAll"), classes.pickerTool);
			const selectNone = pickerButton(t("picker.selectNone"), classes.pickerTool);
			const counter = document.createElement("span");
			counter.className = classes.pickerCount;
			counter.setAttribute("role", "status");
			tools.appendChild(selectAll);
			tools.appendChild(selectNone);
			tools.appendChild(counter);
			const list = document.createElement("div");
			list.className = classes.pickerList;
			list.setAttribute("role", "group");
			const notice = document.createElement("div");
			notice.className = classes.pickerStatus;
			notice.setAttribute("role", "status");
			const hint = document.createElement("div");
			hint.className = classes.pickerHint;
			hint.setAttribute("role", "status");
			const footer = document.createElement("div");
			footer.className = classes.pickerFooter;
			const generate = pickerButton(t("picker.generate"), classes.primary);
			const cancel = pickerButton(t("picker.cancel"), classes.pickerTool);
			footer.appendChild(generate);
			footer.appendChild(cancel);
			panel.appendChild(head);
			panel.appendChild(tools);
			panel.appendChild(list);
			panel.appendChild(notice);
			panel.appendChild(hint);
			panel.appendChild(footer);
			overlay.appendChild(panel);
			let entries = [];
			let busy = false;
			let loaded = false;
			let disposed = false;
			const picked = Object.create(null);
			const rowById = Object.create(null);
			/** Read the current selection in list order. */
			function selectedIds() {
				const ids = [];
				for (let index = 0; index < entries.length; index += 1) if (picked[entries[index].id] === true) ids.push(entries[index].id);
				return ids;
			}
			/** Repaint the selection counter, the hint and the generate button state. */
			function refresh() {
				const count = selectedIds().length;
				counter.textContent = String(t("picker.selected")).split("N").join(String(count));
				if (count > 0 && busy !== true) {
					if (typeof generate.removeAttribute === "function") generate.removeAttribute("disabled");
				} else {
					generate.setAttribute("disabled", "disabled");
				}
				hint.textContent = loaded === true && count === 0 ? t("picker.noneSelected") : "";
			}
			/** Copy the selection map onto every mounted row. */
			function apply() {
				for (let index = 0; index < entries.length; index += 1) {
					const entry = entries[index];
					const row = rowById[entry.id];
					if (row === void 0) continue;
					const on = picked[entry.id] === true;
					row.setAttribute("aria-checked", on === true ? "true" : "false");
					const box = row.children[0];
					if (box !== void 0 && box !== null) box.checked = on === true;
				}
				refresh();
			}
			/** Flip one entry's checkbox and repaint. */
			function toggle(id) {
				picked[id] = picked[id] === true ? false : true;
				note("picker toggle", { id: id, picked: selectedIds().length });
				apply();
			}
			/**
			* Build one whole-row checkbox for a message.
			* @param entry - index entry to represent.
			* @returns the row element.
			*/
			function buildRow(entry) {
				const row = document.createElement("div");
				row.className = classes.pickerRow;
				row.setAttribute("role", "checkbox");
				row.setAttribute("tabindex", "0");
				row.setAttribute("aria-checked", picked[entry.id] === true ? "true" : "false");
				row.setAttribute("data-kind", entry.kind === "user" ? "user" : "assistant");
				const box = document.createElement("input");
				box.setAttribute("type", "checkbox");
				box.setAttribute("tabindex", "-1");
				box.setAttribute("aria-hidden", "true");
				box.className = classes.pickerCheck;
				box.checked = picked[entry.id] === true;
				const role = document.createElement("span");
				role.className = entry.kind === "user" ? classes.whoUser : classes.whoAssistant;
				const mark = document.createElement("i");
				mark.className = entry.kind === "user" ? classes.markUser : classes.markAssistant;
				const roleName = document.createElement("span");
				roleName.className = classes.whoName;
				roleName.textContent = entry.kind === "user" ? t("picker.you") : t("picker.assistant");
				role.appendChild(mark);
				role.appendChild(roleName);
				const label = document.createElement("span");
				label.className = classes.pickerLabel;
				label.textContent = typeof entry.label === "string" ? entry.label : "";
				const line = document.createElement("div");
				line.className = classes.pickerLine;
				line.appendChild(role);
				line.appendChild(label);
				const meta = document.createElement("div");
				meta.className = classes.pickerMeta;
				meta.textContent = metaLine(entry, t);
				const body = document.createElement("div");
				body.className = classes.pickerBody;
				body.appendChild(line);
				body.appendChild(meta);
				row.appendChild(box);
				row.appendChild(body);
				row.addEventListener("click", (event) => {
					if (event !== null && event !== void 0 && typeof event.stopPropagation === "function") event.stopPropagation();
					toggle(entry.id);
				});
				row.addEventListener("keydown", (event) => {
					if (event === null || event === void 0) return;
					const key = event.key;
					if (key !== " " && key !== "Spacebar" && key !== "Enter") return;
					if (typeof event.preventDefault === "function") event.preventDefault();
					if (typeof event.stopPropagation === "function") event.stopPropagation();
					toggle(entry.id);
				});
				return row;
			}
			/** Drop every mounted row and rebuild the list from the loaded entries. */
			function renderList() {
				while (list.children.length > 0) list.removeChild(list.children[0]);
				for (let index = 0; index < entries.length; index += 1) {
					const row = buildRow(entries[index]);
					rowById[entries[index].id] = row;
					list.appendChild(row);
				}
				refresh();
			}
			/** Report one line inside the layer instead of raising a dialog. */
			function setNotice(text) {
				notice.textContent = text;
			}
			/** Ask the Host for the picked documents and hand it to the preview layer. */
			function generatePreview() {
				const ids = selectedIds();
				if (ids.length === 0) {
					note("picker generate skipped: nothing selected");
					return;
				}
				if (busy === true) return;
				busy = true;
				setNotice("");
				refresh();
				note("picker generate", { picked: ids.length });
				const url = sharePickUrl(config.sessionId, ids);
				probe(url).then(() => fetch(url)).then(readDocument).then((text) => {
					if (disposed === true) return;
					if (typeof text !== "string" || text === "") throw new Error("empty-document");
					note("picker preview ready", { picked: ids.length });
					config.onPreview(text, {
						url: url + "&download=1",
						filename: shareFilename(config.sessionId),
						label: t("preview.download"),
						title: t("preview.title"),
						closeLabel: t("preview.close")
					});
				}).catch((cause) => {
					if (disposed === true) return;
					busy = false;
					const label = failureLabel(cause);
					note("picker generate failed", { label: label });
					setNotice(t("error.failed") + " (" + label + ")");
					refresh();
				});
			}
			/** Load the message index and build the rows. */
			function loadIndex() {
				setNotice(t("picker.loading"));
				refresh();
				note("picker load", { sessionId: config.sessionId });
				fetch(shareIndexUrl(config.sessionId)).then((response) => {
					if (response === null || response === void 0) throw httpFailure(0);
					if (response.ok !== true) throw httpFailure(typeof response.status === "number" ? response.status : 0);
					if (typeof response.json !== "function") throw new Error("unreadable-index");
					return response.json();
				}).then((body) => {
					if (disposed === true) return;
					entries = entriesOf(body);
					if (entries.length === 0) {
						note("picker empty", { entries: 0 });
						setNotice(t("picker.empty"));
						refresh();
						return;
					}
					setNotice("");
					loaded = true;
					renderList();
					note("picker open", { entries: entries.length });
				}).catch((cause) => {
					if (disposed === true) return;
					const label = failureLabel(cause);
					note("picker load failed", { label: label });
					setNotice(t("picker.loadFailed") + " (" + label + ")");
					refresh();
				});
			}
			/** Ask the owner to unmount this layer. */
			function close(reason) {
				note(reason);
				if (typeof config.onClose === "function") config.onClose();
			}
			function onKeyDown(event) {
				if (event === null || event === void 0) return;
				if (event.key !== "Escape" && event.key !== "Esc") return;
				close("picker escape");
			}
			function teardown() {
				if (disposed === true) return;
				disposed = true;
				if (typeof document.removeEventListener === "function") document.removeEventListener("keydown", onKeyDown, true);
				detachNode(overlay);
				if (previous !== null && previous !== void 0 && typeof previous.focus === "function") previous.focus();
			}
			selectAll.addEventListener("click", () => {
				for (let index = 0; index < entries.length; index += 1) picked[entries[index].id] = true;
				apply();
				note("picker select all", { picked: selectedIds().length });
			});
			selectNone.addEventListener("click", () => {
				for (let index = 0; index < entries.length; index += 1) delete picked[entries[index].id];
				apply();
				note("picker select none");
			});
			generate.addEventListener("click", generatePreview);
			cancel.addEventListener("click", () => {
				close("picker cancel");
			});
			dismiss.addEventListener("click", () => {
				close("picker close");
			});
			overlay.addEventListener("click", (event) => {
				if (event !== null && event !== void 0 && event.target === overlay) close("picker mask");
			});
			if (typeof document.addEventListener === "function") document.addEventListener("keydown", onKeyDown, true);
			if (appendLayer(overlay) !== true) {
				note("picker aborted: no document host accepted the layer");
				disposed = true;
				if (typeof document.removeEventListener === "function") document.removeEventListener("keydown", onKeyDown, true);
				return () => {};
			}
			note("picker mounted", { host: overlay.className, zIndex: "2147483001" });
			loadIndex();
			return teardown;
		}
		//#endregion

		//#region lib/types/client/HeaderAction.js
		/** Prefix every diagnostic line this action emits. */
		const LOG_TAG = "[share-html]";
		/**
		* Emit one diagnostic line; a broken console must never break the action.
		* @param message - what happened.
		* @param extra - structured detail.
		*/
		function note(message, extra) {
			try {
				if (typeof console === "undefined" || console === null || typeof console.info !== "function") return;
				if (extra === void 0) console.info(LOG_TAG + " " + message);
				else console.info(LOG_TAG + " " + message, extra);
			} catch (cause) {
				return;
			}
		}
		/**
		* Emit one diagnostic warning; see note().
		* @param message - what happened.
		* @param extra - structured detail.
		*/
		function noteWarning(message, extra) {
			try {
				if (typeof console === "undefined" || console === null) return;
				const sink = typeof console.warn === "function" ? console.warn : console.info;
				if (typeof sink !== "function") return;
				if (extra === void 0) sink(LOG_TAG + " " + message);
				else sink(LOG_TAG + " " + message, extra);
			} catch (cause) {
				return;
			}
		}
		/**
		* Report a caught failure with its message and the head of its stack.
		* @param message - which step failed.
		* @param cause - the thrown value.
		*/
		function noteFailure(message, cause) {
			const detail = {
				message: cause !== void 0 && cause !== null && typeof cause.message === "string" ? cause.message : String(cause),
				stack: cause !== void 0 && cause !== null && typeof cause.stack === "string" ? cause.stack.split("\n").slice(0, 2) : []
			};
			note(message, detail);
		}
		/**
		* Render the Session Header share menu: preview in an in-app layer or download the document.
		* @param props - Session id, localized copy, and the injected runtime hooks.
		* @returns the persistent Header action.
		*/
		function SessionShareHtmlHeaderAction(props) {
			const sessionId = props === void 0 || props === null ? void 0 : props.sessionId;
			const t = typeof (props === void 0 || props === null ? void 0 : props.t) === "function" ? props.t : (key) => key;
			const [open, setOpen] = react.useState(false);
			const [busy, setBusy] = react.useState(false);
			const [failure, setFailure] = react.useState(null);
			const [picking, setPicking] = react.useState(false);
			const seq = react.useRef(0);
			const triggerRef = react.useRef(null);
			const hostRef = react.useRef(null);
			const menuRef = react.useRef(null);
			const previewRef = react.useRef(null);
			react.useEffect(() => {
				seq.current += 1;
				setFailure(null);
				setBusy(false);
				setPicking(false);
			}, [sessionId]);
			react.useEffect(() => () => {
				if (typeof previewRef.current === "function") previewRef.current();
				previewRef.current = null;
			}, []);
			react.useEffect(() => {
				if (open !== true) return void 0;
				return mountMenu();
			}, [open, busy, failure]);
			react.useEffect(() => {
				if (picking !== true) return void 0;
				return mountPickerLayer();
			}, [picking]);
			react.useEffect(() => {
				if (open !== true) return void 0;
				if (typeof window === "undefined" || window === null || typeof window.addEventListener !== "function") return void 0;
				const onReflow = () => {
					repositionMenu();
				};
				window.addEventListener("scroll", onReflow, true);
				window.addEventListener("resize", onReflow);
				return () => {
					window.removeEventListener("scroll", onReflow, true);
					window.removeEventListener("resize", onReflow);
				};
			}, [open]);
			react.useEffect(() => {
				if (open !== true) return void 0;
				if (typeof document === "undefined" || document === null || typeof document.addEventListener !== "function") return void 0;
				const onPointer = (event) => {
					const target = event === null || event === void 0 ? null : event.target;
					if (containsNode(hostRef.current, target) === true) return;
					if (containsNode(triggerRef.current, target) === true) return;
					note("outside click closes the menu");
					setOpen(false);
				};
				const onKeyDown = (event) => {
					if (event === null || event === void 0) return;
					if (event.key !== "Escape" && event.key !== "Esc") return;
					note("escape closes the menu");
					setOpen(false);
				};
				document.addEventListener("click", onPointer, true);
				document.addEventListener("keydown", onKeyDown, true);
				return () => {
					document.removeEventListener("click", onPointer, true);
					document.removeEventListener("keydown", onKeyDown, true);
				};
			}, [open]);
			/**
			* Fetch a verified route and mount the in-app preview layer for it.
			* @param url - document-relative render route.
			* @param token - request sequence number this fetch belongs to.
			* @returns a promise settling once the layer is up.
			*/
			const mountLayer = react.useCallback((text, action) => {
				if (typeof previewRef.current === "function") previewRef.current();
				previewRef.current = mountPreview(text, triggerRef.current, action);
			}, []);
			const showPreview = react.useCallback((url, token) => {
				const blocker = previewBlocker();
				if (blocker !== null) return Promise.reject(new Error(blocker));
				return fetch(url).then(readDocument).then((text) => {
					if (seq.current !== token) return;
					if (typeof text !== "string" || text === "") throw new Error("empty-document");
					mountLayer(text, {
						url: shareUrl(sessionId, true),
						filename: shareFilename(sessionId),
						label: t("preview.download"),
						title: t("preview.title"),
						closeLabel: t("preview.close")
					});
				});
			}, [sessionId, t, mountLayer]);
			const run = react.useCallback((download) => {
				if (sessionId === void 0 || sessionId === null || sessionId === "") {
					note("run skipped: this slot was not given a session id");
					return;
				}
				seq.current += 1;
				const token = seq.current;
				const url = shareUrl(sessionId, download === true);
				setBusy(true);
				setFailure(null);
				note("run", { download: download === true });
				const finish = (settled) => {
					if (seq.current !== token) return;
					setBusy(false);
					if (settled === true) setOpen(false);
				};
				probe(url).then(() => {
					if (seq.current !== token) return null;
					if (download === true) {
						startDownload(url, shareFilename(sessionId));
						return true;
					}
					return showPreview(url, token).then(() => true);
				}).catch((cause) => {
					if (seq.current !== token) return false;
					const label = failureLabel(cause);
					note("share failed", { label });
					setFailure(label);
					if (download !== true) startDownload(shareUrl(sessionId, true), shareFilename(sessionId));
					return false;
				}).then(finish);
			}, [sessionId, showPreview]);
			const actions = [{
				id: PREVIEW_ITEM,
				label: t("menu.preview")
			}, {
				id: DOWNLOAD_ITEM,
				label: t("menu.download")
			}, {
				id: PICK_ITEM,
				label: t("menu.pick")
			}];
			const select = (id) => {
				note("select item", { id });
				if (id === PREVIEW_ITEM) run(false);
				else if (id === DOWNLOAD_ITEM) run(true);
				else if (id === PICK_ITEM) {
					if (sessionId === void 0 || sessionId === null || sessionId === "") {
						note("pick skipped: this slot was not given a session id");
						return;
					}
					setOpen(false);
					setPicking(true);
				}
			};
			/**
			* Mount the message picker layer for the current Session.
			* @returns the teardown, or undefined when the layer could not be built.
			*/
			function mountPickerLayer() {
				try {
					return mountPicker({
						sessionId: sessionId,
						t: t,
						onClose: () => {
							setPicking(false);
						},
						onPreview: (text, action) => {
							setPicking(false);
							mountLayer(text, action);
						}
					});
				} catch (cause) {
					noteFailure("picker mount threw", cause);
					return void 0;
				}
			}
			/**
			* Copy one computed anchor onto the menu node.
			* @param node - menu element.
			* @param style - viewport anchor, or undefined when layout is unavailable.
			*/
			function applyMenuStyle(node, style) {
				if (node === null || node === void 0 || style === void 0) return;
				node.style.position = style.position;
				node.style.top = style.top;
				node.style.right = style.right;
				node.style.zIndex = style.zIndex;
			}
			/** Re-anchor the mounted menu right under the trigger. */
			function repositionMenu() {
				applyMenuStyle(menuRef.current, menuStyle(triggerRect(triggerRef.current)));
			}
			/**
			* Append the menu container to the best document host this build offers.
			* @param container - the menu container to attach.
			* @returns the host it landed on, or null when every target refused.
			*/
			function attachContainer(container) {
				const targets = [];
				try {
					if (canPortal() === true) targets.push({ parent: document.body, className: classes.portal });
				} catch (cause) {
					noteFailure("body probe failed", cause);
				}
				try {
					if (typeof document !== "undefined" && document !== null && document.documentElement !== void 0 && document.documentElement !== null && typeof document.documentElement.appendChild === "function") {
						targets.push({ parent: document.documentElement, className: classes.fixed });
					}
				} catch (cause) {
					noteFailure("root probe failed", cause);
				}
				for (let index = 0; index < targets.length; index += 1) {
					try {
						container.className = targets[index].className;
						targets[index].parent.appendChild(container);
						return targets[index];
					} catch (cause) {
						noteFailure("append refused by " + targets[index].className, cause);
					}
				}
				return null;
			}
			/**
			* Build the menu, anchor it under the trigger and append it outside the Header.
			* @returns the teardown that removes it again.
			*/
			function mountMenu() {
				try {
					note("mount decision", {
						open: open === true,
						busy: busy === true,
						hasFailure: failure !== null,
						canPortal: canPortal() === true,
						hasBody: typeof document !== "undefined" && document !== null && document.body !== void 0 && document.body !== null,
						hasRoot: typeof document !== "undefined" && document !== null && document.documentElement !== void 0 && document.documentElement !== null
					});
					const container = document.createElement("div");
					container.setAttribute("data-share-html-portal", "");
					const menu = document.createElement("div");
					menu.className = classes.menu;
					menu.setAttribute("role", "menu");
					menu.style.display = "flex";
					for (let index = 0; index < actions.length; index += 1) {
						const action = actions[index];
						const item = document.createElement("button");
						item.setAttribute("type", "button");
						item.setAttribute("role", "menuitem");
						item.className = classes.item;
						item.textContent = action.label;
						if (busy === true) item.setAttribute("disabled", "disabled");
						item.addEventListener("click", (event) => {
							if (event !== void 0 && event !== null && typeof event.stopPropagation === "function") event.stopPropagation();
							select(action.id);
						});
						menu.appendChild(item);
					}
					if (failure !== null) {
						const notice = document.createElement("span");
						notice.className = classes.error;
						notice.setAttribute("role", "status");
						notice.textContent = t("error.failed") + " (" + failure + ")";
						menu.appendChild(notice);
					}
					container.appendChild(menu);
					menuRef.current = menu;
					repositionMenu();
					const host = attachContainer(container);
					if (host === null) {
						note("mount aborted: no document host accepted the menu");
						menuRef.current = null;
						return void 0;
					}
					hostRef.current = container;
					note("menu mounted", {
						host: host.className,
						top: menu.style.top === void 0 ? null : menu.style.top,
						right: menu.style.right === void 0 ? null : menu.style.right,
						width: typeof menu.offsetWidth === "number" ? menu.offsetWidth : -1,
						height: typeof menu.offsetHeight === "number" ? menu.offsetHeight : -1,
						entries: menu.children.length
					});
					if (menu.offsetWidth === 0 || menu.offsetHeight === 0) {
						noteWarning("menu measured zero size; the plugin stylesheet may be missing");
					}
					return () => {
						hostRef.current = null;
						menuRef.current = null;
						detachNode(container);
					};
				} catch (cause) {
					noteFailure("menu mount threw", cause);
					return void 0;
				}
			}
			const trigger = jsx("button", {
				type: "button",
				ref: triggerRef,
				className: classes.trigger,
				"aria-label": t("action.label"),
				"aria-haspopup": "menu",
				"aria-expanded": open === true,
				"aria-busy": busy === true,
				onClick: () => {
					note("trigger click", { open: open === true, busy: busy === true, picking: picking === true });
					if (picking === true) {
						setPicking(false);
						setOpen(false);
						return;
					}
					setOpen((value) => value !== true);
				},
				children: shareIconElement()
			});
			return jsx("div", { className: classes.fallback, children: trigger });
		}
		//#endregion

		//#region lib/types/client/locales.js
		/** Simplified-Chinese share-as-HTML strings. */
		const zh = {
			"action.label": "分享为 HTML",
			"menu.preview": "预览 HTML",
			"menu.download": "下载 HTML",
			"menu.pick": "选择对话后分享...",
			"preview.download": "下载",
			"preview.title": "分享预览",
			"preview.close": "关闭预览",
			"picker.title": "选择要分享的消息",
			"picker.loading": "正在读取会话...",
			"picker.loadFailed": "读取消息失败",
			"picker.selectAll": "全选",
			"picker.selectNone": "全不选",
			"picker.selected": "已选 N 条",
			"picker.noneSelected": "请至少选择一条消息",
			"picker.empty": "没有可分享的消息",
			"picker.close": "关闭",
			"picker.tools": "工具",
			"picker.context": "上下文",
			"picker.you": "你",
			"picker.assistant": "DeepSeek",
			"picker.generate": "生成预览",
			"picker.cancel": "取消",
			"error.failed": "分享失败"
		};
		/** English share-as-HTML strings. */
		const en = {
			"action.label": "Share as HTML",
			"menu.preview": "Preview HTML",
			"menu.download": "Download HTML",
			"menu.pick": "Pick messages to share...",
			"preview.download": "Download",
			"preview.title": "Share preview",
			"preview.close": "Close preview",
			"picker.title": "Pick the messages to share",
			"picker.loading": "Loading messages...",
			"picker.loadFailed": "Could not load messages",
			"picker.selectAll": "Select all",
			"picker.selectNone": "Select none",
			"picker.selected": "N selected",
			"picker.noneSelected": "Select at least one message",
			"picker.empty": "No shareable messages",
			"picker.close": "Close",
			"picker.tools": "tools",
			"picker.context": "context",
			"picker.you": "You",
			"picker.assistant": "DeepSeek",
			"picker.generate": "Generate preview",
			"picker.cancel": "Cancel",
			"error.failed": "Share failed"
		};
		//#endregion
		//#region lib/types/client/index.js
		/** Browser services this plugin depends on. */
		const inject = ["slots", "locale"];
		/**
		* Register the share-as-HTML Header action and its dictionaries.
		* @param ctx - browser context carrying slots and locale services.
		*/
		function apply(ctx) {
			ctx.effect(() => ctx.locale.register(NS, {
				zh,
				en
			}), "share-html: browser dictionaries");
			ctx.slots.inject(SLOT, () => ctx.slots.register({
				name: SLOT,
				id: "share-html",
				order: 5,
				locale: NS,
				inject: () => ({
					hooks: {}
				})
			}, SessionShareHtmlHeaderAction));
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
