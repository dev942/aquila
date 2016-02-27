
aq.page.orders = {

'needKeys' : true,

'init' : function() {
    var have = { };
    function gotOne(r) {
        if(!(isObj(r) && isObj(r.result) && isArray(r.result.msgs))) return;
        var r = r.result;
        
        r.msgs.forEach(function(po) {
            if(have[po.hash]) return;
            have[po.hash] = true;

            var tr = $('<tr/>');

            var td = $('<td/>', { 'class' : 'mono wrap' }),
                a = $('<a/>', {
                'text'  : po.hash,
                'href' : '?a=order&hash=' + encodeURI(po.hash),
            });
            a.appendTo(td);
            td.appendTo(tr);
            
            $('<td/>', { 'text' : timeAgo(po.timeReal) }).appendTo(tr);
            $('<td/>', { 'text' : po.subject }).appendTo(tr);

            ui.wrapTd(ui.addressDiv(po.sigFrom)).appendTo(tr);
            ui.wrapTd(ui.addressDiv(po.cipherTo[0])).appendTo(tr);

            tr.appendTo('#orders-list');
        });
        var copy = [ 'to', 'from' ];
        ui.pageControls('#orders', copy, 'orders ',
            r.skipped, r.msgs.length, r.n, conf.ordersPerPage);
        ui.hidePopup('log');
    }

    var params = {
        'type'          : 'placeOrder',
        'limitResults'  : conf.ordersPerPage,
        'skipResults'   : searchParam('skip')|0,
        'resultsAs'     : 'msg',
    };
    var to = searchParam('to'), from = searchParam('from'),
        keys = aq.getStorage('keys');
    if(to === 'me') {
        params.cipherTo = [ keys.primary ];
        $('#orders-title').text('My Received Orders');
        $('#orders-table').addClass('hide5');
    } else if(to) {
        params.cipherTo = [ to ];
    } else if(from === 'me') {
        params.sigFrom = [ keys.primary ];
        $('#orders-title').text('My Placed Orders');
        $('#orders-table').addClass('hide4');
    } else if(from) {
        params.sigFrom = [ from ];
    } else {
        return;
    }
    aq.rpc.toServers('searchMsg', params, gotOne, null);
    ui.showPopup('log');
},

};


