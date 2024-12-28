'use strict';

let alreadyInjected;

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'citationSaverLink',
    title: 'Get citation link',
    contexts: [ 'selection' ]
  });
});

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

chrome.runtime.onInstalled.addListener(() => {
  chrome.tabs.create({ url: 'https://johnpleung.github.io/citation-saver/#czoidGhhIixlOiJlci4iLGExOiJ0Mzt3Mjt5MiIsYTI6InQxO2kxO2w1Iix2OjE=' });
});

chrome.tabs.onUpdated.addListener(async function (tabId , info, tab) {
  if (info.status === 'complete') {
    if (tab && tab.url && tab.url.indexOf('#') > -1) {
      await injectContentScripts();
    }
  }
});

async function getTabId () {
    return await new Promise(async resolve => {
      await chrome.tabs.query({active: true, currentWindow:true}, tabs => {
        return resolve(tabs?.length ? tabs[0]?.id : null);
      });
    });
}

async function injectContentScripts() {
  let resources = [ 'contentScripts/vendor/jquery.js', 'contentScripts/common.js' ];
  let tabId = await getTabId();
  if (tabId) {
    let result = await chrome.scripting.executeScript({
      target : { tabId },
      func: () => typeof citationSaver !== 'undefined' });
    alreadyInjected = result[0].result;
    if (!alreadyInjected) {
      alreadyInjected = true;
      await chrome.scripting.executeScript({
        target : { tabId },
        files : resources,
      });
      await chrome.scripting.insertCSS({
        target : { tabId },
        files : [ 'contentScripts/styles.css' ]
      });
    }
  }
}