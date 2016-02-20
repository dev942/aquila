
bitcoin     = require('bitcoinjs-lib');
ecurve      = require('ecurve');
bigi        = require('bigi');
Buffer      = require('buffer').Buffer;
AES         = require('aes');
randomBytes = require('randombytes');

function searchParam(key) {
    var val = undefined, str = location.search.substring(1);
    str.split('&').forEach(function(pair) {
        var parens;
        if((parens = pair.match(/^([-A-Za-z0-9_]+)=(.*)/)) &&
           (parens[1] === key))
        {
            val = decodeURI(parens[2]);
        }
    });
    return val;
}
function isStr(a) { return ((typeof a) === 'string'); }
function isNum(a) { return ((typeof a) === 'number') && (a === a); }
function isInt(a) { return isNum(a) && (Math.floor(a) === a); }
function isObj(a) { return a && ((typeof a) === 'object'); }
function isArray(a) {
    return a && ((typeof a) === 'object') && (a instanceof Array);
}
function getUnixTime() { return Math.floor(Date.now() / 1e3); }
function timeToUnits(dt) {
    if(dt < 60) {
        return Math.floor(dt) + 's';
    } else if(dt < 60*60) {
        return Math.floor(dt/60) + 'm';
    } else if(dt < 60*60*24) {
        return Math.floor(dt/(60*60)) + 'h';
    } else {
        return Math.floor(dt/(60*60*24)) + 'd';
    }
}
function timeAgo(t) {
    if(t === 0) return '--';
    return timeToUnits(getUnixTime() - t);
}
function timePlusMinus(t) {
    var dt = t - getUnixTime();
    if(dt > 0) {
        return '+' + timeToUnits(dt);
    } else {
        return '-' + timeToUnits(-dt);
    }
}
function timeFromUserInput(tin) {
    if(tin.substr(0, 1) === '+') {
        return getUnixTime() + (tin.substr(1)*24*60*60);
    } else if(tin.substr(0, 1) === '-') {
        return getUnixTime() - (tin.substr(1)*24*60*60);
    } else {
        return tin|0;
    }
}


aq = {
    'page' : { },
    'rpc'  : { },
};

aq.getStorage = function(key) {
    var r = window.localStorage.getItem('aquila.' + conf.network + '.' + key);
    try {
        return r ? JSON.parse(r) : r;
    } catch(e) {
        return;
    }
};
aq.setStorage = function(key, value) {
    try {
        window.localStorage.setItem('aquila.' + conf.network + '.' + key,
                                                      JSON.stringify(value));
    } catch(e) {
        ui.log('*** FAILED, window.localStorage.setItem(): ' + e);
        ui.log('increase storage quota for this domain in browser settings?');
        ui.showPopup('log');
    }
};

/**
 * A table used to track which messages have already been marked read
 * by the user.
 */
aq.isAlreadyRead = function(m) {
    return (m.hash in aq.alreadyRead.hashes);
};
aq.markAlreadyRead = function(m, yes) {
    var aah = aq.alreadyRead.hashes;
    if(yes) {
        aah[m.hash] = m.timeReal;
        // If the table is getting bigger than our limit, drop the oldest
        // entries and record the trim date.
        if(Object.keys(aah).length > 1000) {
            var h, hOldest, tOldest = getUnixTime();
            for(h in aah) {
                if(aah[h] < tOldest) {
                    tOldest = aah[h];
                    hOldest = h;
                }
            }
            delete aah[hOldest];
            aq.alreadyRead.omitsBefore = tOldest;
        }
    } else {
        delete aah[m.hash];
    }
    aq.setStorage('alreadyRead', aq.alreadyRead);
};
aq.clearAlreadyRead = function() {
    aq.setStorage('alreadyRead', null);
};

/**
 * This function gets called by onload. First, we check if our marketControl
 * message is up to date, since that's always required. If it's not, then
 * try to retrieve that from the servers. If it is, then we do the same for
 * the ticker. Finally, if we have both, then we go to the page-specific init
 * function.
 */
