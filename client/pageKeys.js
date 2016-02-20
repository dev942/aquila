
aq.page.keys = {

'needKeys' : false,

'allSavedState' : [
    'keys', 'servers', 'marketControl', 'txs', 'addressBook', 'alreadyRead',
    'serverForce', 'approveNewIdentity',
],

/**
 * A list of public key hashes for all encryption keys, sorted by date with
 * the most recent first.
 */
'pkhCryptsSortedByDate' : function(skCrypt) {
    var list = Object.keys(skCrypt);
    list.sort(function(a, b) {
        return skCrypt[b].created - skCrypt[a].created;
    });
    return list;
},

/**
 * A public key from a secret key in WIF form.
 */
'publicKeyFromWif' : function(wif) {
    var ecp = bitcoin.ECPair.fromWIF(wif, conf.btcNet);
    return ecp.getPublicKeyBuffer().toString('hex');
},

/**
 * The public keys that we'd broadcast in a keysForIdentity message. We
 * store the private keys only, so need to compute that and conver to hex.
 */
'getPublicKeys' : function() {
    var keys = aq.getStorage('keys');
    var kp = keys.secretKeys[keys.primary];

    var list = aq.page.keys.pkhCryptsSortedByDate(kp.skCrypt);

    return {
        'btc'   : aq.page.keys.publicKeyFromWif(kp.skBtc),
        'crypt' : aq.page.keys.publicKeyFromWif(kp.skCrypt[list[0]].sk),
    };
},

/**
 * Show all of our secret keys in a big table.
 */
'showKeysInTable' : function() {
    function row() {
        var classes = [ 'mono wrap', '', 'mono wrap', 'mono wrap' ];
        var tr = $('<tr/>');
        for(var i = 0; i < arguments.length; i++) {
            var td = $('<td/>', {
                'text'  : arguments[i],
                'class' : classes[i],
            });
            if(i === 0 && !arguments[1].match(/id/)) {
                td.css('padding-left', '25px');
            }
            td.appendTo(tr);
        }

        var td = $('<td/>');

        if(arguments[1].match(/id/)) {
            if(arguments[1].match(/primary/)) {
                tr.addClass('hl');
            } else {
                var makePrimary = $('<div/>', {
                    'text'  : 'Make Primary',
                    'class' : 'button-small',
                });
                makePrimary.appendTo(td);
                var pkh = arguments[0];
                makePrimary.on('click', function() {
                    var keys = aq.getStorage('keys');
                    if(pkh in keys.secretKeys) {
                        keys.primary = pkh;
                        aq.setStorage('keys', keys);
                        ui.navReload();
                    }
                });
                var deleteId = $('<div/>', {
                    'text'  : 'Delete',
                    'class' : 'button-small',
                });
                $('<br/>').appendTo(td);
                td.css('line-height', '30px');
                deleteId.appendTo(td);
                deleteId.on('click', function() {
                    ui.navTo('deleteKey', { 'pkhId' : pkh });
                });
            }
        }
        if(arguments[1].match(/crypt/) && !arguments[1].match(/newest/)) {
            var pkh = arguments[0];
            var deleteCrypt = $('<div/>', {
                'text'  : 'Delete',
                'class' : 'button-small',
            });
            deleteCrypt.on('click', function() {
                ui.navTo('deleteKey', { 'pkhCrypt' : pkh });
            });
            deleteCrypt.appendTo(td);
        }

        td.appendTo(tr);
        tr.appendTo('#keys-list');
    }

    var keys = aq.getStorage('keys');
    var makePk = aq.page.keys.publicKeyFromWif;
    Object.keys(keys.secretKeys).reverse().forEach(function(pkhId) {
        var h = keys.secretKeys[pkhId];
        var type = 'identity';
        if(pkhId === keys.primary) type += ' (primary)';
        row(pkhId, type, h.skId, makePk(h.skId), timeAgo(h.created));

        var pkhCrypts = aq.page.keys.pkhCryptsSortedByDate(h.skCrypt);
        for(var i = 0; i < pkhCrypts.length; i++) {
            var pkhCrypt = pkhCrypts[i],
                str = 'crypt';
            if(i === 0) str += ' (newest)';

            var sk = h.skCrypt[pkhCrypt].sk;
            row(pkhCrypt, str, sk, makePk(sk),
                timeAgo(h.skCrypt[pkhCrypt].created));
        }

        row('not used', 'btc', h.skBtc, makePk(h.skBtc), timeAgo(h.created));
    });
},

/**
 * Look for a keysForIdentity message on the network that's consistent
 * with our stored keys for the primary identity. If we find one, then
 * hide the popups and we're done. If we don't, then prompt user to
 * re-broadcast.
 */
'checkKeysForIdentity' : function() {
    function gotOne(r) {
        if(gotOk) return;

        if(isObj(r) && isObj(r.result) && isArray(r.result.msgs) &&
           r.result.msgs.length === 1)
        {
            var m = r.result.msgs[0];
            if(m.pkBtc === pkBtc && m.pkCrypt === pkCrypt) {
                ui.hidePopup();
                gotOk = true;
                ui.log('GOOD keysForIdentity, public keys match');
            } else {
                ui.log('BAD keysForIdentity with hash ' + m.hash);
                ui.log('    their pkCrypt = ' + m.pkCrypt);
                ui.log('    our   pkCrypt = ' + pkCrypt);
                ui.log('    their pkBtc   = ' + m.pkBtc);
                ui.log('    our   pkBtc   = ' + pkBtc);
            }
        } else {
            ui.log('bad or empty result');
        }
    }
    function gotAll() {
        if(!gotOk) ui.showPopup('keysForIdentity');
    }

    var pks = aq.page.keys.getPublicKeys(),
        pkBtc = pks.btc;
        pkCrypt = pks.crypt,
        gotOk = false,
        keys = aq.getStorage('keys');

    aq.rpc.toServers('searchMsg', {
        'type'         : 'keysForIdentity',
        'sigFrom'      : [ keys.primary ],
        'limitResults' : 1,
        'resultsAs'    : 'msg',
    }, gotOne, gotAll);

    ui.showPopup('log');
},

/**
 * Look for an approveNewIdentity message on the network for our primary
 * identity. If we find it, then proceed to checkKeysForIdentity, otherwise
 * prompt user to go through "new buyer" approval.
 */
'checkApproveNewIdentity' : function() {
    function gotOne(r) {
        if(gotOk) return;
    
        if(isObj(r) && isObj(r.result) && isArray(r.result.msgs) &&
           r.result.msgs.length === 1)
        {
            var m = r.result.msgs[0],
                mc = aq.getStorage('marketControl').msg;
            if(m.type === 'approveNewIdentity' &&
               m.pkhId === keys.primary &&
               msg.signedWithAuthorizedAdminKey(m, mc))
            {
                gotOk = true;
                ui.log('GOOD approveNewIdentity, ours');
                aq.setStorage('approveNewIdentity', m);
                aq.showToolbarItemsForRole();
                aq.page.keys.checkKeysForIdentity();
            } else {
                ui.log('BAD approveNewIdentity with hash ' + m.hash);
            }
        } else {
            ui.log('bad or empty result');
        }
    }
    function gotAll() {
        if(!gotOk) aq.page.keys.requestNewBuyerApproval();
    }

    var gotOk = false,
        keys = aq.getStorage('keys');

    ui.log('seek approveNewIdentity for pkhId = ' + keys.primary);
    aq.rpc.toServers('searchMsg', {
        'type'         : 'approveNewIdentity',
        'pkhId'        : keys.primary,
        'limitResults' : 1,
        'resultsAs'    : 'msg',
    }, gotOne, gotAll);

    ui.showPopup('log');
},

/**
 * Entry into ?a=keys. If we have no identity, then prompt the user to
 * generate a random one, or import from a file. Then, confirm that the
 * identity is approved by the network, and prompt the user to have it
 * approved if not. Finally, confirm that our keysForIdentity is up to
 * date, and again prompt the user to fix that if it's not.
 */
'init' : function() {
    var keys = aq.getStorage('keys');
    if(!isObj(keys)) {
        ui.showPopup('keys');
        return;
    }
    if(!aq.getStorage('keysExported')) {
        ui.showPopup('exportKeys');
        return;
    }

    aq.page.keys.showKeysInTable();

    aq.page.keys.checkApproveNewIdentity();
},

/**
 * Delete all keys and refresh. The user will then be prompted to import
 * or generate a new identity.
 */
'deleteAll' : function() {
    if($('#keys-delete-confirm')[0].value === 'DELETE ALL') {
        aq.page.keys.allSavedState.forEach(function(p) {
            aq.setStorage(p, null);
        });
        ui.navTo('keys');
    } else {
        ui.showPopup('notify', 'Must type "DELETE ALL".');
    }
},

/**
 * Prompt the user to go through whatever process approves new buyers.
 */
'requestNewBuyerApproval' : function() {
    var keys = aq.getStorage('keys'),
        pks = aq.page.keys.getPublicKeys();

    var kfi = {
        'type'      : 'keysForIdentity',
        'pkCrypt'   : pks.crypt,
        'pkBtc'     : pks.btc,
        'sigFrom'   : keys.primary,
        'sig'       : msg.notYetSigned,
    };
    msg.fillTime(kfi);
    kfi = msg.fromUntrusted(kfi, 'compute');
    msg.fillSignatures(kfi);
    kfi = JSON.stringify(kfi);

    var path = '/approve?&msg=' + (new Buffer(kfi)).toString('base64');

    var pal = $('#popup-approveNewIdentity-list');
    var mc = aq.getStorage('marketControl').msg;
    mc.newBuyerUris.forEach(function(uri) {
        if(!uri.match(/^(http|https):\/\//)) return;

        var li = $('<li/>', { 'class' : 'mono' }),
             a = $('<a/>', { 'text'   : uri + '/approve',
                             'href'   : uri + path,
                             'target' : '_blank', });
        a.appendTo(li);
        li.appendTo(pal);
    });

    ui.showPopup('approveNewIdentity');
},

/**
 * Generate a random identity. This won't be known to the network, so the
 * user will be prompted to get it approved when we reload.
 */
'newRandom' : function(ecpId) {
    if(!ecpId) {
        // Most users generate totally random keys, but we also support
        // WIF import for the id key only, since that's the one that's
        // frequently displayed.
        ecpId = bitcoin.ECPair.makeRandom({ 'network' : conf.btcNet });
    }

    var ecpCrypt = bitcoin.ECPair.makeRandom({ 'network' : conf.btcNet }),
        ecpBtc   = bitcoin.ECPair.makeRandom({ 'network' : conf.btcNet });
   
    var pkhId = ecpId.getAddress(), keys = { };
    keys[pkhId] = {
        'skId'     : ecpId.toWIF(),
        'skCrypt'  : { },
        'skBtc'    : ecpBtc.toWIF(),
        'created'  : getUnixTime(),
    };
    keys[pkhId].skCrypt[ecpCrypt.getAddress()] = {
        'sk'      : ecpCrypt.toWIF(),
        'created' : getUnixTime(),
    };

    aq.setStorage('keys', {'secretKeys' :  keys, 'primary' : pkhId, });
    aq.setStorage('keysExported', false);

    // and here we reload
    ui.navTo('keys');
},

/**
 * Import WIF. We create the identity EC pair from the provided WIF, then
 * generated the other keys randomly as usual.
 */
'importWif' : function() {
    try {
        var wif = $('#keys-wif')[0].value,
            ecpId = bitcoin.ECPair.fromWIF(wif, conf.btcNet);
        if(!ecpId) throw 'ec pair null';
    } catch(e) {
        alert('Failed to parse WIF.');
        return;
    }
    aq.page.keys.newRandom(ecpId);
},

/**
 * Toggle visibility of the "import WIF" option.
 */
'advanced' : function() {
    var b = $('#keys-advanced'),
        d = $('#keys-import-wif');
    if(d.css('display') === 'none') {
        d.css('display', 'block');
        b.text('Hide Advanced');
    } else {
        d.css('display', 'none');
        b.text('Show Advanced');
    }
},

/**
 * Export all our user state (including all secret keys) to a JSON file,
 * for backup.
 */
'export' : function() {
    var keys = aq.getStorage('keys');
    var obj = {
        'what'          : 'saved user state for Aquila market client',
        'network'       : conf.network,
        'version'       : conf.version,
        'savedAt'       : (new Date()).toISOString(),
    };

    aq.page.keys.allSavedState.forEach(function(p) {
        obj[p] = aq.getStorage(p);
    });

    var str = JSON.stringify(obj, null, '  ');

    var a = document.createElement('a');
    a.href = 'data:text/json,' + encodeURI(str);
    a.target = '_blank';
    a.download = 'aquila-keys-' + keys.primary + '.json';
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    aq.setStorage('keysExported', true);
    ui.navReload();
},

/**
 * Import a JSON file with our user state, as exported above.
 */
'import' : function() {
    var input = $(document.createElement('input'));
    input.attr('type', 'file');
    input.attr('accept', '.json');
    input.on('change', function(e) {
        var fl = input[0].files;
        if(fl.length !== 1) return;
        var f = fl[0], fr = new FileReader();
        fr.onload = function(e) {
            try {
                var str = e.target.result,
                    obj = JSON.parse(str);
                if(obj.what !== 'saved user state for Aquila market client') {
                    throw 'not aquila keys? (wrong .what)';
                }
                if(obj.network !== conf.network) throw 'wrong network';

                aq.page.keys.allSavedState.forEach(function(p) {
                    aq.setStorage(p, obj[p]);
                });
                // We just imported from a file, so no benefit to exporting
                // again probably
                aq.setStorage('keysExported', true);

                ui.navTo('keys');
            } catch(ex) {
                alert('Load JSON failed: ' + ex);
            }
        };
        fr.readAsText(f);
    });
    input.trigger('click');
},

'rotateEncryptionKey' : function() {
    var ecp = bitcoin.ECPair.makeRandom({ 'network' : conf.btcNet });

    var keys = aq.getStorage('keys'),
        pri = keys.secretKeys[keys.primary].skCrypt;
    pri[ecp.getAddress()] = {
        'created' : getUnixTime(),
        'sk'      : ecp.toWIF(),
    };
    aq.setStorage('keys', keys);
    aq.setStorage('keysExported', false);
    ui.navTo('keys');
},

/**
 * Begin the process of generating a new buyer pseudonym. We generate the
 * key pairs, and then prompt the user to select a server.
 */
'newBuyerIdentity' : function() {
    // Generate the key pairs for the new identity.
    var ecp = { }, params = { };
    [ 'id', 'btc', 'crypt' ].forEach(function(p) {
        ecp[p] = bitcoin.ECPair.makeRandom({ 'network' : conf.btcNet });
    });
    var kfi = {
        'type'      : 'keysForIdentity',
        'pkCrypt'   : ecp.crypt.getPublicKeyBuffer().toString('hex'),
        'pkBtc'     : ecp.btc.getPublicKeyBuffer().toString('hex'),
        'sigFrom'   : ecp.id.getAddress(),
        'sig'       : msg.notYetSigned,
    };
    msg.fillTime(kfi);
    kfi = msg.fromUntrusted(kfi, 'compute');
    // Sign by hand, since the keys aren't in local storage yet, don't want
    // to store them until they're approved since we'd otherwise need code
    // to recover if approval fails.
    var sig = bitcoin.message.sign(ecp.id, kfi.hash, conf.btcNet);
    kfi.sig = sig.toString('base64');
    kfi = JSON.stringify(kfi);

    params = {
        'msg'     : kfi,
        'sig'     : [ ],
        'sigFrom' : [ ],
    };
    // Sign with old identities
    var keys = aq.getStorage('keys'), sk = keys.secretKeys, pkhsOld;
    pkhsOld = Object.keys(sk);
    // Take only last three identities, to stop time to generate and check
    // signatures from growing forever
    pkhsOld = pkhsOld.reverse().slice(0, 3);
    pkhsOld.forEach(function(pkhId) {
        var ecpOldId = bitcoin.ECPair.fromWIF(sk[pkhId].skId, conf.btcNet),
            sig = bitcoin.message.sign(ecpOldId, kfi, conf.btcNet);

        params.sigFrom.push(pkhId);
        params.sig.push(sig.toString('base64'));
    });

    // Prompt the user to select a server to use to authorize it.
    var mc = aq.getStorage('marketControl').msg;
    var pnl = $('#popup-newBuyerIdentity-list');
    pnl.text('');
    mc.newBuyerUris.forEach(function(url) {
        if(!url.match(/^(http|https):\/\//)) return;

        var li = $('<li/>'),
            a = $('<a/>', { 'text' : url, 'href' : '#', 'class' : 'mono' });
        a.appendTo(li);
        li.appendTo(pnl);
        a.on('click', function() {
            aq.page.keys.newBuyerIdentityWithServer(url, ecp, params);
            return false;
        });
    });
    ui.showPopup('newBuyerIdentity');
},

/**
 * Connect to the given server, and get a CAPTCHA. Prompt the user to
 * complete the CAPTCHA, and then use it to call the newBuyerIdentity
 * method on that given server.
 */
'newBuyerIdentityWithServer' : function(server, ecp, params, captchaBad) {
    ui.showPopup('log');
    aq.rpc.toServer(server, 'captcha', { }, function(r) {
        var captchaTag = r.result.tag;
        aq.showCaptcha(r, captchaBad);

        $('#captcha-another').off('click');
        $('#captcha-another').on('click', function() {
            aq.page.keys.newBuyerIdentityWithServer(server, ecp, params, false);
        });

        $('#captcha-broadcast').text('New Pseudonym');
        $('#captcha-broadcast').off('click');
        $('#captcha-broadcast').on('click', function() {
            // Must use same server that we got the CAPTCHA from
            params.captchaTag  = captchaTag;
            params.captchaText = $('#captcha-text')[0].value;

            aq.rpc.toServer(server, 'newBuyerIdentity', params, function(r) {
                if(isObj(r) && r.error === 'bad captcha') {
                    aq.page.keys.newBuyerIdentityWithServer(
                        server, ecp, params, true);
                } else if(isObj(r) && r.result === 'ok') {
                    aq.page.keys.finishNewBuyerIdentity(ecp);
                } else {
                    ui.log('unknown response: ' + JSON.stringify(r));
                }
            }, function() { ui.log('timeout or other failure'); });
            ui.showPopup('log');
        });
    });    
},

/**
 * Finish creating a new buyer identity, after the pkhId has been
 * authorized by the network. We write the new key pairs into local
 * storage, flag the newly-generated keys for export, and reload.
 */
'finishNewBuyerIdentity' : function(ecp) {
    var keys = aq.getStorage('keys'), sk = keys.secretKeys;

    var pkhId = ecp.id.getAddress();
    sk[pkhId] = {
        'skId'    : ecp.id.toWIF(),
        'skCrypt' : { },
        'skBtc'   : ecp.btc.toWIF(),
        'created' : getUnixTime(),
    };
    sk[pkhId].skCrypt[ecp.crypt.getAddress()] = {
        'sk'      : ecp.crypt.toWIF(),
        'created' : getUnixTime(),
    };
    keys.primary = pkhId;

    aq.setStorage('keys', keys);
    aq.setStorage('keysExported', false);

    ui.navTo('keys');
},

'broadcastKeysForIdentity' : function() {
    var keys = aq.getStorage('keys');
    var pks = aq.page.keys.getPublicKeys();
    var m = {
        'type'    : 'keysForIdentity',
        'pkCrypt' : pks.crypt,
        'pkBtc'   : pks.btc,
        'sigFrom' : keys.primary,
        'sig'     : msg.notYetSigned,
    };
    msg.fillTime(m);
    m = msg.fromUntrusted(m, 'compute');
    msg.fillSignatures(m);
    m = JSON.stringify(m);

    aq.sendMsgWithCaptcha([ m ]);
},

};

aq.page.deleteKey = {

'needKeys' : true,

'init' : function() {
    ui.showPopup('log');

    var query = { 'limitResults' : 10 };
    var pkhCrypt = searchParam('pkhCrypt'), pkhId = searchParam('pkhId');
    if(pkhCrypt) {
        query.cipherPkhCrypt = [ pkhCrypt ];
        $('#deleteKey-crypt').css('display', 'block');
    } else if(pkhId) {
        query.cipherToAny = [ pkhId ];
        $('#deleteKey-id').css('display', 'block');
    } else {
        ui.log('*** NEITHER pkhCrypt NOR pkhId GIVEN');
        return;
    }

    aq.getMsgsBySearch(query, function(ms, paging) {
        ms.forEach(function(m) {
            var tr = $('<tr/>');
            $('<td/>', { 'text' : m.type }).appendTo(tr);
            ui.hashTableCell(m.hash).appendTo(tr);
            $('<td/>', { 'text' : timeAgo(m.timeReal) }).appendTo(tr);
            tr.appendTo('#deleteKey-msgs');
        });
        var n = paging.total - paging.inPage;
        $('#deleteKey-count').text('(and ' + n + ' older)');
        ui.hidePopup();
    });
},

'delete' : function() {
    if($('#deleteKey-confirm')[0].value !== 'DELETE') {
        ui.showPopup('notify', 'Must type "DELETE".');
        return;
    }

    var keys = aq.getStorage('keys');

    var pkhCrypt = searchParam('pkhCrypt'), pkhId = searchParam('pkhId');
    if(pkhCrypt) {
        var pkh, sk = keys.secretKeys;
        for(pkh in sk) {
            delete sk[pkh].skCrypt[pkhCrypt];
        }
    } else if(pkhId) {
        if(keys.primary === pkhId) return;
        delete keys.secretKeys[pkhId];
    } else {
        return;
    }

    aq.setStorage('keys', keys);
    ui.navTo('keys');
},

};


