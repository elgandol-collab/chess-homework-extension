// Opens the trainer in a full tab when the toolbar icon is clicked (a full tab lets us show the standard "leave page?" prompt mid-exercise).
chrome.action.onClicked.addListener(() => { chrome.tabs.create({ url: chrome.runtime.getURL('app.html') }); });
