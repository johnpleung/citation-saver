'use strict';

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'citationSaverLink',
    title: 'Get citation link',
    contexts: [ 'selection' ]
  });
});

chrome.contextMenus.onClicked.addListener(() => {
  injectContentScripts(true);
});

chrome.runtime.onInstalled.addListener(() => {
  chrome.tabs.create({ url: 'https://johnpleung.github.io/citation-saver/#czoidGhhIixlOiJlci4iLGExOiJ0Mzt3Mjt5MiIsYTI6InQxO2kxO2w1Iix2OjE=' });
});

chrome.tabs.onUpdated.addListener(function (tabId , info, tab) {
  if (info.status === 'complete') {
    if (tab && tab.url && tab.url.indexOf('#') > -1) {
      injectContentScripts(false);
    }
  }
});

function injectContentScripts(processSelection) {
  try {
    chrome.tabs.executeScript({ file: 'contentScripts/vendor/jquery.js' }, () => {
      chrome.tabs.executeScript({ file: 'contentScripts/common.js' }, () => {
        if (processSelection) {
          chrome.tabs.executeScript({ file: 'contentScripts/processSelection.js' });
        }
        chrome.tabs.insertCSS({ file: 'contentScripts/styles.css' });
      });
    });
  } catch (err) {}
}