aq.init = function() {
    ui.log('This is Aquila client version ' + conf.version);

    if(searchParam('a') === 'servers') {
        // This is the only page that we might need without valid
        // marketControl, since it's the one that sets up the servers,
        // should generally be auto but may force manually.
        aq.loadPage();
        return;
    }

    // Keep the table of already-read message hashes in memory, since we
    // may use that fairly often
    aq.alreadyRead = aq.getStorage('alreadyRead') ||
                     { 'hashes' : { }, 'omitsBefore' : 0 };

    var now = getUnixTime(),
        mc = aq.getStorage('marketControl'),
        ticker = aq.getStorage('ticker');

    if(!(isObj(mc) && isObj(mc.msg) && isInt(mc.receivedAt) &&
         ((now - mc.receivedAt) < conf.marketControlCheckInterval)))
    {
        ui.showPopup('log');
        aq.getMarketControl();
        return;
    }

    ui.log('keeping marketControl (received ' + timeAgo(mc.receivedAt) +
                ' ago), with');
    ui.log('    hash=' + mc.msg.hash);

    if(!(isObj(ticker) && isInt(ticker.receivedAt) &&
        ((now - ticker.receivedAt) < conf.tickerInterval)))
    {
        ui.showPopup('log');
        aq.getTicker();
        return;
    }

    ui.log('keeping ticker info (received ' + timeAgo(ticker.receivedAt) +
                ' ago)');

    aq.loadPage();
};

/**
 * Set up the category links at the top left based on marketControl.
 */
aq.setUpCategories = function(mc) {
    $('#categories').html('');
    var spc = '';
    if(searchParam('a') === 'search') spc = searchParam('category') || '';

    function showCategory(cat, now) {
        if(!(isStr(cat) && isStr(now))) return false;
        cat = cat.split(';');
        now = now.split(';');

        return ((cat.length <= (now.length+1)) &&
                (cat.slice(0, cat.length-1).join(';') ===
                 now.slice(0, cat.length-1).join(';')));
    }

    mc.categories.forEach(function(c) {
        var link = c;
        if(showCategory(c, spc)) {
            // Subcategory is shown, indented
            c = c.replace(/[^;]*;/g, '\u2003');
        } else {
            // Subcategory is hidden for now
            return;
        }

        $('<a/>', {
            'text'  : c,
            'href' : '?a=search&category=' + encodeURI(link),
            'class' : 'leftitem',
        }).appendTo('#categories');
    });
};

/**
 * Show the options in the left toolbar that are appropriate for the
 * user's role, and no others, avoid confusion.
 */
aq.showToolbarItemsForRole = function() {
    var ani = aq.getStorage('approveNewIdentity'),
        keys = aq.getStorage('keys'),
        mc = aq.getStorage('marketControl').msg;

    if(isObj(ani) && ani.allowed) {
        if(ani.maySell) {
            $('#for-sellers').css('display', 'block');
        } else {
            $('#for-buyers').css('display', 'block');
        }
    }
    if(isObj(keys) && (keys.primary === mc.adminPkh[0])) {
        $('#for-admins').css('display', 'block');
    }
    var owners = aq.getStorage('owners')
    if(isObj(owners) && isObj(keys)) {
        var pkhId;
        for(pkhId in keys.secretKeys) {
            if(pkhId in owners)
                $('#for-owners').css('display', 'block');
        }
    }
};

/**
 * Load a particular page of the market. This gets called only once our
 * marketControl and ticker are up to date. So we can set up our category
 * links, and then pass control to the specific page's init function.
 */
