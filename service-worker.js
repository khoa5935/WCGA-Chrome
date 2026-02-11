let autoRefreshCheck;
let updateAnalysisOnDOMChanges;
const actions = {
    updateContrastChecker,
    getDocumentList,
    getResultsFromFrame,
    showResultsFromFrame,
    highlightElements,
    cleanHighlightedElements,
    disconnectMutationObservers,
    connectMutationObserver,
    closeWidget,
    getCurrentColorMatrix,
    sendCurrentColorMatrix,
    messageToPanel,
    openExtension,
    update,
    onPanelOpen,
    onPanelClose
};

const URLBlackList = [
    'about:blank',
    'apis.google.com',
    'accounts.google.com/o/oauth',
    'doubleclick.net',
    'staticxx.facebook.com',
    'platform.twitter.com/widgets/widget_iframe',
    'platform.twitter.com/widgets/follow_button',
    'www.google.com/uviewer'
];

// if manifest v2
chrome.browserAction?.onClicked.addListener(executeFunctionInContentScripts);

// if manifest v3
chrome.action?.onClicked.addListener(executeFunctionInContentScripts);

chrome.tabs.onActivated.addListener(onActivateTab);

chrome.runtime.onConnect.addListener(messageReceiver);

chrome.tabs.onUpdated.addListener(onUpdated);

chrome.runtime.onMessage.addListener(messageReceiver);

chrome.tabs.onRemoved.addListener(onRemoved);

function onRemoved(tabId, removeInfo) {
    if (removeInfo.isWindowClosing) {
        saveSetting('pinnedTabs', '');
    } else {
        getPinnedInfo((pinnedInfo) => {
            const pinnedTabs = (pinnedInfo && pinnedInfo.pinnedTabs?.split(',')) || [];
            const isTabIncluded = pinnedTabs.indexOf(`${tabId}`) > -1;
            if (isTabIncluded) {
                pinnedTabs.splice(pinnedTabs.indexOf(`${tabId}`), 1);
            }
            saveSetting('pinnedTabs', pinnedTabs.join(','));
        });
    }
}

function onActivateTab(activeInfo) {
    getPinnedInfo((pinnedInfo) => {
        let message = {action: 'getDomainInfo', params: {}};
        sendMessage(activeInfo.tabId, message, {}, (domainInfo) => {
            message = {action: 'updatePinnedStatus', params: {}};
            sendMessage(activeInfo.tabId, message, {}, (domainInfo) => {
                message = {action: 'isOpen', params: {}};
                sendMessage(activeInfo.tabId, message, {}, (isOpenInfo) => {
                    if(isOpenInfo?.isOpen) {
                        return;
                    }
                    const URLsToPinTo = (pinnedInfo && pinnedInfo.pinnedByURL?.split(',')) || [];
                    const URL = domainInfo?.params?.URL;
                    const isURLIncluded = URLsToPinTo.indexOf(URL) > -1 && !!URL.trim().length;
                    if (isURLIncluded) {
                        openExtension(activeInfo.tabId);
                        return;
                    }
                    const domainsToPinTo = (pinnedInfo && pinnedInfo.pinnedByDomain?.split(',')) || [];
                    const domain = domainInfo?.params?.domain;
                    const isDomainIncluded = domainsToPinTo.indexOf(domain) > -1 && !!domain.trim().length;
                    if (isDomainIncluded) {
                        openExtension(activeInfo.tabId);
                    }
                });
            })
        });
    });
}

function update(tabId, params) {
    getPinnedInfo((pinnedInfo) => {
        const pinnedTabs = (pinnedInfo && pinnedInfo.pinnedTabs?.split(',')) || [];
        const isTabIncluded = pinnedTabs.indexOf(`${tabId}`) > -1;
        const domain = params.domain;
        const domainsToPinTo = (pinnedInfo && pinnedInfo.pinnedByDomain?.split(',')) || [];
        const isDomainIncluded = domainsToPinTo.indexOf(domain) > -1 && !!domain.trim().length;
        const URLsToPinTo = (pinnedInfo && pinnedInfo.pinnedByURL?.split(',')) || [];
        const URL = params.URL;
        const isURLIncluded = URLsToPinTo.indexOf(URL) > -1;
        if (isTabIncluded || isDomainIncluded || isURLIncluded) {
            openExtension(tabId, {shouldPinToTab: isTabIncluded});
        }
    });
}

function onUpdated(tabId, changeInfo, tabInfo) {
    if(changeInfo.status === 'complete') {
        const message = {action: 'isOpen', params: {}};
        sendMessage(tabId, message, {}, () => {
            sendMessage(tabId, {action: 'update', params: {}}, {frameId: 0})
        });
    }
}

function executeFunctionInContentScripts(tab, params = {}) {
    const tabId = tab.id;
    Object.assign(params, {browserLanguage: getLanguage()});

    sendMessage(tabId, {execute: true}, {frameId: 0}, (responseMessage) => {
        showContrastChecker(tabId, params)();
    });
}

