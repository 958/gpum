/**
 * @fileOverview Gmail mapper class
 * @name gmail.js
 * @author mooz <stillpedant@gmail.com>
 * @license The MIT License
 * @requires util.jsm
 * @requires http.js
 */

const EXPORTED_SYMBOLS = ["Gmail", "gmail"];

const Cc = Components.classes;
const Ci = Components.interfaces;

function loadScript(path, context) {
    Cc["@mozilla.org/moz/jssubscript-loader;1"].getService(Ci.mozIJSSubScriptLoader).loadSubScript(path, context);
}

function loadModule(name, context) {
    context = context || this;

    let path = "resource://gmml-modules/" + name;

    try {
        if (name.lastIndexOf(".jsm") !== -1)
            Components.utils.import(path, context);
        else
            loadScript(path, context);
    } catch (x) {}
}

loadModule("util.jsm");
loadModule("http.jsm");

function Gmail(args) {
    args = args || {};

    const protocol = args.protocol || "https://";
    const base     = "mail.google.com";

    let mailURL = protocol + base + (args.domain ? "/a/" + args.domain + "/" : "/mail/");

    let inboxLabel, atomLabel, unreadLabel;

    if (true)
    {
        inboxLabel  = "#inbox";
        unreadLabel = "#inbox";
        atomLabel   = "";
    }
    else
    {
        inboxLabel  = "#all";
        unreadLabel = "#search/l:unread";
        atomLabel   = "unread";
    }

    // export
    this.username = args.username;
    this.password = args.password;

    this.mailURL = mailURL;

    this.inboxLabel  = inboxLabel;
    this.unreadLabel = unreadLabel;
    this.atomLabel   = atomLabel;

    this.unreads = [];

    this.registeredWindows  = [];
    this.timer              = null;
    this.timerEvent         = null;
    this._schedulerInterval = this.SCHEDULER_INTERVAL_MIN;

    this.unreadCount = -1;
}

Gmail.prototype = {
    processUnreads:
    function processUnreads(callback, onerror) {
        const self = this;

        let (reqURL = self.mailURL + "feed/atom" + self.atomLabel)
        {
            // util.messageDebug("requesting :: " + reqURL);

            http.get(reqURL,
                     function (req) {
                         // util.messageDebug("got response :: " + req.status);

                         if (req.status === 200)
                             callback(req);
                         else
                             onerror(req);
                     }, null,
                     {
                         header   : { "Content-type" : "application/xml" },
                         username : self.username,
                         password : self.password
                     });
        };
    },

    post:
    function post(args) {
        const self = this;

        if (!self.gmailAt)
            self.getAt(function () { self.post(args); });
        else
        {
            let threadID = args.threadID;
            let action   = args.action;

            let postURL = self.mailURL.replace("http:", "https:");
            postURL += "h/" + Math.ceil(1000000 * Math.random()) + "/";

            util.message(postURL);

            http.post(postURL, function (req) {
                          // refresh
                          inspectObject(req);
                      },
                      {
                          t   : threadID,
                          at  : self.gmailAt,
                          act : action
                      });
        }
    },

    getAt:
    function getAt(callback) {
        const self = this;

        let getURL = mailURL + "h/" + Math.ceil(1000000 * Math.random()) + "/?ui=html&zy=c";

        http.get(getURL, function (req) {
                     let matches = req.responseText.match(/\?at=([^"]+)/);

                     if (matches && matches.length > 0)
                     {
                         self.gmailAt = matches[1];
                         util.message(self.gmailAt);

                         if (typeof callback === "function")
                             callback();
                     }
                 });
    },

    // ============================================================ //
    // Scheduler
    // ============================================================ //

    get SCHEDULER_INTERVAL_MIN() 120 * 1000, // 2 minutes
    get UPDATE_EVENT() "GmmlUpdateEvent",

    set schedulerInterval(value) {
        if (this.timer)
            this.stopScheduler();
        this._schedulerInterval = Math.max(~~value, this.SCHEDULER_INTERVAL_MIN);
        this.startScheduler();
    },

    get schedulerInterval() this._schedulerInterval,

    updater:
    function updater() {
        const self = this;

        self.processUnreads(
            function (req) {
                // success
                let src = req.responseText;
                src = src.replace(/xmlns=".*"/, "");
                let xml = util.createXML(src);

                self.updateUnreads(xml);
                self.dispatchEvents(self.registeredWindows);
            },
            function (req) {
                // error
                util.messageDebug("UPDATE ERROR => " + req.responseText);
            }
        );
    },

    setupScheduler:
    function setupScheduler() {
        const self = this;

        if (this.timer)
            return;

        this.timerEvent = {
            notify: function () { self.updater(); }
        };

        this.timer = Cc["@mozilla.org/timer;1"].createInstance(Ci.nsITimer);
    },

    startScheduler:
    function startScheduler(immediate) {
        this.timer.initWithCallback(this.timerEvent,
                                    this.schedulerInterval,
                                    Components.interfaces.nsITimer.TYPE_REPEATING_SLACK);
        if (immediate)
            this.updater();
    },

    stopScheduler:
    function stopScheduler() {
        this.timer.cancel();
    },

    updateUnreads:
    function updateUnreads(xml) {
        const self = this;

        self.unreadCount = Number(xml.fullcount);

        for each (let entry in xml.entry)
        {
            let id = entry.id.text().toString();

            if (self.unreads.some(function (senior) id === senior.id.text().toString()))
                continue;

            self.unreads.push(entry);
        }
    },

    dispatchEvents:
    function dispatchEvents(windows) {
        for (let [, win] in Iterator(windows))
        {
            let doc = win.document;
            let ev  = doc.createEvent("Events");

            util.message("send " + this.UPDATE_EVENT);

            ev.initEvent(this.UPDATE_EVENT, true, false);

            doc.dispatchEvent(ev);
        }
    },

    registerWindow:
    function registerWindow(win) {
        const self = this;

        if (this.registeredWindows.indexOf(win) === -1)
        {
            this.registeredWindows.push(win);

            win.addEventListener("unload", function () {
                                     let pos = self.registeredWindows.indexOf(win);

                                     if (pos >= 0)
                                         self.registeredWindows.splice(pos, 1);
                                 }, false);
        }
    }
};

// ============================================================ //
// Class member
// ============================================================ //

Gmail.getLogins = function getLogins() {
    let lm     = Cc["@mozilla.org/login-manager;1"].getService(Ci.nsILoginManager);
    let urls   = ["http://www.google.com", "https://www.google.com"];
    let logins = urls.reduce(function (accum, url) accum.concat(lm.findLogins({}, url, url, null) || []), []);

    return logins;
};