aq.loadPage = function() {
    ui.hidePopup();
    var ani = aq.getStorage('approveNewIdentity'),
        keys = aq.getStorage('keys'),
        mc = aq.getStorage('marketControl').msg;

    aq.setUpCategories(mc);
    aq.showToolbarItemsForRole();

    // A small nag screen that encourages users to save the client locally,
    // and to upgrade to the latest client version.
    var nag;
    if(!window.location.toString().match(/^file:\/\//)) {
        nag = "it's best to save client locally";
    }
    if($.grep(mc.clientVersion,
                function(v) { return (v === conf.version); }).length === 0)
    {
        nag = "new client version available";
    }
    if(nag) {
        $('#nagbar').css('display', 'block');
        $('#nagbar-link').text(nag);
    }

    var a = searchParam('a');
    if(a in aq.page) {
        if((!aq.page[a].needKeys) ||
           (isObj(keys) && Object.keys(keys).length > 0 && isObj(ani)))
        {
            ui.hidePopup();
            aq.page[a].init();
        } else {
            // This page needs the user to have at least one identity,
            // but he doesn't. The keys page will prompt him to generate
            // a new identity, or load one from a file.
            ui.navTo('keys');
        }
    } else {
        ui.log('nothing for page ' + a);
    }
};

/**
 * Get the message with frequently-changing data, like exchange rates and
 * a recent block hash. This is signed by the server operator, and serves
 * as an exchange rate lock when the order is placed.
 */
aq.getTicker = function() {
    var done = false;

    // It would be better to look at all the responses and choose one of
    // the two more consistent options, for now just take the first
    function gotOne(r) {
        if(done) return;
        if(!(isObj(r) && isObj(r.result))) return;
        var m = r.result;
        if(!aq.verifyMsgSignatures(m)) {
            ui.log('*** SIGNATURE FAIL FOR ticker');
            return;
        }
        if(Math.abs(getUnixTime() - m.timeReal) > 60*60) {
            ui.log('*** TICKER IS OLD: ' + timePlusMinus(m.timeReal));
            return;
        }
        var mc = aq.getStorage('marketControl').msg;
        if(!mc.adminTicker.some(function(a) {
            return (a === m.sigFrom);
        })) {
            ui.log('*** TICKER NOT SIGNED BY adminTicker');
            return;
        }

        ui.log('got ticker information:');
        m.receivedAt = getUnixTime();
        ui.log('    time = ' + m.time);
        ui.log('    timeHash = ' + m.timeHash);
        ui.log('    timeReal = ' + m.timeReal +
                                     ' (' + timePlusMinus(m.timeReal) + ')');
        aq.setStorage('ticker', m);

        ui.log('\ndone, loading page');
        done = true;
        window.setTimeout(aq.loadPage, 0.5*1000);
    }

    function gotAll() {
        if(!done) {
            ui.log('*** NO TICKER INFO RECEIVED');
            ui.log("Can't proceed, reload or check network settings?");
            ui.log('Markets using .onion servers require Tor.');
            ui.showPopup('log');
            return;
        }
    }

    ui.log('\ngetting ticker information (exchange rates, time)');
    aq.rpc.toServers('ticker', { }, gotOne, gotAll);
};

/**
 * Sanitize image data URL, should already be done incoming but double check.
 */
aq.imageDataUrl = function(dataUrl) {
    try {
        var jpeg = 'data:image/jpeg;base64,',
            png  = 'data:image/png;base64,',
            base64, type;
        if(dataUrl.substr(0, jpeg.length) === jpeg) {
            base64 = dataUrl.substr(jpeg.length);
            type = 'jpeg';
        } else if(dataUrl.substr(0, png.length) === png) {
            base64 = dataUrl.substr(png.length);
            type = 'png';
        } else {
            throw 'bad type';
        }
        var d = new Buffer(base64, 'base64');
        return 'image/' + type + ';base64,' + d.toString('base64');
    } catch(e) {
        return '';
    }
};

/**
 * Show a CAPTCHA in the window for the user.
 */
aq.showCaptcha = function(r, captchaBad) {
    var img = $('#captcha-img');
    img.attr('src', 'data:' + aq.imageDataUrl(r.result.img));
    img.css('height', '100px');
    img.css('width', '240px');
    $('#captcha-bad').css('display', captchaBad ? 'block' : 'none');
    $('#captcha-text')[0].value = '';

    ui.showPopup('captcha');
};

/**
 * Attempt to broadcast a list of messages. We let aq.rpc.toOneServer pick
 * a server for us to use, and request a CAPTCHA there. Then display the
 * CAPTCHA, let the user solve it, and call sendMsg with that same server.
 */
aq.sendMsgWithCaptcha = function(m, success, captchaBad) {
    ui.showPopup('log');
    aq.rpc.toOneServer('captcha', { }, function(r, server) {
        var captchaTag = r.result.tag;
        aq.showCaptcha(r, captchaBad);

        $('#captcha-another').off('click');
        $('#captcha-another').on('click', function() {
            // If we call ourselves again, then we'll get a different
            // random CAPTCHA.
            aq.sendMsgWithCaptcha(m, success, false);
        });
        $('#captcha-broadcast').off('click');
        $('#captcha-broadcast').on('click', function() {
            function fs(r) {
                if(r && r.error && r.error === 'bad captcha') {
                    aq.sendMsgWithCaptcha(m, success, true);
                } else if(r && r.result && r.result === 'ok') {
                    ui.showPopup('notify',
                        'The message has been sent. It may take a few ' +
                        'minutes to propagate to the full network.');
                    if(success) {
                        $('#popup-notify-button').off('click');
                        $('#popup-notify-button').on('click', function() {
                            success(m);
                        });
                    }
                } else {
                    ui.log('unknown response: ' + JSON.stringify(r));
                }
            }

            // Must use same server that we got the CAPTCHA from
            aq.rpc.toServer(server, 'sendMsg', {
                'captchaTag'  : captchaTag,
                'captchaText' : $('#captcha-text')[0].value,
                'msg'         : m,
            }, fs);
            ui.showPopup('log');
        });
    });
};

/**
 * Fill a standard (not marketControl) message's timestamp and signer,
 * compute its hash, sign it, and then broadcast. If the message isn't
 * well-formed, then catch the exception here and show a popup to the
 * user. The success callback (if provided) runs when the user dismisses
 * that popup.
 */
aq.finishAndSendMsg = function(m, success) {
    try {
        var keys = aq.getStorage('keys');
        m.sigFrom = keys.primary;
        m.sig = msg.notYetSigned;

        msg.fillTime(m);
        m = msg.fromUntrusted(m, 'compute');
        msg.fillSignatures(m);
        m = JSON.stringify(m);

        aq.sendMsgWithCaptcha([ m ], success);
    } catch(e) {
        ui.showPopup('notify', 'Message format bad: ' + e);
    }
};

/**
 * Verify that a message's signature (or signatures) is correct.
 * bitcoin.message can throw exceptions, so need the try block.
 */
aq.sigTotal = 0;
aq.sigDone = 0;
aq.verifyMsgSignatures = function(m, async) {
    var ok;
    try {
        if(m.type === 'marketControl') {
            for(var i = 0; i < m.ownerSig.length; i++) {
                var osf = m.ownerSigFrom[i],
                    os  = m.ownerSig[i];
                if(!bitcoin.message.verify(osf, os, m.hash, conf.btcNet)) {
                    throw 'bad sig';
                }
            }
        } else {
            var sf = m.sigFrom,
                s  = m.sig;
            if(!bitcoin.message.verify(sf, s, m.hash, conf.btcNet)) {
                throw 'bad sig';
            }
        }
        ok = true;
    } catch(e) {
        ok = false;
    }

    // If it's async then we incremented the total when we enqueued it,
    // so don't double-count.
    if(!async) aq.sigTotal++;
    aq.sigDone++;
    $('#sigs-count').text(aq.sigDone + '/' + aq.sigTotal);

    return ok;
};

/**
 * Signature verification is unfortunately slow. We always check signatures
 * e.g. before instructing the user to send money to some address, but in
 * cases where it matters less (like showing a list of messages by subject
 * and sender), we may show content first, and check signatures in the
 * background.
 */
aq.asyncBacklog = [ ];
aq.asyncVerifyMsgSignatures = function(m, cb) {
    var dt = 55;
    function checkOneSignature() {
        var a = aq.asyncBacklog.shift(),
            m = a[0], cb = a[1],
            ok = aq.verifyMsgSignatures(JSON.parse(m), true);

        // The second parameter might be a callback function, or an entity
        // that we displayed and should prominently un-display if the
        // signature is bad.
        if((typeof cb) === 'function') {
            cb(ok);
        } else {
            if(!ok) {
                cb.css('background', 'red');
                cb.css('padding', '10px');
                cb.css('display', 'block');
                cb.css('font-weight', 'bold');
                cb.text('SIGNATURE FAILED');
            }
        }

        if(aq.asyncBacklog.length > 0) {
            window.setTimeout(checkOneSignature, dt);
        }
    }

    // If there's a backlog, then we should already have a timer pending;
    // but if there's not, then we need to kick that off here.
    if(aq.asyncBacklog.length === 0) {
        window.setTimeout(checkOneSignature, dt);
    }
    aq.sigTotal++;
    aq.asyncBacklog.push([ JSON.stringify(m), cb ]);
};

/**
 * Get a single message by its hash, and call the callback with it upon
 * success. For now always use the network, could be modified to cache
 * though.
 */
aq.getMsgByHash = function(hash, cb) {
    var done = false;
    aq.rpc.toServers('searchMsg', {
        'hashInclude' : [ hash ],
        'deletedOk'   : true,
        'resultsAs'   : 'msg',
    }, function(r) {
        if(done) return;
        if(!(isObj(r) && isObj(r.result) && isArray(r.result.msgs))) return;
        if(r.result.msgs.length !== 1) return;
        var m = r.result.msgs[0];
        if(m.hash !== hash) return;
        if(!aq.verifyMsgSignatures(m)) return;

        done = true;
        cb(r.result.msgs[0]);
    }, function() {
        if(done) return;
        ui.log('*** FAILED TO GET MSG WITH hash=' + hash);
    });
    ui.showPopup('log');
};

/**
 * Get multiple messages by the searchMsg parameters, and return them, with
 * duplicate elimination and a reasonable guess at the paging parameters,
 * to the callback.
 */
aq.getMsgsBySearch = function(params, cb) {
    params.resultsAs = 'msg';
    var have = { }, first = true;
    aq.rpc.toServers('searchMsg', params, function(r) {
        if(!(isObj(r) && isObj(r.result) && isArray(r.result.msgs))) return;
        r = r.result;

        var out = [ ];
        r.msgs.forEach(function(m) {
            if(have[m.hash]) return;
            have[m.hash] = true;
            out.push(m);
        });
        var page = {
            'skipped' : r.skipped,
            'inPage'  : r.msgs.length,
            'total'   : r.n
        }
        if(out.length > 0 || first) cb(out, page);
        first = false;
    }, function() {
        if(first) ui.log('*** NO RESPONSES IN getMsgsBySearch');
    });
    ui.showPopup('log');
};

/**
 * Get one message by the searchMsg parameters, and return it, with
 * duplicate elimination.
 */
aq.getMsgBySearch = function(params, cb) {
    params.resultsAs = 'msg';
    params.limitResults = 1;
    var first = true, have = false;
    aq.rpc.toServers('searchMsg', params, function(r) {
        if(!(isObj(r) && isObj(r.result) && isArray(r.result.msgs))) return;
        r = r.result;
        if(r.msgs.length > 1) return;

        if(r.msgs.length > 0) {
            if(!have) cb(r.msgs[0]);
            have = true;
        } else if(first) {
            cb(null);
        }
        first = false;
    }, function() {
        if(first) ui.log('*** NO RESPONSES IN getMsgBySearch');
    });
    ui.showPopup('log');
};

/**
 * Convert from another currency to BTC.
 */
aq.currencyToBtc = function(value, currency, ticker) {
    ticker = (ticker || aq.getStorage('ticker'));

    for(var i = 0; i < ticker.currencies.length; i++) {
        if(ticker.currencies[i] === currency) {
            return (value / ticker.exchangeRates[i]);
        }
    }
};

/**
 * For a 2/3 multisig escrow release transaction, get the output address,
 * and whether it's fully (2/3) or partially (1/3) signed.
 */
aq.getTransactionInfo = function(txHex) {
    var tx = bitcoin.Transaction.fromHex(txHex),
        txb = bitcoin.TransactionBuilder.fromTransaction(tx, conf.btcNet),
        n = undefined, addr;

    if(txb.inputs.length < 1) throw 'no inputs';
    txb.inputs.forEach(function(input) {
        if(input.signatures.length !== 3) throw 'inputs are not x/3 multisig';
        var nt = 0;
        for(var i = 0; i < 3; i++) {
            if(input.signatures[i]) nt++;
        }
        if(n === undefined) {
            n = nt;
        } else if(n !== nt) {
            throw 'all inputs should have same number of signers';
        }
    });
    if(n === 0) throw 'no sigs';
    if(n >   2) throw 'too many sigs';

    if(tx.outs.length !== 1) throw 'not 1 output';
    var addr = bitcoin.address.fromOutputScript(tx.outs[0].script, conf.btcNet);
    return {
        'tx'    : tx,
        'txb'   : txb,
        'txHex' : txHex,
        'addr'  : addr,
        'value' : cutil.satoshisToBtc(tx.outs[0].value),
        'n'     : n,
    };
};