function getDocumentList(tabId) {
    chrome.webNavigation.getAllFrames(
        {tabId},
        function (details) {
            let documents = [];
            for (let i = 0; i < details.length; i++) {
                if (!isInBlackList(details[i].url)) {
                    let {frameId, url, parentFrameId, errorOccurred} = details[i];
                    if(!errorOccurred) {
                        documents.push({url, frameId, parentFrameId});
                    }
                }
            }
            documents.sort(function (a, b) {
                return a.frameId - b.frameId;
            });
            const message = {
                action: 'updateListOfDocuments',
                params: {documents}
            };
            sendMessage(tabId, message, {}, () => {
            });
        }
    );
}

function isInBlackList(urlToCheck) {
    const URLBlackListLength = URLBlackList.length;

    for (let i = 0; i < URLBlackListLength; i++) {
        if (urlToCheck.indexOf(URLBlackList[i]) >= 0) {
            return true;
        }
    }
    return false;
}

function messageReceiver(message, sender, sendResponse) {
    const tabId = sender?.tab.id;
    const frameId = sender?.frameId;

    if (!message.action) {
        actions[message] && actions[message](tabId, frameId);
    } else {
        actions[message.action] && actions[message.action](tabId, message.params, frameId);
    }
    sendResponse && sendResponse({});
}

function messageToPanel(tabId, params) {
    const message = {action: 'listenMessage', params: params};
    sendMessage(tabId, message, {})
}

function sendActionToContrastCheckerScript(tabId, action, params = {}) {
    const message = {tabId, action, params};

    chrome.storage
        .local.get(['contrastLevelChecker', 'autoRefreshCheck', 'updateAnalysisOnDOMChanges'], sendActionWithSettings);

    function sendActionWithSettings(settings) {
        message.settings = settings;

        sendMessage(tabId, message, {});
    }
}

function showContrastChecker(tabId, params = {}) {
    return function () {
        sendActionToContrastCheckerScript(tabId, 'toggle', params);
    }
}

function updateContrastChecker(tabId) {
    sendActionToContrastCheckerScript(tabId, 'update');
}

function getResultsFromFrame(tabId, params) {
    const frameId = params.frameId;

    const message = {action: 'getResultsFromFrame', params: params};
    sendMessage(tabId, message, {frameId});
}

function connectMutationObserver(tabId, params) {
    const frameId = params.frameId;
    const options = {};
    if(frameId === undefined) {
        options.frameId = frameId;
    }
    const message = {action: 'connectMutationObserver', params: params};
    sendMessage(tabId, message, {frameId});
}

function disconnectMutationObservers(tabId, params, callback) {
    const frameId = params.frameId;
    const options = {};
    if(frameId === undefined) {
        options.frameId = frameId;
    }

    const message = {action: 'disconnectMutationObserver', params: params};
    sendMessage(tabId, message, {frameId});
}

function highlightElements(tabId, params) {
    const frames = params.frames;
    const frameIds = frames.split(',').map((frameId) => parseInt(frameId));

    frameIds.forEach((frameId, index) => {
        params.scrollIntoView = index === 0;
        const message = {action: 'highlightElementsInDocument', params: params};
        sendMessage(tabId, message, {frameId});
    });
}

function cleanHighlightedElements(tabId, params) {
    const message = {action: 'cleanHighlightedElements', params: params};
    sendMessage(tabId, message, {});
}

function showResultsFromFrame(tabId, params) {
    const message = {action: 'showResultsFromFrame', params: params};
    sendMessage(tabId, message, {frameId: 0})
}

function onPanelOpen(tabId) {
    const message = {action: 'onPanelOpen', params: {}};
    sendMessage(tabId, message, {})
}

function onPanelClose(tabId) {
    const message = {action: 'onPanelClose', params: {}};
    sendMessage(tabId, message, {})
}

function closeWidget(tabId) {
    const message = {action: 'closeWidget', params: {}};
    sendMessage(tabId, message, {})
}

function getCurrentColorMatrix(tabId, params) {
    const message = {action: 'getCurrentColorMatrix', params: {}};
    sendMessage(tabId, message, {})
}

function sendCurrentColorMatrix(tabId, params) {
    const message = {action: 'setCurrentColorMatrix', params: params};
    sendMessage(tabId, message, {})
}

function openExtension(tabId) {
    executeFunctionInContentScripts({id: tabId});
}

function getPinnedInfo(callback) {
    const savedSettings = chrome.storage.local.get(['pinnedTabs', 'pinnedByDomain', 'pinnedByURL', 'pinned'], (settings) => {
        callback(settings);
    });

    try {
        // FF: chrome.storage.local.get returns a promise
        // this try-catch prevents error in Chrome
        savedSettings.then((settings) => {
            callback(settings);
        });
    } catch (err) {
    }

}

function saveSetting(optionId, value) {
    const option = {};
    option[optionId] = value;
    chrome.storage.local.set(option);
}

function sendMessage(tabId, message, options, callback = () => {
}) {
    (async () => {
        try {
            message.tabId = tabId;
            const response = await chrome.tabs.sendMessage(tabId, message, options);
            callback(response);
        } catch (err) {
            // Content script not yet injected or tab doesn't exist
        }
    })();
}

function getLanguage() {
    return chrome.i18n.getUILanguage();
}