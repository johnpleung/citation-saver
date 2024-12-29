'use strict';

/**
 * Initializes the main functionality
 * @return {void}
 */
async function init () {
	// When the extension is installed
	chrome.runtime.onInstalled.addListener(() => {
		// Add context menu item
		chrome.contextMenus.create({
			id: 'citationSaverLink',
			title: 'Get citation link',
			contexts: [ 'selection' ]
		});
		// Launch Welcome tab
		chrome.tabs.create({ url: 'https://johnpleung.github.io/citation-saver/#czoidGhhIixlOiJlci4iLGExOiJ0Mzt3Mjt5MiIsYTI6InQxO2kxO2w1Iix2OjE=' });
	});
	// Context menu item
	chrome.contextMenus.onClicked.addListener(async () => {
		let tabId = await getTabId();
		if (tabId) {
			await injectContentScripts();
			await chrome.scripting.executeScript({
				target : { tabId },
				func: async () => {
					await citationSaver.main.processSelection();
				}
			});
		}
	});
	// When tab is updated
	chrome.tabs.onUpdated.addListener(async function (tabId , info, tab) {
		if (info.status === 'complete') {
			if (tab && tab.url && tab.url.indexOf('#') > -1) {
				await injectContentScripts();
			}
		}
	});
}

/**
 * Gets the ID of the active tab
 * @return {number}
 */
async function getTabId () {
	return await new Promise(async resolve => {
		await chrome.tabs.query({ active: true, currentWindow:true }, tabs => {
			return resolve(tabs?.length ? tabs[0]?.id : null);
		});
	});
}

/**
 * Gets the ID of the active tab
 * @return {void}
 */
async function injectContentScripts() {
	let tabId = await getTabId();
	if (tabId) {
		let result = await chrome.scripting.executeScript({
			target: { tabId },
			func: () => typeof citationSaver !== 'undefined'
		});
		let alreadyInjected = result[0].result;
		if (!alreadyInjected) {
			// Inject JS
			await chrome.scripting.executeScript({
				target: { tabId },
				files: [ 'contentScripts/common.js' ]
			});
			// Inject CSS
			await chrome.scripting.insertCSS({
				target: { tabId },
				files: [ 'contentScripts/styles.css' ]
			});
		}
	}
}

init();