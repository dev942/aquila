
aq.page.msg = {

'needKeys' : false,

'searchParams' : [
    'type', 'minTime', 'maxTime', 'sigFrom', 'cipherTo',
    'skipResults', 'custom-key', 'custom-value',
],

'init' : function() {

    var gotStuff = false, have = { };

    function gotMessage(r) {
        if(gotStuff) return;
        if(!(isObj(r) && isObj(r.result) && isArray(r.result.msgs))) return;
        if(r.result.msgs.length !== 1) return;
        r = r.result.msgs[0];
        gotStuff = true;

        if(!aq.verifyMsgSignatures(r)) return;

        ui.hidePopup();
        $('#msg-json').css('display', 'block');

        var append = '';
        if('cipherTo' in r) {
            try {
                var sk = aq.getStorage('keys').secretKeys;
                    te = msg.extractCiphered(r, sk), m2 = { };
                [
                    'cipherText', 'cipherEphem', 'cipherIv',
                    'cipherPkhCrypt', 'cipherSessionKey'
                ].forEach(function(p) {
                    m2[p] = r[p];
                    delete r[p];
                });
                append += 'decrypted = ' + JSON.stringify(te, null, '  ');
                append += '\nciphered = ' + JSON.stringify(m2, null, '  ');
            } catch(e) {
                append += '// could not decrypt: ' + e + '\n';
            }
        }

        var str = JSON.stringify(r, null, '  '), out = '';
        str.split('\n').forEach(function(line) {
            [ 'timeReal', 'validFrom', 'validTo' ].forEach(function(p) {
                var prefix = '  "' + p + '"';
                if(line.substr(0, prefix.length) === prefix) {
                    line += ' // ' + timePlusMinus(r[p]);
                }
            });
            out += line + '\n';
        });
        out += append;

        $('#msg-json')[0].value = 'msg = ' + out;
    }
    function gotHashes(r) {
        if(!(r && r.result)) return;
        r = r.result;
        if(!(isArray(r.hashes) && r.hashes.length > 0)) return;
        gotStuff = true;

        r.hashes.forEach(function(h) {
            if(have[h]) return;
            have[h] = true;

            var tr = $('<tr/>');
            ui.hashTableCell(h).appendTo(tr);
            tr.appendTo('#msg-hashes');
        });

        ui.hidePopup();
        $('#msg-table-many').css('display', 'block');
        $('#msg-count').css('display', 'block');
        $('#msg-count').text('total matching = ' + r.n);
    }

    function gotAll() {
        if(!gotStuff) {
            ui.log('*** ALL REQUESTS TIMED OUT OR RETURNED NO MSGS');
        }
    }

    var h = searchParam('hash');
    if(h && h.length === 64) {
        aq.rpc.toServers('searchMsg', {
              'hashInclude' : [ h ],
              'deletedOk'   : true,
              'resultsAs'   : 'msg',
        }, gotMessage, gotAll);
        $('#msg-search').css('display', 'none');
    } else {
        var params = {
            'limitResults' : 20,
            'skipResults'  : 0,
            'resultsAs'    : 'hash',
        };

        aq.page.msg.searchParams.forEach(function(p) {
            var v = searchParam(p);
            if(v && v.length > 0) {
                $('#msg-' + p)[0].value = v;

                if(p === 'maxTime' || p === 'minTime') {
                    v = timeFromUserInput(v);
                } else if(p === 'sigFrom' || p === 'cipherTo') {
                    // This page takes just one, but method takes a list
                    v = [ v ];
                } else if(p === 'skipResults') {
                    v = v|0; // force to integer
                } else if(p === 'custom-value') {
                    p = searchParam('custom-key');
                }
                params[p] = v;
            }
        });
        if(searchParam('deletedOk')) {
            $('#msg-deletedOk')[0].checked = true;
            params.deletedOk = true;
        }

        aq.rpc.toServers('searchMsg', params, gotHashes, gotAll);
    }
    ui.showPopup('log');
},

'get' : function() {
    var params = { };
    aq.page.msg.searchParams.concat([ 'hash' ]).forEach(function(p) {
        var v = $('#msg-' + p)[0].value;
        if(v && v.length > 0) {
            params[p] = v;
        }
    });
    if($('#msg-deletedOk')[0].checked) params.deletedOk = 'true';
    ui.navTo('msg', params);
},

'getAll' : function() {
    ui.navTo('msg');
},

};


aq.page.marketControl = {

'needKeys' : false,

'init' : function() {
    var mc = aq.getStorage('marketControl').msg,
        owners = aq.getStorage('owners'),
        delegates = aq.getStorage('delegates'),
        ticker = aq.getStorage('ticker');

    mc.ownerSig = '(not shown here)'; // long, breaks formatting
    ticker.sig = '(not shown here)';

    $('#marketControl-marketControl').text(JSON.stringify(mc, null, '  '));
    $('#marketControl-owners').text(JSON.stringify(owners, null, '  '));
    $('#marketControl-delegates').text(JSON.stringify(delegates, null, '  '));
    $('#marketControl-ticker').text(JSON.stringify(ticker, null, '  '));
},

'refresh' : function() {
    aq.setStorage('ticker', null);
    aq.setStorage('marketControl', null);
    ui.navReload();
},

};
