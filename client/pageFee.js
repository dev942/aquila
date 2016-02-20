

aq.page.feeRequests = {

'needKeys' : true,

'init' : function() {
    var keys = aq.getStorage('keys');
    var from = searchParam('from'), to = searchParam('to');
    if(from === 'me') from = keys.primary;
    if(to === 'me') to = keys.primary;
    $('#feeRequests-from')[0].value = (from || '');
    $('#feeRequests-to')[0].value = (to || '');

    var query = {
        'type'      : 'requestFeePayment',
        'resultsAs' : 'msg',
    };
    if(from) query.feeFrom = from;
    if(to) query.feeTo = to;

    aq.getMsgsBySearch(query, function(ms) {
        ms.forEach(function(rfp) {
            var tr = $('<tr/>');
            ui.hashTableCell(rfp.hash, 'feeRequest').appendTo(tr);
            $('<td/>', { 'text' : timeAgo(rfp.timeReal) }).appendTo(tr);
            ui.wrapTd(ui.addressDiv(rfp.sigFrom)).appendTo(tr);
            $('<td/>', { 'text' : rfp.comment }).appendTo(tr);

            tr.appendTo('#feeRequests-lines');
        });
        ui.hidePopup();
    });
},

'search' : function() {
    ui.navTo('feeRequests', {
        'from' : $('#feeRequests-from')[0].value,
        'to'   : $('#feeRequests-to')[0].value,
    });
},

};


aq.page.feeRequest = {

'needKeys' : true,

'init' : function() {
    var keys = aq.getStorage('keys'),
        mc = aq.getStorage('marketControl').msg,
        h = searchParam('hash');

    aq.getMsgByHash(h, function(rfp) {
        if(((!aq.verifyMsgSignatures(rfp))) ||( rfp.hash !== h)) {
            ui.showPopup('*** BAD SIGNATURE');
            return;
        }
        ui.hidePopup();

        $('#feeRequest-hash').text(rfp.hash);
        $('#feeRequest-age').text(timeAgo(rfp.timeReal));
        ui.addressDiv(rfp.sigFrom, true).appendTo('#feeRequest-adminSuper');
        $('#feeRequest-comment').text(rfp.comment);

        var rows = [ ];
        for(var i = 0; i < rfp.feeFrom.length; i++) {
            rows.push({
                'from'   : rfp.feeFrom[i],
                'to'     : rfp.feeTo[i],
                'amount' : rfp.feeAmount[i],
                'i'      : i,
            });
        }
        var kp = keys.primary;
        rows.sort(function(a, b) {
            if((a.from === kp) && (b.from !== kp)) return -1;
            if((a.from !== kp) && (b.from === kp)) return  1;
            return a.i - b.i;
        });
        rows.forEach(function(row) {
            var tr = $('<tr/>');
            $('<td/>', { 'text'  : row.from,
                         'class' : 'mono wrap' }).appendTo(tr);
            $('<td/>', { 'text'  : row.to,
                         'class' : 'mono wrap' }).appendTo(tr);
            $('<td/>', { 'text' : ui.formatBtcBare(row.amount) }).appendTo(tr);
            var td = $('<td/>');
            if(row.from === keys.primary) {
                tr.addClass('hl');
                var pay = $('<div/>', { 'class' : 'button-blue',
                                        'text'  : 'Pay' });
                td.css('padding', '12px 5px');
                pay.appendTo(td);
                pay.on('click', function() {
                    getCryptKeys(row.to, row.amount);
                });
            }
            td.appendTo(tr);
            tr.appendTo('#feeRequest-lines');
        });
    });

    function getCryptKeys(to, value) {
        var pkCryptAdmin, pkCryptTo, pkBtcTo, done = false;

        function got(kfi) {
            if(!(kfi && (kfi.type === 'keysForIdentity') &&
                 aq.verifyMsgSignatures(kfi)))
            {
                ui.log('*** BAD OR MISSING ENCRYPTION KEY');
                return;
            }
            if(kfi.sigFrom === to) {
                pkCryptTo = kfi.pkCrypt;
                pkBtcTo = kfi.pkBtc;
                ui.log('got pkCrypt for recipient: ' + pkCryptTo);
                ui.log('got pkBtc for recipient: ' + pkBtcTo);
            }
            if(kfi.sigFrom === mc.adminContact[0]) {
                pkCryptAdmin = kfi.pkCrypt;
                ui.log('got pkCrypt for admin: ' + pkCryptAdmin);
            }
            if(pkCryptTo && pkCryptAdmin && pkBtcTo && (!done)) {
                done = true;
                paidFee(to, value, pkCryptTo, pkCryptAdmin, pkBtcTo);
            }
        }
        ui.log('getting pkCrypt for recipient and admin');
        aq.getMsgBySearch({
            'type'    : 'keysForIdentity',
            'sigFrom' : [ mc.adminContact[0] ],
        }, got);
        aq.getMsgBySearch({
            'type'    : 'keysForIdentity',
            'sigFrom' : [ to ],
        }, got);
    }

    function paidFee(to, value, pkCryptTo, pkCryptAdmin, pkBtcTo) {
        var myPks = aq.page.keys.getPublicKeys();
        do {
            var pfTe = {
                'stealth'   : randomBytes(32).toString('hex'),
            };
            var pf = {
                'type'      : 'paidFee',
                'pkBtc'     : pkBtcTo,
                'request'   : h,
                'feeAmount' : value,

                'cipherTo'  : [
                    to,
                    keys.primary,
                    mc.adminContact[0],
                ],
                'sigFrom'   : keys.primary,
                'sig'       : msg.notYetSigned,
            };
            msg.fillCiphered(pf, pfTe, [
                pkCryptTo,
                myPks.crypt,
                pkCryptAdmin,
            ]);
            msg.fillTime(pf);
            pf = msg.fromUntrusted(pf, 'compute');
        } while(!ecMath.validOrderHash(pf.hash, pfTe.stealth));

        msg.fillSignatures(pf);
        aq.sendMsgWithCaptcha([ JSON.stringify(pf) ], function() {
            ui.navTo('feePayment', { 'hash' : pf.hash, });
        });
    }
},

};