aq.page.order = {

'needKeys' : true,

'init' : function() {
    var listing, order, comments = [ ];

    function gotListing(m) {
        listing = m;
        try {
            var mc = aq.getStorage('marketControl').msg,
                keys = aq.getStorage('keys'),
                sk = keys.secretKeys,
                te = msg.extractCiphered(order, sk),
                myPks = aq.page.keys.getPublicKeys();

            if(!(((order.sigFrom === keys.primary) &&
                  (order.pkBuyer === myPks.btc)) ||
                 ((order.cipherTo[0] === keys.primary) &&
                  (order.pkSeller === myPks.btc)) ||
                 (mc.adminPkh[0] === keys.primary)))
            {
                throw 'neither buyer nor seller nor admin';
            }
            if($.grep(mc.adminBtc, function(v) {
                    return (v === order.pkAdmin); }).length === 0)
            {
                $('#order-oldAdminBtc').css('display', 'inline');
            }
            if(order.cipherTo[0] !== listing.sigFrom) throw 'not to seller';

            if(order.qty.length !== listing.itemGroup.length)
                throw 'item counts do not match';

            ui.hidePopup('log');
            showCommentsIfDone();
            aq.page.order.show(listing, order, te);
        } catch(e) {
            ui.log('*** failed to decrypt: ' + e);
        }
    }
    function gotOrder(m) {
        order = m;
        aq.getMsgByHash(m.listing, gotListing);
    }
    function gotPrivateMessages(ms, paging) {
        comments = comments.concat(ms);

        showCommentsIfDone();
    }
    function showCommentsIfDone() {
        if(!(order && listing)) return;

        var keys = aq.getStorage('keys');
        comments.forEach(function(m) {
            if(!((m.type === 'privateComment') && (m.ref === hash))) return;
            if(!((m.sigFrom === order.sigFrom) ||
                 (m.sigFrom === listing.sigFrom)))
            {
                return;
            }

            msg.extractCipheredPrivateComment(m);
            var ct = ui.commentTable(m, {
                'isReply'        : (m.sigFrom === keys.primary),
                'narrower'       : true,
                'noOrderLink'    : true,
                'markReadButton' : (m.sigFrom !== keys.primary),
            });
            ct.appendTo('#order-msgs');
            aq.asyncVerifyMsgSignatures(m, ct);

            if(m.state === 'escrow released') {
                // Prompt to leave feedback only after escrow release
                $('#order-trust').css('display', 'inline');
            }
            if(m.tx) {
                // Move the "propose release escrow" button somewhere less
                // prominent after escrow proposal, since that should usually
                // be okay on the first try.
                $('#order-propose-upper').css('display', 'none');
                $('#order-propose-lower').css('display', 'inline');
            }
        });
        comments = [ ];
    }

    var hash = searchParam('hash');
    aq.getMsgByHash(hash, gotOrder);
    aq.getMsgsBySearch({
        'type' : 'privateComment',
        'ref'  : hash,
    }, gotPrivateMessages);
},

'show' : function(listing, order, te) {
    var address = ecMath.getMultisigAddress(order, te);

    var ticker;
    try {
        ticker = JSON.parse(order.ticker);
        ticker = msg.fromUntrusted(ticker, 'check');
        if(ticker.type !== 'ticker') throw 'bad type';
        if(!aq.verifyMsgSignatures(ticker)) throw 'bad sig';
        var dt = Math.abs(order.timeReal - ticker.timeReal);
        // allow two hours of slop, maybe excessive
        if(dt > 2*60*60) throw 'bad ticker time: ' + dt + ' s';

        var mc = aq.getStorage('marketControl').msg;
        if(!mc.adminTicker.some(function(a) {
            return (a === ticker.sigFrom);
        })) {
            throw 'not signed by adminTicker';
        }
    } catch(e) {
        ui.log('**** BAD ticker IN ORDER FOR RATE LOCK: ' + e);
        ui.showPopup('log');
        return;
    }

    var keys = aq.getStorage('keys');
    if(order.cipherTo[0] === keys.primary) {
        $('#order-title').text('View Received Order');
    } else if(order.sigFrom === keys.primary) {
        $('#order-title').text('View Placed Order');
    }

    $('#order-hash').text(order.hash);
    $('<a/>', {
        'text' : listing.subject,
        'href' : '?a=listing&hash=' + encodeURI(listing.hash),
    }).appendTo('#order-listing');
    ui.addressDiv(listing.sigFrom, true).appendTo('#order-seller');
    ui.addressDiv(order.sigFrom, true).appendTo('#order-buyer');
    $('#order-age').text(timeAgo(order.timeReal));
    ui.btcLink(address).appendTo('#order-addr');

    var cur = listing.currency, total = 0;
    for(var i = 0; i < order.qty.length; i++) {
        if(order.qty[i] === 0) continue;
        var subtotal = listing.itemPrice[i] * order.qty[i];
        total += subtotal;

        var tr = $('<tr/>');
        $('<td/>', { 'text' : listing.itemDesc[i] }).appendTo(tr);
        $('<td/>', { 'text' : order.qty[i] }).appendTo(tr);
        $('<td/>', { 'text' : listing.itemPrice[i] + ' ' + cur }).appendTo(tr);
        $('<td/>', { 'text' : subtotal + ' ' + cur }).appendTo(tr);
        tr.appendTo('#order-items');
    }
    var tr = $('<tr/>');
    $('<td/>', { 'class' : 'noborder', 'colspan' : 3 }).appendTo(tr);
    var str = total + ' ' + cur;
    if(cur !== 'BTC') {
        str += ' = ';
        str += ui.formatBtc(aq.currencyToBtc(total, cur, ticker));
    }
    $('<td/>', { 'text' : str, 'class' : 'total' }).appendTo(tr);
    tr.appendTo('#order-items');

    // Set up the click handlers for the buttons that navigate to compose
    // a new private message attached to this order, with or without a
    // Bitcoin transaction attached.
    var to;
    if(order.sigFrom === keys.primary) {
        to = order.cipherTo[0];
    } else if(order.cipherTo[0] === keys.primary) {
        to = order.sigFrom;
    } else {
        return;
    }
    $('#order-trust').on('click', function() {
        ui.navTo('trustNew', { 'to' : to, 'order' : order.hash, });
    });
    var composeParams = {
        'to'       : to,
        'subject'  : 'ORDER: ' + listing.subject,
        'order'    : order.hash,
        'isSeller' : (order.cipherTo[0] === keys.primary) ? 'true' : '',
    }
    $('#order-compose').on('click', function() {
        ui.navTo('compose', composeParams);
    });

    var txos = { };
    $('#order-propose-upper,#order-propose-lower').on('click', function() {
        ui.log('\nGETTING ALL UTXOs SENT TO ADDRESS ' + address);
        ui.showPopup('log');
        aq.rpc.toServers('txos', { 'address' : address }, function(r) {
            if(!(isObj(r) && isArray(r.result))) return;
            r.result.forEach(function(txo) {
                var key = txo.txid + ',' + txo.vout;
                if(key in txos) return;

                txos[key] = txo;
                var tr = $('<tr/>');
                $('<td/>', {
                    'class' : 'mono wrap',
                    'text'  : txo.txid,
                }).appendTo(tr);
                $('<td/>', { 'text' : txo.vout }).appendTo(tr);
                $('<td/>', { 'text' : ui.formatBtc(txo.value) }).appendTo(tr);
                tr.appendTo('#escrow-txos');
            });
            if(Object.keys(txos).length > 0) {
                ui.showPopup('escrow');
            }
        }, function() {
            if(Object.keys(txos).length === 0) {
                ui.showPopup('notify',
                    'Escrowed funds not yet found in blockchain.');
            }
        });
    });
    $('#escrow-compose').on('click', function() {
        try {
            var keys = aq.getStorage('keys'),
                skBase = keys.secretKeys[keys.primary].skBtc,
                sk = ecMath.getStealthSecretKey(order, te, skBase),
                pks = ecMath.getStealthPublicKeys(order, te),
                redeemScript = bitcoin.script.multisigOutput(2, pks);

            var txb = new bitcoin.TransactionBuilder(conf.btcNet),
                key, total = 0, i, n = 0;
            for(key in txos) {
                txb.addInput(txos[key].txid, txos[key].vout);
                n++;
                total += txos[key].value;
            }
            var fee = ($('#escrow-fee')[0].value)*1;
            if((!isNum(fee)) || fee < 0 || fee > 0.002)
                throw 'fee unreasonable';
            var satoshis = cutil.btcToSatoshis(total - fee);
            var outAddr = $('#escrow-addr')[0].value;
            if(!cutil.checker.btcAddr(outAddr)) throw 'bad output address';
            txb.addOutput(outAddr, satoshis);
  
            var ecp = bitcoin.ECPair.fromWIF(sk, conf.btcNet);
            for(i = 0; i < n; i++) {
                txb.sign(i, ecp, redeemScript);
            }

            var tx = txb.buildIncomplete().toHex();
            composeParams.tx = tx;
            ui.navTo('compose', composeParams);
        } catch(e) {
            ui.showPopup('notify', 'Failed: ' + e);
        }
    });
},

};


