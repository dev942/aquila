

aq.page.compose = {

'needKeys' : true,

'init' : function() {
    var keys = aq.getStorage('keys');
    $('#compose-from').text(keys.primary);

    $('#compose-subject')[0].value = (searchParam('subject') || '');
    $('#compose-to')[0].value = (searchParam('to') || '');

    if(searchParam('order')) {
        // If message is associated with an order, then not meaningful
        // to change recipient, but let them change state
        $('#compose-order').css('display', 'table-row');
        $('#compose-state')[0].disabled = !searchParam('isSeller');
        if(searchParam('escrowReleased')) {
            $('#compose-state')[0].value = 'escrow released';
        }
        $('#compose-to')[0].readOnly = true;
        $('#compose-subject')[0].readOnly = true;
        $('#compose-addrBook').css('display', 'none');
    }
    if(searchParam('tx')) {
        try {
            var obj = aq.getTransactionInfo(searchParam('tx'));

            $('#compose-nsigs').text(obj.n);
            ui.btcLink(obj.addr).appendTo('#compose-outAddr');
            $('#compose-tx').css('display', 'table-row');

            $('#compose-viewTx').on('click', function() {
                $('#viewTx-tx')[0].value = searchParam('tx');
                $('#viewTx-n').text(obj.n);
                ui.showPopup('viewTx');
            });
        } catch(e) {
        }
    }
},

'viewOrder' : function() {
    ui.navTo('order', { 'hash' : searchParam('order') });
},

'send' : function() {
    var order = searchParam('order'),
        state = $('#compose-state')[0].value;

    var s = $('#compose-subject')[0].value,
        b = $('#compose-body')[0].value,
        t = $('#compose-to')[0].value;
    try {
        if(s.length < 1) throw 'subject is blank';
        if(b.length < 1 && !state) throw 'body is blank';
        if(!cutil.checker.btcAddr(t)) throw 'to: format bad';
    } catch(e) {
        ui.showPopup('notify', 'Failed to send: ' + e);
        return;
    }

    var keys = aq.getStorage('keys'),
        pks = aq.page.keys.getPublicKeys();

    // Determine which public keys we'll encrypt the message with
    var toPubKey = { };
    toPubKey[t] = null;
    if($('#compose-me')[0].checked) {
        toPubKey[keys.primary] = pks.crypt;
    }
    if($('#compose-admins')[0].checked) {
        var mc = aq.getStorage('marketControl').msg;
        toPubKey[mc.adminContact[0]] = null;
    }

    function send() {
        var pkh, cipherTo = [ ], pks = [ ];
        for(pkh in toPubKey) {
            cipherTo.push(pkh);
            pks.push(toPubKey[pkh]);
        }

        var pc = {
            'type'      : 'privateComment',
            'ref'       : order ? order : '',
            'state'     : order ? state : '',
            'cipherTo'  : cipherTo,
        };
        var toEncrypt = {
            'subject' : s,
            'body'    : b,
        };
        if(searchParam('tx')) toEncrypt.tx = searchParam('tx');

        try {
            msg.fillCiphered(pc, toEncrypt, pks);
            pc.sigFrom = keys.primary;
            pc.sig = msg.notYetSigned;

            msg.fillTime(pc);
            pc = msg.fromUntrusted(pc, 'compute');
            msg.fillSignatures(pc);
            pc = JSON.stringify(pc);
            var list = [ pc ];

            if(toEncrypt.tx) {
                // If the transaction is fully signed, then also broadcast
                // it to the Bitcoin network
                try {
                    var info = aq.getTransactionInfo(toEncrypt.tx);
                    if(info.n === 2) {
                        list.push(JSON.stringify({ 'type' : 'broadcastBtcTx',
                                                   'tx'   : toEncrypt.tx }));
                    }
                } catch(e) {
                }
            }

            aq.sendMsgWithCaptcha(list, function() {
                if(order) {
                    ui.navTo('order', { 'hash' : order });
                } else {
                    ui.navTo('sent');
                }
            });
        } catch(e) {
            ui.showPopup('notify', 'Failed to cipher and send');
        }
    }

    // And get those keys from the network, by searching for the necessary
    // keysForIdentity messages.

    var gotKeys = false;
    function gotOne(r) {
        if(gotKeys) return;
        if(!(isObj(r) && isObj(r.result) && isArray(r.result.msgs))) return;
        if(r.result.msgs.length !== 1) {
            ui.log('*** MISSING keysForIdentity');
            return;
        }
        var kfi = r.result.msgs[0];
        if(!(kfi.type === 'keysForIdentity' &&
            (kfi.sigFrom in toPubKey) &&
            aq.verifyMsgSignatures(kfi)))
        {
            ui.log('*** BAD keysForIdentity');
            return;
        }
        ui.log('got keysForIdentity for ' + kfi.sigFrom + ':');
        ui.log('    pkCrypt = ' + kfi.pkCrypt);
        ui.log('    timeReal = ' + kfi.timeReal);
        toPubKey[kfi.sigFrom] = kfi.pkCrypt;

        // Check if we have all of our public keys yet.
        var pkh;
        for(pkh in toPubKey) {
            if(!toPubKey[pkh]) return;
        }
        gotKeys = true;
        send();
    }

    var pkh;
    for(pkh in toPubKey) {
        if(toPubKey[pkh]) continue;

        aq.rpc.toServers('searchMsg', {
            'type'         : 'keysForIdentity',
            'sigFrom'      : [ pkh ],
            'limitResults' : 1,
            'resultsAs'    : 'msg',
        }, gotOne, null);
    }
    ui.showPopup('log');
},

};

