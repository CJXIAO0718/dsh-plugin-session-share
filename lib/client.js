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
			const PUBLISH_HOST_ITEM = "publish-host";
			const CONNECT_ITEM = "connect";
			const ERROR_ITEM = "share-html-error";
			const PUBLISH_ROUTE = "/api/session.publishHost".slice(1);
			const PROBE_ROUTE = "/api/session.probeHost".slice(1);
			const CONNECTION_KEY = "dsh-session-share-connection";
			const SETTINGS_ROUTE = "/api/session.shareSettings".slice(1);
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
				"._shareHtml_pickerFooter{display:flex;align-items:center;justify-content:flex-end;gap:8px;padding-top:12px;border-top:1px solid color-mix(in srgb,CanvasText 12%,transparent)}",
				"._shareHtml_settings{position:fixed;inset:0;z-index:2147483001;display:flex;align-items:center;justify-content:center;padding:36px 24px;background:color-mix(in srgb,currentColor 48%,transparent);backdrop-filter:blur(3px)}",
				"._shareHtml_settingsPanel{position:relative;display:flex;flex-direction:column;gap:12px;width:min(540px,94vw);max-height:calc(100vh - 48px);overflow:auto;padding:20px;border-radius:12px;border:1px solid color-mix(in srgb,CanvasText 18%,transparent);background:Canvas;color:var(--dsw-alias-label-primary,CanvasText);box-shadow:0 16px 48px color-mix(in srgb,currentColor 24%,transparent)}",
				"._shareHtml_settingsHead{display:flex;align-items:center;gap:8px;padding-bottom:10px;border-bottom:1px solid color-mix(in srgb,CanvasText 12%,transparent);font-weight:600}",
				"._shareHtml_settingsTitle{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
				"._shareHtml_settingsIntro{margin:0;font-size:12px;line-height:1.65;color:color-mix(in srgb,currentColor 66%,transparent)}",
				"._shareHtml_settingsField{display:flex;flex-direction:column;gap:5px;font-size:12px}",
				"._shareHtml_settingsLabel{color:color-mix(in srgb,currentColor 72%,transparent)}",
				"._shareHtml_settingsInput{height:36px;padding:0 10px;border:1px solid color-mix(in srgb,CanvasText 18%,transparent);border-radius:8px;background:Canvas;color:inherit;font:inherit;font-size:13px;outline:none}",
				"._shareHtml_settingsInput:focus{border-color:color-mix(in srgb,CanvasText 48%,transparent)}",
				"._shareHtml_settingsHint{font-size:11px;line-height:1.55;color:color-mix(in srgb,currentColor 55%,transparent)}",
				"._shareHtml_settingsActions{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding-top:12px;border-top:1px solid color-mix(in srgb,CanvasText 12%,transparent)}",
				"._shareHtml_settingsStatus{flex:1;min-width:0;font-size:12px;line-height:1.5;color:color-mix(in srgb,currentColor 66%,transparent)}",
				"._shareHtml_settingsStatus[data-tone=\"ok\"]{color:var(--dsw-alias-state-business-primary,CanvasText)}",
				"._shareHtml_settingsStatus[data-tone=\"error\"]{color:var(--dsw-alias-state-error-primary,CanvasText)}",
				"._shareHtml_settingsModes{display:flex;gap:6px;flex-wrap:wrap}",
				"._shareHtml_settingsMode{flex:1;min-width:0;height:32px;padding:0 10px;border:1px solid color-mix(in srgb,CanvasText 18%,transparent);border-radius:8px;background:transparent;color:inherit;font:inherit;font-size:12px;cursor:pointer;transition:background-color 130ms ease,border-color 130ms ease,box-shadow 130ms ease,transform 130ms cubic-bezier(.2,.8,.2,1)}",
				"._shareHtml_settingsMode:hover:enabled{background:color-mix(in srgb,currentColor 8%,transparent)}",
				"._shareHtml_settingsMode:active:enabled{transform:scale(.97)}",
				"._shareHtml_settingsMode[aria-pressed=\"true\"]{border-color:color-mix(in srgb,CanvasText 46%,transparent);background:color-mix(in srgb,currentColor 14%,transparent);font-weight:600}",
				"._shareHtml_settingsMode:disabled{opacity:.55;cursor:progress}",
				"._shareHtml_result{position:fixed;inset:0;z-index:2147483001;display:flex;align-items:center;justify-content:center;padding:36px 24px;background:color-mix(in srgb,currentColor 48%,transparent);backdrop-filter:blur(3px)}",
				"._shareHtml_resultPanel{position:relative;display:flex;flex-direction:column;gap:10px;width:min(480px,94vw);padding:20px;border-radius:12px;border:1px solid color-mix(in srgb,CanvasText 18%,transparent);background:Canvas;color:var(--dsw-alias-label-primary,CanvasText);box-shadow:0 16px 48px color-mix(in srgb,currentColor 24%,transparent)}",
				"._shareHtml_resultTitle{margin:0;font-size:20px;line-height:1.35;font-weight:600}",
				"._shareHtml_resultSub{margin:0;font-size:12px;line-height:1.6;color:color-mix(in srgb,currentColor 62%,transparent)}",
				"._shareHtml_resultCode{display:block;padding:10px;border-radius:8px;background:color-mix(in srgb,CanvasText 7%,transparent);font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;line-height:1.55;color:inherit;word-break:break-all}",
				"._shareHtml_resultActions{display:flex;align-items:center;justify-content:flex-end;gap:8px;flex-wrap:wrap;padding-top:6px}",
				"._shareHtml_resultNote{flex:1;min-width:0;font-size:11px;line-height:1.5;color:color-mix(in srgb,currentColor 58%,transparent)}",
				//#region lib/types/client/motion.css
				"._shareHtml_trigger{transition:background-color 140ms ease,opacity 140ms ease,transform 140ms cubic-bezier(.2,.8,.2,1)}",
				"._shareHtml_trigger:hover{background:color-mix(in srgb,currentColor 12%,transparent)}",
				"._shareHtml_trigger:active{transform:scale(.92)}",
				"._shareHtml_trigger[aria-expanded=\"true\"]{background:color-mix(in srgb,currentColor 14%,transparent)}",
				"._shareHtml_trigger:focus-visible{outline:2px solid color-mix(in srgb,currentColor 55%,transparent);outline-offset:1px}",
				"._shareHtml_menu{transition:opacity 120ms ease,transform 130ms cubic-bezier(.2,.8,.2,1);transform-origin:top right}",
				"._shareHtml_menu[data-state=\"enter\"]{opacity:0;transform:translateY(-4px) scale(.97)}",
				"._shareHtml_item{transition:background-color 120ms ease,transform 120ms ease}",
				"._shareHtml_item:hover:enabled{transform:translateX(1px)}",
				"._shareHtml_item:active:enabled{transform:scale(.985)}",
				"._shareHtml_overlay,._shareHtml_picker,._shareHtml_settings,._shareHtml_result{transition:opacity 150ms ease}",
				"._shareHtml_overlay[data-state=\"enter\"],._shareHtml_picker[data-state=\"enter\"],._shareHtml_settings[data-state=\"enter\"],._shareHtml_result[data-state=\"enter\"]{opacity:0}",
				"._shareHtml_overlay[data-state=\"closing\"],._shareHtml_picker[data-state=\"closing\"],._shareHtml_settings[data-state=\"closing\"],._shareHtml_result[data-state=\"closing\"]{opacity:0}",
				"._shareHtml_previewPanel,._shareHtml_pickerPanel,._shareHtml_settingsPanel,._shareHtml_resultPanel{transition:opacity 170ms ease,transform 180ms cubic-bezier(.16,.84,.28,1)}",
				"._shareHtml_overlay[data-state=\"enter\"] ._shareHtml_previewPanel{opacity:0;transform:translateY(10px) scale(.985)}",
				"._shareHtml_picker[data-state=\"enter\"] ._shareHtml_pickerPanel{opacity:0;transform:translateY(10px) scale(.985)}",
				"._shareHtml_settings[data-state=\"enter\"] ._shareHtml_settingsPanel{opacity:0;transform:translateY(12px) scale(.985)}",
				"._shareHtml_result[data-state=\"enter\"] ._shareHtml_resultPanel{opacity:0;transform:translateY(14px) scale(.97)}",
				"._shareHtml_overlay[data-state=\"closing\"] ._shareHtml_previewPanel,._shareHtml_picker[data-state=\"closing\"] ._shareHtml_pickerPanel,._shareHtml_settings[data-state=\"closing\"] ._shareHtml_settingsPanel,._shareHtml_result[data-state=\"closing\"] ._shareHtml_resultPanel{opacity:0;transform:scale(.99)}",
				"._shareHtml_close,._shareHtml_download,._shareHtml_pickerClose,._shareHtml_pickerTool,._shareHtml_primary{transition:background-color 120ms ease,transform 120ms cubic-bezier(.2,.8,.2,1),box-shadow 140ms ease}",
				"._shareHtml_close:active,._shareHtml_download:active,._shareHtml_pickerClose:active,._shareHtml_pickerTool:active:enabled{transform:scale(.94)}",
				"._shareHtml_primary:hover:enabled{box-shadow:0 2px 10px color-mix(in srgb,currentColor 18%,transparent)}",
				"._shareHtml_primary:active:enabled{transform:scale(.96)}",
				"._shareHtml_pickerRow{transition:background-color 130ms ease,box-shadow 130ms ease,opacity 160ms ease,transform 160ms cubic-bezier(.2,.8,.2,1)}",
				"._shareHtml_pickerCheck{transition:transform 120ms cubic-bezier(.2,.8,.2,1)}",
				"._shareHtml_pickerRow[aria-checked=\"true\"] ._shareHtml_pickerCheck{transform:scale(1.12)}",
				"._shareHtml_pickerCount{transition:transform 160ms cubic-bezier(.2,.8,.2,1),color 160ms ease}",
				"._shareHtml_settingsStatus{transition:color 160ms ease,opacity 160ms ease}",
				"._shareHtml_settingsInput{transition:border-color 140ms ease,box-shadow 140ms ease}",
				"._shareHtml_settingsInput:focus{box-shadow:0 0 0 3px color-mix(in srgb,currentColor 12%,transparent)}",
				"._shareHtml_resultNote{transition:opacity 160ms ease,color 160ms ease}",
				"._shareHtml_previewTitle{transition:opacity 160ms ease}"
				//#endregion
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
				pickerFooter: "_shareHtml_pickerFooter",
				settings: "_shareHtml_settings",
				settingsPanel: "_shareHtml_settingsPanel",
				settingsHead: "_shareHtml_settingsHead",
				settingsTitle: "_shareHtml_settingsTitle",
				settingsIntro: "_shareHtml_settingsIntro",
				settingsField: "_shareHtml_settingsField",
				settingsLabel: "_shareHtml_settingsLabel",
				settingsInput: "_shareHtml_settingsInput",
				settingsHint: "_shareHtml_settingsHint",
				settingsModes: "_shareHtml_settingsModes",
				settingsMode: "_shareHtml_settingsMode",
				settingsActions: "_shareHtml_settingsActions",
				settingsStatus: "_shareHtml_settingsStatus",
				result: "_shareHtml_result",
				resultPanel: "_shareHtml_resultPanel",
				resultTitle: "_shareHtml_resultTitle",
				resultSub: "_shareHtml_resultSub",
				resultCode: "_shareHtml_resultCode",
				resultActions: "_shareHtml_resultActions",
				resultNote: "_shareHtml_resultNote"
			};

		/**
		* Inject this plugin's stylesheet once per document. An existing tag is refreshed in place, so a
		* hot-reloaded bundle picks up edited rules instead of keeping the ones injected earlier.
		*/
		function injectCss() {
			if (typeof document === "undefined" || document === null) return;
			const selector = "style[data-plugin-css=" + JSON.stringify(cssTagId) + "]";
			let existing = null;
			try {
				if (typeof document.querySelector === "function") existing = document.querySelector(selector);
			} catch (cause) {
				existing = null;
			}
			if (existing !== null && existing !== void 0) {
				if (existing.textContent !== css) existing.textContent = css;
				return;
			}
			const tag = document.createElement("style");
			tag.dataset.plugin = cssTagId;
			tag.dataset.pluginCss = cssTagId;
			tag.textContent = css;
			if (document.head !== void 0 && document.head !== null && typeof document.head.appendChild === "function") document.head.appendChild(tag);
		}
		injectCss();
		//#endregion
		//#region lib/types/client/motion.js
		/**
		* Whether this document can play a CSS transition at all: animation frames exist, and the reader
		* has not asked the system for reduced motion.
		* @returns true when the entrance/exit choreography may run.
		*/
		function canAnimate() {
			if (typeof requestAnimationFrame !== "function") return false;
			try {
				if (typeof matchMedia !== "function") return true;
				const query = matchMedia("(prefers-reduced-motion: reduce)");
				return query === null || query === void 0 || query.matches !== true;
			} catch (cause) {
				return true;
			}
		}
		/**
		* Play one layer's entrance: park it at its off screen, then release it on the next frame so the
		* browser has an initial value to interpolate from.
		* @param node - layer root carrying a data-state attribute.
		*/
		function revealLayer(node) {
			if (node === null || node === void 0 || typeof node.setAttribute !== "function") return;
			if (canAnimate() !== true) return;
			const promote = () => {
				try {
					node.setAttribute("data-state", "open");
				} catch (cause) {
					return;
				}
			};
			try {
				node.setAttribute("data-state", "enter");
				requestAnimationFrame(() => {
					requestAnimationFrame(promote);
				});
			} catch (cause) {
				promote();
			}
		}
		/**
		* Remove one layer, letting its exit transition finish first when this document can animate.
		* @param node - layer root to detach.
		*/
		function hideLayer(node) {
			if (node === null || node === void 0) return;
			if (canAnimate() !== true) {
				detachNode(node);
				return;
			}
			try {
				node.setAttribute("data-state", "closing");
				setTimeout(() => {
					try {
						detachNode(node);
					} catch (cause) {
						return;
					}
				}, 170);
			} catch (cause) {
				detachNode(node);
			}
		}
		/**
		* Bump one element once: a short scale hop used for counters and status lines that changed.
		* @param node - element to nudge.
		*/
		function pulse(node) {
			if (node === null || node === void 0 || node.style === void 0 || node.style === null) return;
			if (canAnimate() !== true) return;
			try {
				node.style.transform = "scale(1.14)";
				setTimeout(() => {
					try {
						node.style.transform = "";
					} catch (cause) {
						return;
					}
				}, 130);
			} catch (cause) {
				return;
			}
		}
		/**
		* Fade the first rows of a freshly built list in, top down, with a small per row delay.
		* @param rows - rows in list order.
		*/
		function staggerRows(rows) {
			if (rows.length === 0) return;
			if (canAnimate() !== true) return;
			const moving = [];
			for (let index = 0; index < rows.length && index < 12; index += 1) {
				const row = rows[index];
				if (row === void 0 || row === null || row.style === void 0 || row.style === null) continue;
				try {
					row.style.opacity = "0";
					row.style.transform = "translateY(4px)";
					row.style.transitionDelay = String(index * 18) + "ms";
					moving.push(row);
				} catch (cause) {
					return;
				}
			}
			if (moving.length === 0) return;
			requestAnimationFrame(() => {
				requestAnimationFrame(() => {
					for (let index = 0; index < moving.length; index += 1) {
						try {
							moving[index].style.opacity = "1";
							moving[index].style.transform = "none";
							moving[index].style.transitionDelay = "";
						} catch (cause) {
							return;
						}
					}
				});
			});
		}
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

		/** @returns {{host: string, token: string}} the connection saved in this browser. */
		function readConnection() {
			try {
				const raw = localStorage.getItem(CONNECTION_KEY);
				if (raw === null || raw === "") return { host: "", token: "" };
				const value = JSON.parse(raw);
				return {
					host: typeof value?.host === "string" ? value.host : "",
					token: typeof value?.token === "string" ? value.token : ""
				};
			} catch (cause) {
				return { host: "", token: "" };
			}
		}

		/**
		* Persist the host and token for this browser only.
		* @param host - normalized host address.
		* @param token - personal access token.
		*/
		function writeConnection(host, token) {
			try {
				localStorage.setItem(CONNECTION_KEY, JSON.stringify({ host, token }));
				return true;
			} catch (cause) {
				noteFailure("connection save refused", cause);
				return false;
			}
		}

		/**
		* Decide the scheme for a host typed without one. Loopback and private addresses are
		* served over plain HTTP far more often than over TLS, so guess http for them.
		* @param raw - host part without scheme, port or path.
		* @returns "http" or "https".
		*/
		function bareHostScheme(raw) {
			const host = String(raw ?? "").toLowerCase().replace(/^\[/u, "").replace(/\]$/u, "");
			if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host === "::1" || host === "0.0.0.0") return "http";
			const octets = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/u.exec(host);
			if (octets === null) return "https";
			const first = Number(octets[1]);
			const second = Number(octets[2]);
			if (first === 0 || first === 10 || first === 127) return "http";
			if (first === 192 && second === 168) return "http";
			if (first === 172 && second >= 16 && second <= 31) return "http";
			return "https";
		}

		/**
		* Normalize a user-entered host address.
		* @param raw - entered value, with or without protocol.
		* @returns the normalized origin plus path, or null.
		*/
		function normalizeHost(raw) {
			const value = String(raw ?? "").trim();
			if (value === "") return null;
			let url;
			try {
				const bare = value.split("/")[0].split("?")[0].replace(/:\d+$/u, "");
				url = new URL(/^[a-z][a-z0-9+.-]*:\/\//iu.test(value) ? value : bareHostScheme(bare) + "://" + value);
			} catch (cause) {
				return null;
			}
			if (url.protocol !== "https:" && url.protocol !== "http:") return null;
			if (url.username !== "" || url.password !== "") return null;
			const path = url.pathname.replace(/\/+$/, "");
			return url.origin + (path === "/" ? "" : path);
		}

		/**
		* Resolve a share URL returned by the host against its base.
		* @param value - absolute or site-relative share URL.
		* @param host - host base address.
		* @returns a fully qualified URL.
		*/
		function absoluteUrl(value, host) {
			const url = String(value ?? "");
			if (/^https?:\/\//i.test(url)) return url;
			const base = String(host ?? "").replace(/\/+$/, "");
			return base + (url.startsWith("/") ? url : "/" + url);
		}

		/**
		* Copy text to the clipboard, with a selection-based fallback.
		* @param text - text to copy.
		* @returns a promise settling with whether the copy succeeded.
		*/
		function copyText(text) {
			const fallback = () => {
				try {
					const area = document.createElement("textarea");
					area.value = text;
					area.setAttribute("readonly", "");
					area.style.position = "fixed";
					area.style.top = "-1000px";
					area.style.opacity = "0";
					document.body.appendChild(area);
					area.select();
					const copied = document.execCommand("copy");
					area.remove();
					return copied;
				} catch (cause) {
					return false;
				}
			};
			try {
				if (navigator.clipboard !== void 0 && typeof navigator.clipboard.writeText === "function") {
					return navigator.clipboard.writeText(text).then(() => true, fallback);
				}
			} catch (cause) {
				return Promise.resolve(fallback());
			}
			return Promise.resolve(fallback());
		}

		/**
		* Translate a structured publish failure into a readable line.
		* @param body - plugin route response body.
		* @param t - localization lookup.
		* @returns the display line.
		*/
		function publishFailureMessage(body, t) {
			const code = body !== null && typeof body.error === "object" && body.error !== null ? body.error.code : "";
			if (code === "host_unreachable") return t("publish.unreachable");
			if (code === "unauthorized" || code === "forbidden" || code === "invalid_token") return t("publish.unauthorized");
			if (code === "payload_too_large") return t("publish.tooLarge");
			if (code === "rate_limited") return t("publish.rateLimited");
			const status = body !== null && typeof body.status === "number" ? " · HTTP " + body.status : "";
			const message = body !== null && typeof body.error === "object" && body.error !== null && typeof body.error.message === "string" ? body.error.message : "";
			return t("publish.failed") + (message === "" ? status : " (" + message + ")");
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
				hideLayer(overlay);
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
			revealLayer(overlay);
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
		//#region lib/types/client/connection.js
		/**
		* Mount the connection settings layer: host address plus personal token, saved on this machine.
		* @param config - initial values, localization, and save/close callbacks.
		* @returns a teardown function.
		*/
		function mountSettings(config) {
			const t = typeof config.t === "function" ? config.t : (key) => key;
			const previous = document.activeElement;
			const overlay = document.createElement("div");
			overlay.className = classes.settings;
			overlay.setAttribute("role", "dialog");
			overlay.setAttribute("aria-modal", "true");
			overlay.setAttribute("aria-label", t("settings.title"));
			const panel = document.createElement("div");
			panel.className = classes.settingsPanel;
			const head = document.createElement("div");
			head.className = classes.settingsHead;
			const heading = document.createElement("span");
			heading.className = classes.settingsTitle;
			heading.textContent = t("settings.title");
			head.appendChild(heading);
			const dismiss = document.createElement("button");
			dismiss.setAttribute("type", "button");
			dismiss.className = classes.pickerClose;
			dismiss.setAttribute("aria-label", t("settings.close"));
			dismiss.textContent = "×";
			head.appendChild(dismiss);
			panel.appendChild(head);
			const intro = document.createElement("p");
			intro.className = classes.settingsIntro;
			intro.textContent = t("settings.intro");
			panel.appendChild(intro);

			const modeField = document.createElement("div");
			modeField.className = classes.settingsField;
			const modeLabel = document.createElement("span");
			modeLabel.className = classes.settingsLabel;
			modeLabel.textContent = t("settings.defaultMode");
			modeField.appendChild(modeLabel);
			const modeRow = document.createElement("div");
			modeRow.className = classes.settingsModes;
			const modeButtons = [];
			let commandMode = "preview";
			/** Repaint the mode buttons from the current selection. */
			function paintModes() {
				for (const button of modeButtons) {
					button.setAttribute("aria-pressed", button.dataset.mode === commandMode ? "true" : "false");
				}
			}
			for (const option of [["preview", "settings.modePreview"], ["download", "settings.modeDownload"], ["publish", "settings.modePublish"]]) {
				const button = document.createElement("button");
				button.setAttribute("type", "button");
				button.className = classes.settingsMode;
				button.dataset.mode = option[0];
				button.textContent = t(option[1]);
				button.setAttribute("aria-pressed", option[0] === commandMode ? "true" : "false");
				button.addEventListener("click", () => {
					commandMode = option[0];
					paintModes();
					note("command mode", commandMode);
				});
				modeButtons.push(button);
				modeRow.appendChild(button);
			}
			modeField.appendChild(modeRow);
			const modeHint = document.createElement("span");
			modeHint.className = classes.settingsHint;
			modeHint.textContent = t("settings.defaultModeHint");
			modeField.appendChild(modeHint);
			panel.appendChild(modeField);

			const hostField = document.createElement("label");
			hostField.className = classes.settingsField;
			const hostLabel = document.createElement("span");
			hostLabel.className = classes.settingsLabel;
			hostLabel.textContent = t("settings.host");
			const hostInput = document.createElement("input");
			hostInput.className = classes.settingsInput;
			hostInput.setAttribute("type", "text");
			hostInput.setAttribute("autocomplete", "off");
			hostInput.setAttribute("spellcheck", "false");
			hostInput.setAttribute("placeholder", "margin.example.com");
			hostField.appendChild(hostLabel);
			hostField.appendChild(hostInput);
			const hostHint = document.createElement("span");
			hostHint.className = classes.settingsHint;
			hostHint.textContent = t("settings.hostHint");
			hostField.appendChild(hostHint);
			panel.appendChild(hostField);

			const tokenField = document.createElement("label");
			tokenField.className = classes.settingsField;
			const tokenLabel = document.createElement("span");
			tokenLabel.className = classes.settingsLabel;
			tokenLabel.textContent = t("settings.token");
			const tokenInput = document.createElement("input");
			tokenInput.className = classes.settingsInput;
			tokenInput.setAttribute("type", "password");
			tokenInput.setAttribute("autocomplete", "off");
			tokenInput.setAttribute("spellcheck", "false");
			tokenInput.setAttribute("placeholder", "mgn_tk_...");
			tokenField.appendChild(tokenLabel);
			tokenField.appendChild(tokenInput);
			const tokenHint = document.createElement("span");
			tokenHint.className = classes.settingsHint;
			tokenHint.textContent = t("settings.tokenHint");
			tokenField.appendChild(tokenHint);
			panel.appendChild(tokenField);

			const actions = document.createElement("div");
			actions.className = classes.settingsActions;
			const status = document.createElement("span");
			status.className = classes.settingsStatus;
			status.setAttribute("role", "status");
			const cancel = document.createElement("button");
			cancel.setAttribute("type", "button");
			cancel.className = classes.pickerTool;
			cancel.textContent = t("settings.cancel");
			const save = document.createElement("button");
			save.setAttribute("type", "button");
			save.className = classes.primary;
			save.textContent = t("settings.save");
			actions.appendChild(status);
			actions.appendChild(cancel);
			actions.appendChild(save);
			panel.appendChild(actions);
			overlay.appendChild(panel);

			const initial = config.initial !== void 0 && config.initial !== null ? config.initial : readConnection();
			hostInput.value = typeof initial.host === "string" ? initial.host : "";
			tokenInput.value = typeof initial.token === "string" ? initial.token : "";
			let disposed = false;

			/** Persist the default command mode, plus any credentials, on this machine's host. */
			function postSettings(patch) {
				if (typeof fetch !== "function") return Promise.resolve(false);
				return fetch(SETTINGS_ROUTE, {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify(patch)
				}).then((response) => response.json().then((body) => ({ response, body }))).then((result) => {
					return result.response.ok === true && result.body !== null && result.body !== void 0 && result.body.ok === true;
				}).catch((cause) => {
					noteFailure("save share settings failed", cause);
					return false;
				});
			}

			/** Read the saved default so the form opens on the behaviour /share currently uses. */
			function loadMode() {
				fetch(SETTINGS_ROUTE).then((response) => response.json()).then((body) => {
					if (disposed === true) return;
					const saved = body !== null && body !== void 0 ? body.settings : void 0;
					if (saved === null || saved === void 0) return;
					const value = saved.commandDefault;
					if (value === "preview" || value === "download" || value === "publish") {
						commandMode = value;
						paintModes();
					}
					if (typeof saved.host === "string" && saved.host.length > 0 && hostInput.value.trim().length === 0) hostInput.value = saved.host;
					if (saved.tokenSet === true && tokenInput.value.length === 0) tokenInput.setAttribute("placeholder", t("settings.tokenStored"));
				}).catch((cause) => {
					noteFailure("load share settings failed", cause);
				});
			}

			/** Paint one status line. */
			function setStatus(text, tone) {
				status.textContent = text;
				if (tone === "ok" || tone === "error") status.dataset.tone = tone;
				else if (typeof status.removeAttribute === "function") status.removeAttribute("data-tone");
			}

			/** Lock the form while the host is being tested. */
			function setBusy(value) {
				save.disabled = value;
				cancel.disabled = value;
				hostInput.disabled = value;
				tokenInput.disabled = value;
				for (const button of modeButtons) button.disabled = value;
				save.textContent = value === true ? t("settings.saving") : t("settings.save");
			}

			/** Read the reason a host probe reported, when it reported one. */
			function probeReason(body) {
				const error = body !== null && body !== void 0 ? body.error : void 0;
				const message = error !== null && error !== void 0 ? error.message : void 0;
				return typeof message === "string" ? message : "";
			}

			/** Validate, persist, then probe the host when one is configured. */
			function saveConnection() {
				const rawHost = hostInput.value.trim();
				const host = rawHost.length === 0 ? "" : normalizeHost(rawHost);
				const token = tokenInput.value.trim();
				const publishing = commandMode === "publish";
				if (rawHost.length > 0 && (host === null || host === void 0)) {
					setStatus(t("settings.invalidHost"), "error");
					hostInput.focus();
					return;
				}
				const address = typeof host === "string" ? host : "";
				if (publishing && address.length === 0) {
					setStatus(t("settings.hostRequired"), "error");
					hostInput.focus();
					return;
				}
				if (publishing && token.length < 8) {
					setStatus(t("settings.tokenRequired"), "error");
					tokenInput.focus();
					return;
				}
				if (address.length > 0) {
					hostInput.value = address;
					const storedToken = token.length >= 8 ? token : readConnection().token;
					if (writeConnection(address, storedToken) !== true) {
						setStatus(t("settings.saveFailed"), "error");
						return;
					}
				}
				const patch = { commandDefault: commandMode };
				if (address.length > 0) patch.host = address;
				if (token.length >= 8) patch.token = token;
				note("connection saved", { host: address, mode: commandMode, hasToken: token.length >= 8 });
				setBusy(true);
				setStatus(t("settings.testing"));
				postSettings(patch).then((persisted) => {
					if (disposed === true) return;
					if (persisted !== true) {
						setBusy(false);
						setStatus(t("settings.saveFailed"), "error");
						return;
					}
					const connection = { host: address, token: token.length >= 8 ? token : readConnection().token };
					if (address.length === 0) {
						setBusy(false);
						setStatus(t("settings.saved"), "ok");
						if (typeof config.onSaved === "function") config.onSaved(connection, true);
						window.setTimeout(() => {
							if (disposed !== true && typeof config.onClose === "function") config.onClose();
						}, 420);
						return;
					}
					fetch(PROBE_ROUTE, {
						method: "POST",
						headers: { "content-type": "application/json" },
						body: JSON.stringify({ host: address })
					}).then((response) => response.json().then((body) => ({ response, body }))).then((result) => {
						if (disposed === true) return;
						setBusy(false);
						const reachable = result.response.ok === true && result.body !== null && result.body !== void 0 && result.body.ok === true;
						if (reachable === true) {
							setStatus(t("settings.reachable"), "ok");
							if (typeof config.onSaved === "function") config.onSaved(connection, true);
							window.setTimeout(() => {
								if (disposed !== true && typeof config.onClose === "function") config.onClose();
							}, 420);
							return;
						}
						const reason = probeReason(result.body);
						setStatus(reason === "" ? t("settings.savedButUnreachable") : t("settings.savedButUnreachable") + " (" + reason + ")", "error");
						if (typeof config.onSaved === "function") config.onSaved(connection, false);
					}).catch((cause) => {
						if (disposed === true) return;
						setBusy(false);
						setStatus(t("settings.savedButUnreachable"), "error");
						if (typeof config.onSaved === "function") config.onSaved(connection, false);
						noteFailure("probe host failed", cause);
					});
				});
			}

			/** Ask the owner to close this layer. */
			function close() {
				if (typeof config.onClose === "function") config.onClose();
			}

			function onKeyDown(event) {
				if (event !== null && event !== void 0 && (event.key === "Escape" || event.key === "Esc")) close();
			}

			function teardown() {
				if (disposed === true) return;
				disposed = true;
				if (typeof document.removeEventListener === "function") document.removeEventListener("keydown", onKeyDown, true);
				hideLayer(overlay);
				if (previous !== null && previous !== void 0 && typeof previous.focus === "function") previous.focus();
			}

			dismiss.addEventListener("click", close);
			cancel.addEventListener("click", close);
			save.addEventListener("click", saveConnection);
			hostInput.addEventListener("keydown", (event) => {
				if (event !== null && event !== void 0 && event.key === "Enter") {
					if (typeof event.preventDefault === "function") event.preventDefault();
					tokenInput.focus();
				}
			});
			tokenInput.addEventListener("keydown", (event) => {
				if (event !== null && event !== void 0 && event.key === "Enter") {
					if (typeof event.preventDefault === "function") event.preventDefault();
					saveConnection();
				}
			});
			overlay.addEventListener("click", (event) => {
				if (event !== null && event !== void 0 && event.target === overlay) close();
			});
			if (typeof document.addEventListener === "function") document.addEventListener("keydown", onKeyDown, true);
			if (appendLayer(overlay) !== true) {
				disposed = true;
				if (typeof document.removeEventListener === "function") document.removeEventListener("keydown", onKeyDown, true);
				return () => {};
			}
			revealLayer(overlay);
			if (typeof fetch === "function") loadMode();
			hostInput.focus();
			return teardown;
		}

		/**
		* Mount the publish result layer: the address just created plus copy/open actions.
		* @param config - share title, URL, localization, and close callback.
		* @returns a teardown function.
		*/
		function mountResult(config) {
			const t = typeof config.t === "function" ? config.t : (key) => key;
			const previous = document.activeElement;
			const overlay = document.createElement("div");
			overlay.className = classes.result;
			overlay.setAttribute("role", "dialog");
			overlay.setAttribute("aria-modal", "true");
			overlay.setAttribute("aria-label", t("publish.title"));
			const panel = document.createElement("div");
			panel.className = classes.resultPanel;
			const title = document.createElement("h2");
			title.className = classes.resultTitle;
			title.textContent = t("publish.title");
			panel.appendChild(title);
			const shareTitle = document.createElement("p");
			shareTitle.className = classes.resultSub;
			shareTitle.textContent = typeof config.shareTitle === "string" ? config.shareTitle : "";
			panel.appendChild(shareTitle);
			const code = document.createElement("code");
			code.className = classes.resultCode;
			code.textContent = typeof config.url === "string" ? config.url : "";
			panel.appendChild(code);
			const actions = document.createElement("div");
			actions.className = classes.resultActions;
			const noteLine = document.createElement("span");
			noteLine.className = classes.resultNote;
			noteLine.setAttribute("role", "status");
			const copy = document.createElement("button");
			copy.setAttribute("type", "button");
			copy.className = classes.primary;
			copy.textContent = t("publish.copy");
			const open = document.createElement("a");
			open.className = classes.pickerTool;
			open.href = typeof config.url === "string" ? config.url : "";
			open.target = "_blank";
			open.rel = "noopener noreferrer";
			open.textContent = t("publish.open");
			const closeButton = document.createElement("button");
			closeButton.setAttribute("type", "button");
			closeButton.className = classes.pickerTool;
			closeButton.textContent = t("publish.close");
			actions.appendChild(noteLine);
			actions.appendChild(open);
			actions.appendChild(copy);
			actions.appendChild(closeButton);
			panel.appendChild(actions);
			overlay.appendChild(panel);
			let disposed = false;

			function close() {
				if (typeof config.onClose === "function") config.onClose();
			}

			function onKeyDown(event) {
				if (event !== null && event !== void 0 && (event.key === "Escape" || event.key === "Esc")) close();
			}

			function teardown() {
				if (disposed === true) return;
				disposed = true;
				if (typeof document.removeEventListener === "function") document.removeEventListener("keydown", onKeyDown, true);
				hideLayer(overlay);
				if (previous !== null && previous !== void 0 && typeof previous.focus === "function") previous.focus();
			}

			copy.addEventListener("click", () => {
				copyText(config.url).then((ok) => {
					if (disposed === true) return;
					noteLine.textContent = ok === true ? t("publish.copied") : t("publish.copyFailed");
					pulse(noteLine);
				});
			});
			closeButton.addEventListener("click", close);
			overlay.addEventListener("click", (event) => {
				if (event !== null && event !== void 0 && event.target === overlay) close();
			});
			if (typeof document.addEventListener === "function") document.addEventListener("keydown", onKeyDown, true);
			if (appendLayer(overlay) !== true) {
				disposed = true;
				if (typeof document.removeEventListener === "function") document.removeEventListener("keydown", onKeyDown, true);
				return () => {};
			}
			revealLayer(overlay);
			copy.focus();
			return teardown;
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
			const publishSelected = pickerButton(t("picker.publish"), classes.pickerTool);
			const cancel = pickerButton(t("picker.cancel"), classes.pickerTool);
			footer.appendChild(generate);
			footer.appendChild(publishSelected);
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
				const counterText = String(t("picker.selected")).split("N").join(String(count));
				const changed = typeof counter.textContent === "string" && counter.textContent !== "" && counter.textContent !== counterText;
				counter.textContent = counterText;
				if (changed === true) pulse(counter);
				const usable = count > 0 && busy !== true;
				for (const button of [generate, publishSelected]) {
					if (usable === true) {
						if (typeof button.removeAttribute === "function") button.removeAttribute("disabled");
					} else {
						button.setAttribute("disabled", "disabled");
					}
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
				const rows = [];
				for (let index = 0; index < entries.length; index += 1) {
					const row = buildRow(entries[index]);
					rowById[entries[index].id] = row;
					list.appendChild(row);
					rows.push(row);
				}
				staggerRows(rows);
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
			/** Hand the picked ids to the publisher so only those messages reach the host. */
			function publishPicked() {
				const ids = selectedIds();
				if (ids.length === 0) {
					note("picker publish skipped: nothing selected");
					return;
				}
				if (busy === true) return;
				if (typeof config.onPublish !== "function") {
					note("picker publish unavailable: no publisher wired");
					return;
				}
				note("picker publish", { picked: ids.length });
				config.onPublish(ids);
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
				hideLayer(overlay);
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
			publishSelected.addEventListener("click", publishPicked);
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
			revealLayer(overlay);
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
			const [connecting, setConnecting] = react.useState(false);
			const [published, setPublished] = react.useState(null);
			const seq = react.useRef(0);
			const triggerRef = react.useRef(null);
			const hostRef = react.useRef(null);
			const menuRef = react.useRef(null);
			const menuShown = react.useRef(false);
			const previewRef = react.useRef(null);
			const settingsRef = react.useRef(null);
			const resultRef = react.useRef(null);
			const pendingPublish = react.useRef(false);
			/** Pick ids carried across the connection-settings detour of a publish. */
			const pendingPick = react.useRef(null);
			react.useEffect(() => {
				seq.current += 1;
				setFailure(null);
				setBusy(false);
				setPicking(false);
				setConnecting(false);
				setPublished(null);
				pendingPublish.current = false;
			}, [sessionId]);
			react.useEffect(() => () => {
				if (typeof previewRef.current === "function") previewRef.current();
				previewRef.current = null;
				if (typeof settingsRef.current === "function") settingsRef.current();
				settingsRef.current = null;
				if (typeof resultRef.current === "function") resultRef.current();
				resultRef.current = null;
			}, []);
			react.useEffect(() => {
				if (open !== true) {
					menuShown.current = false;
					return void 0;
				}
				const animate = menuShown.current !== true;
				menuShown.current = true;
				return mountMenu(animate);
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
			/**
			* Send this session's native snapshot to the saved host, or open connection settings first.
			* @param hostOverride - newly saved host, used right after settings.
			* @param tokenOverride - newly saved token, used right after settings.
			*/
			const publishToHost = react.useCallback((hostOverride, tokenOverride, pickIds) => {
				if (sessionId === void 0 || sessionId === null || sessionId === "") {
					note("publish skipped: this slot was not given a session id");
					return;
				}
				const picked = Array.isArray(pickIds) ? pickIds.slice() : pendingPick.current;
				const connection = readConnection();
				const host = typeof hostOverride === "string" && hostOverride !== "" ? hostOverride : connection.host;
				const token = typeof tokenOverride === "string" && tokenOverride !== "" ? tokenOverride : connection.token;
				if (host === "" || token === "") {
					pendingPick.current = picked;
					pendingPublish.current = true;
					setOpen(false);
					setConnecting(true);
					return;
				}
				seq.current += 1;
				const current = seq.current;
				setBusy(true);
				setFailure(null);
				setOpen(false);
				note("publish to host", { host, picked: Array.isArray(picked) ? picked.length : 0 });
				const payload = { sessionId, host, token };
				if (Array.isArray(picked) && picked.length > 0) payload.pick = picked;
				fetch(PUBLISH_ROUTE, {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify(payload)
				}).then((response) => response.json().then((body) => ({ response, body }))).then((result) => {
					if (seq.current !== current) return;
					pendingPick.current = null;
					setBusy(false);
					const body = result.body;
					if (result.response.ok === true && body !== null && body !== void 0 && body.ok === true && body.share !== null && typeof body.share === "object") {
						setPublished({
							url: absoluteUrl(body.share.url, host),
							shareTitle: typeof body.share.title === "string" ? body.share.title : String(sessionId)
						});
						return;
					}
					const label = publishFailureMessage(body, t);
					note("publish to host failed", { label });
					setFailure(label);
					setOpen(true);
				}).catch((cause) => {
					if (seq.current !== current) return;
					setBusy(false);
					setFailure(t("publish.unreachable"));
					setOpen(true);
					noteFailure("publish to host failed", cause);
				});
			}, [sessionId, t]);
			react.useEffect(() => {
				if (connecting !== true) return void 0;
				const teardown = mountSettings({
					initial: readConnection(),
					t: t,
					onSaved: (connection, reachable) => {
						if (reachable !== true) return;
						if (pendingPublish.current !== true) return;
						pendingPublish.current = false;
						setConnecting(false);
						publishToHost(connection.host, connection.token);
					},
					onClose: () => {
						pendingPublish.current = false;
						setConnecting(false);
					}
				});
				settingsRef.current = teardown;
				return () => {
					if (typeof settingsRef.current === "function") settingsRef.current();
					settingsRef.current = null;
				};
			}, [connecting, t, publishToHost]);
			react.useEffect(() => {
				if (published === null) return void 0;
				const teardown = mountResult({
					url: published.url,
					shareTitle: published.shareTitle,
					t: t,
					onClose: () => {
						setPublished(null);
					}
				});
				resultRef.current = teardown;
				return () => {
					if (typeof resultRef.current === "function") resultRef.current();
					resultRef.current = null;
				};
			}, [published, t]);
			const actions = [{
				id: PREVIEW_ITEM,
				label: t("menu.preview")
			}, {
				id: DOWNLOAD_ITEM,
				label: t("menu.download")
			}, {
				id: PICK_ITEM,
				label: t("menu.pick")
			}, {
				id: PUBLISH_HOST_ITEM,
				label: t("menu.publishHost")
			}, {
				id: CONNECT_ITEM,
				label: t("menu.connect")
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
				else if (id === PUBLISH_HOST_ITEM) publishToHost();
				else if (id === CONNECT_ITEM) {
					pendingPublish.current = false;
					setOpen(false);
					setConnecting(true);
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
						},
						onPublish: (ids) => {
							setPicking(false);
							publishToHost(void 0, void 0, ids);
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
			function mountMenu(animate) {
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
					if (animate === true) revealLayer(menu);
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
			"menu.publishHost": "发布到边注...",
			"menu.connect": "连接设置...",
			"preview.download": "下载",
			"preview.title": "分享预览",
			"preview.close": "关闭预览",
			"settings.title": "连接设置",
			"settings.intro": "先选 Share 命令的默认行为；要发布到边注时，再填主机地址与个人令牌。",
			"settings.host": "主机地址",
			"settings.defaultMode": "Share 命令默认行为",
			"settings.defaultModeHint": "在会话里直接输入 /share 就用这个行为；/share download、/share publish 可临时覆盖它。",
			"settings.modePreview": "预览页",
			"settings.modeDownload": "下载文件",
			"settings.modePublish": "发布到边注",
			"settings.hostRequired": "发布到边注需要先填主机地址。",
			"settings.tokenRequired": "发布到边注需要先填个人令牌（至少 8 位）。",
			"settings.tokenStored": "主机上已有令牌，留空保持不变。",
			"settings.hostHint": "例如 margin.example.com 或 127.0.0.1:8787；本机/内网地址按 http，其它按 https。",
			"settings.token": "个人令牌",
			"settings.tokenHint": "在边注的「连接与令牌」里生成；只保存在这台机器的浏览器里。",
			"settings.save": "保存并测试",
			"settings.saving": "正在测试...",
			"settings.cancel": "取消",
			"settings.close": "关闭",
			"settings.missing": "请填写主机地址和令牌。",
			"settings.invalidHost": "主机地址格式不正确。",
			"settings.saveFailed": "无法保存连接设置。",
			"settings.testing": "正在测试主机...",
			"settings.reachable": "已保存 · 主机可达",
			"settings.saved": "已保存。",
			"settings.savedButUnreachable": "已保存，但暂时无法连接主机。",
			"publish.title": "已发布到边注",
			"publish.sub": "这次会话已经有一份只读地址。",
			"publish.copy": "复制链接",
			"publish.open": "打开记录",
			"publish.close": "关闭",
			"publish.copied": "链接已复制",
			"publish.copyFailed": "复制失败，请手动选择链接。",
			"publish.failed": "发布失败",
			"publish.unreachable": "无法连接边注主机",
			"publish.unauthorized": "令牌无效或没有发布权限",
			"publish.tooLarge": "这份记录超过主机允许的大小",
			"publish.rateLimited": "发布太频繁，请稍后再试",
			"picker.title": "选择要分享的消息",
			"picker.loading": "正在读取会话...",
			"picker.loadFailed": "读取消息失败",
			"picker.selectAll": "全选",
			"picker.selectNone": "全不选",
			"picker.selected": "已选 N 条",
			"picker.noneSelected": "请至少选择一条消息",
			"picker.publish": "发布选中的消息",
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
			"menu.publishHost": "Publish to MARGIN...",
			"menu.connect": "Connection settings...",
			"preview.download": "Download",
			"preview.title": "Share preview",
			"preview.close": "Close preview",
			"settings.title": "Connection settings",
			"settings.intro": "Pick what /share does by default; add a host address and token when you want to publish to MARGIN.",
			"settings.host": "Host address",
			"settings.defaultMode": "Default /share behaviour",
			"settings.defaultModeHint": "Plain /share in a session uses this; /share download and /share publish override it once.",
			"settings.modePreview": "Preview page",
			"settings.modeDownload": "Download file",
			"settings.modePublish": "Publish to MARGIN",
			"settings.hostRequired": "Publishing to MARGIN needs a host address first.",
			"settings.tokenRequired": "Publishing to MARGIN needs a personal token (at least 8 characters).",
			"settings.tokenStored": "A token is already saved on the host; leave blank to keep it.",
			"settings.hostHint": "For example margin.example.com or 127.0.0.1:8787; loopback and private addresses use http, everything else https.",
			"settings.token": "Personal token",
			"settings.tokenHint": "Generate one under Connections & tokens in MARGIN; it stays in this browser.",
			"settings.save": "Save and test",
			"settings.saving": "Testing...",
			"settings.cancel": "Cancel",
			"settings.close": "Close",
			"settings.missing": "Enter both the host address and a token.",
			"settings.invalidHost": "That host address is not valid.",
			"settings.saveFailed": "Could not save the connection.",
			"settings.testing": "Testing the host...",
			"settings.reachable": "Saved · host reachable",
			"settings.saved": "Saved.",
			"settings.savedButUnreachable": "Saved, but the host is not reachable right now.",
			"publish.title": "Published to MARGIN",
			"publish.sub": "This session now has a read-only address.",
			"publish.copy": "Copy link",
			"publish.open": "Open record",
			"publish.close": "Close",
			"publish.copied": "Link copied",
			"publish.copyFailed": "Copy failed; select the link manually.",
			"publish.failed": "Publish failed",
			"publish.unreachable": "Could not reach the MARGIN host",
			"publish.unauthorized": "The token is invalid or cannot publish",
			"publish.tooLarge": "This record exceeds the host size limit",
			"publish.rateLimited": "Publishing too often; try again shortly",
			"picker.title": "Pick the messages to share",
			"picker.loading": "Loading messages...",
			"picker.loadFailed": "Could not load messages",
			"picker.selectAll": "Select all",
			"picker.selectNone": "Select none",
			"picker.selected": "N selected",
			"picker.noneSelected": "Select at least one message",
			"picker.publish": "Publish selected",
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