aq.page.feePayments = {

'needKeys' : true,

'init' : function() {
    var keys = aq.getStorage('keys');
    var from = searchParam('from'), to = searchParam('to');
    if(from === 'me') from = keys.primary;
    if(to === 'me') to = keys.primary;
    $('#feePayments-from')[0].value = (from || '');
    $('#feePayments-to')[0].value = (to || '');

    var query = {
        'type'      : 'paidFee',
        'resultsAs' : 'msg',
    };
    if(from) query.sigFrom = [ from ];
    if(to) query.cipherTo = [ to ];

    aq.getMsgsBySearch(query, function(ms) {
        ms.forEach(function(pf) {
            var tr = $('<tr/>');
            ui.hashTableCell(pf.hash, 'feePayment').appendTo(tr);
            $('<td/>', { 'text' : timeAgo(pf.timeReal) }).appendTo(tr);
            ui.wrapTd(ui.addressDiv(pf.sigFrom)).appendTo(tr);
            ui.wrapTd(ui.addressDiv(pf.cipherTo[0])).appendTo(tr);
            $('<td/>', {
                'text' : ui.formatBtcBare(pf.feeAmount),
            }).appendTo(tr);

            tr.appendTo('#feePayments-lines');
        });
        ui.hidePopup();
    });
},

'search' : function() {
    ui.navTo('feePayments', {
        'from' : $('#feePayments-from')[0].value,
        'to'   : $('#feePayments-to')[0].value,
    });
},

};


aq.page.feePayment = {

'needKeys' : true,

'init' : function() {
    var h = searchParam('hash');
    aq.getMsgByHash(h, function(pf) {
        if(!(pf && aq.verifyMsgSignatures(pf) && pf.type === 'paidFee')) {
            ui.log('*** BAD paidFee MESSAGE');
            return;
        }
        $('#feePayment-hash').text(pf.hash);
        $('#feePayment-age').text(timeAgo(pf.timeReal));
        ui.addressDiv(pf.sigFrom, true).appendTo('#feePayment-from');
        ui.addressDiv(pf.cipherTo[0], true).appendTo('#feePayment-to');
        $('#feePayment-amount').text(ui.formatBtc(pf.feeAmount));
        ui.hashLink(pf.request, 'feeRequest').appendTo('#feePayment-request');

        try {
            var keys = aq.getStorage('keys'), pkh,
                sk = keys.secretKeys,
                te = msg.extractCiphered(pf, sk),
                addr = ecMath.getFeeAddress(pf, te);

            ui.btcLink(addr).appendTo('#feePayment-address');

            for(pkh in sk) {
                if(pkh === pf.cipherTo[0]) {
                    var wif = ecMath.getStealthSecretKey(pf, te, sk[pkh].skBtc);
                    var ecp = bitcoin.ECPair.fromWIF(wif, conf.btcNet);
                    if(ecp.getAddress() !== addr) {
                        ui.log('*** ADDRESS FROM SK DOES NOT MATCH');
                        throw 'bad stealth from sk';
                    }
                    $('#feePayment-wif-row').css('display', 'table-row');
                    $('#feePayment-wif').text(wif);
                }
            }
        } catch(e) {
            console.log(e);
            $('#feePayment-address').text('cannot decrypt');
        }

        ui.hidePopup();
    });
},

};