aq.privateMsg = { };
aq.privateMsg.gotOne = function(r, have, dest) {
    if(!(isObj(r) && isObj(r.result) && isArray(r.result.msgs))) return;
    r = r.result;

    r.msgs.forEach(function(m) {
        if(have[m.hash]) return;
        have[m.hash] = true;

        msg.extractCipheredPrivateComment(m);
        var t = ui.commentTable(m, {
            'showToNotFrom'  : (dest === '#sent'),
            'replyButton'    : true,
            'markReadButton' : (dest !== '#sent'),
        });
        t.appendTo(dest + '-msgs');
    
        aq.asyncVerifyMsgSignatures(m, t);
    });

    var copy = [ 'to', 'from', 'unreadOnly' ];
    ui.pageControls(dest, copy, 'msgs ',
        r.skipped, r.msgs.length, r.n, conf.msgsPerPage);
    ui.hidePopup();
};

aq.page.inbox = {
'needKeys' : true,

'init' : function() {
    var spf = searchParam('from'),
        spu = searchParam('unreadOnly');
    $('#inbox-from')[0].value = spf || '';
    $('#inbox-unread')[0].checked = spu;

    var keys = aq.getStorage('keys');
    var have = { }, p = {
        'type'         : 'privateComment',
        'cipherTo'     : [ keys.primary ],
        'skipResults'  : searchParam('skip')|0,
        'limitResults' : conf.msgsPerPage,
        'resultsAs'    : 'msg',
    };
    if(spf) p.sigFrom = [ spf ];
    if(spu) {
        p.hashExclude = Object.keys(aq.alreadyRead.hashes);
        p.minTime = aq.alreadyRead.omitsBefore+1;
        if(aq.alreadyRead.omitsBefore !== 0) {
            $('#inbox-warning-age').text(
                timeAgo(aq.alreadyRead.omitsBefore));
            $('#inbox-warning').css('display', 'block');
        }
    }
    aq.rpc.toServers('searchMsg', p, function(r) {
        aq.privateMsg.gotOne(r, have, '#inbox');
    }, null);
    ui.showPopup('log');
},

'clearFilter' : function() { ui.navTo('inbox'); },

'filter' : function() {
    var p = { }, from = $('#inbox-from')[0].value;
    if(from !== '') {
        if(!cutil.checker.btcAddr(from)) {
            ui.showPopup('notify', 'Bad format for from: address');
            return;
        }
        p.from = from;
    }
    if($('#inbox-unread')[0].checked)
        p.unreadOnly = true;

    ui.navTo('inbox', p);
},

};

aq.page.sent = {
'needKeys' : true,

'init' : function() {
    var spt = searchParam('to');
    $('#sent-to')[0].value = spt || '';

    var keys = aq.getStorage('keys');
    var have = { }, p = {
        'type'         : 'privateComment',
        'sigFrom'      : [ keys.primary ],
        'skipResults'  : searchParam('skip')|0,
        'limitResults' : conf.msgsPerPage,
        'resultsAs'    : 'msg',
    };
    if(spt) p.cipherTo = [ spt ];
    aq.rpc.toServers('searchMsg', p, function(r) {
        aq.privateMsg.gotOne(r, have, '#sent');
    }, null);
    ui.showPopup('log');
},

'clearFilter' : function() { ui.navTo('sent'); },

'filter' : function() {
    var p = { }, to = $('#sent-to')[0].value;
    if(to !== '') {
        if(!cutil.checker.btcAddr(to)) {
            ui.showPopup('notify', 'Bad format for to: address');
            return;
        }
        p.to = to;
    }
    ui.navTo('sent', p);
},

};

